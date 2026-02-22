import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

import { authenticate, issueApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "./auth.js";
import { clawCreditPreflight } from "./clawcredit.js";
import { PLANS } from "./config.js";
import { flushStoreToDisk, loadStoreFromDisk } from "./persistence.js";
import { logSecurityEvent } from "./security-log.js";
import { getScore, postEvent } from "./service.js";
import { createWebhook, deleteWebhook, getWebhooks } from "./webhooks.js";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY_BYTES = 1_000_000;
const MAX_UNAUTH_PER_MINUTE = 60;
const unauthRateByWindowAndIp = new Map();

loadStoreFromDisk();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    request.on("data", (chunk) => {
      if (finished) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finished = true;
        request.destroy();
        logSecurityEvent("payload_too_large", { remoteAddress: request.socket.remoteAddress ?? "unknown" });
        reject(new Error("Payload too large"));
      }
    });

    request.on("end", () => {
      if (finished) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        finished = true;
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        finished = true;
        reject(new Error("Invalid JSON"));
      }
    });

    request.on("error", (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    });
  });
}

function safeEquals(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authenticateAdmin(request) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const provided = request.headers["x-admin-token"]?.trim();
  return safeEquals(provided, expected);
}

function pruneOldUnauthEntries(currentMinute) {
  if (unauthRateByWindowAndIp.size < 5000) return;
  for (const key of unauthRateByWindowAndIp.keys()) {
    const [minuteRaw] = key.split(":");
    const minute = Number(minuteRaw);
    if (!Number.isFinite(minute) || minute < currentMinute - 2) {
      unauthRateByWindowAndIp.delete(key);
    }
  }
}

function unauthRateLimited(request) {
  const ip = request.socket.remoteAddress ?? "unknown";
  const minuteWindow = Math.floor(Date.now() / 60000);
  const key = `${minuteWindow}:${ip}`;
  const current = unauthRateByWindowAndIp.get(key) ?? 0;
  if (current >= MAX_UNAUTH_PER_MINUTE) {
    return true;
  }
  unauthRateByWindowAndIp.set(key, current + 1);
  pruneOldUnauthEntries(minuteWindow);
  return false;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "agent-trust-registry"
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/plans") {
    return sendJson(response, 200, { plans: PLANS });
  }

  if (url.pathname === "/v1/admin/keys" || url.pathname === "/v1/admin/keys/rotate" || url.pathname === "/v1/admin/keys/revoke") {
    if (!authenticateAdmin(request)) {
      logSecurityEvent("admin_auth_failed", { remoteAddress: request.socket.remoteAddress ?? "unknown", path: url.pathname });
      return sendJson(response, 401, { error: "Unauthorized admin request." });
    }

    if (request.method === "GET" && url.pathname === "/v1/admin/keys") {
      return sendJson(response, 200, { keys: listApiKeys() });
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/keys") {
      try {
        const payload = await readJsonBody(request);
        const result = issueApiKey({ tier: payload.tier });
        return sendJson(response, result.status, result.body);
      } catch {
        return sendJson(response, 400, { error: "Invalid JSON body." });
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/keys/rotate") {
      try {
        const payload = await readJsonBody(request);
        const result = rotateApiKey({ apiKey: payload.apiKey });
        return sendJson(response, result.status, result.body);
      } catch {
        return sendJson(response, 400, { error: "Invalid JSON body." });
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/keys/revoke") {
      try {
        const payload = await readJsonBody(request);
        const result = revokeApiKey({ apiKey: payload.apiKey });
        return sendJson(response, result.status, result.body);
      } catch {
        return sendJson(response, 400, { error: "Invalid JSON body." });
      }
    }

    return sendJson(response, 405, { error: "Method not allowed." });
  }

  if (!url.pathname.startsWith("/v1/")) {
    return sendJson(response, 404, { error: "Not Found" });
  }

  const account = authenticate(request);
  if (!account) {
    if (unauthRateLimited(request)) {
      logSecurityEvent("unauthorized_rate_limited", { remoteAddress: request.socket.remoteAddress ?? "unknown", path: url.pathname });
      return sendJson(response, 429, { error: "Too many unauthorized requests." });
    }
    logSecurityEvent("unauthorized_request", { remoteAddress: request.socket.remoteAddress ?? "unknown", path: url.pathname });
    return sendJson(response, 401, { error: "Unauthorized. Provide a valid x-api-key header." });
  }

  if (request.method === "POST" && url.pathname === "/v1/events") {
    try {
      const payload = await readJsonBody(request);
      const result = await postEvent({ account, payload });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/score") {
    const result = getScore({ account, agentId: url.searchParams.get("agentId") });
    return sendJson(response, result.status, result.body);
  }

  if (request.method === "POST" && url.pathname === "/v1/integrations/clawcredit/preflight") {
    try {
      const payload = await readJsonBody(request);
      const result = clawCreditPreflight({ account, payload });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/webhooks") {
    try {
      const payload = await readJsonBody(request);
      const result = createWebhook({ account, payload });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/webhooks") {
    const result = getWebhooks({ account });
    return sendJson(response, result.status, result.body);
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/v1/webhooks/")) {
    const webhookId = url.pathname.split("/").pop();
    const result = deleteWebhook({ account, webhookId });
    return sendJson(response, result.status, result.body);
  }

  return sendJson(response, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Agent Trust Registry listening on http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    flushStoreToDisk();
    process.exit(0);
  });
}
