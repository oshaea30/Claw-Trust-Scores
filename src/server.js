import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { URL } from "node:url";

import { authenticate } from "./auth.js";
import { getDecisionLogs, logDecision } from "./audit.js";
import { clawCreditPreflight } from "./clawcredit.js";
import { PLANS } from "./config.js";
import { flushStoreToDisk, loadStoreFromDisk } from "./persistence.js";
import { getScore, postEvent } from "./service.js";
import { handleCreateUser, handleUpgrade, handleStripeWebhook } from "./selfserve.js";
import { getUsageSnapshot } from "./usage.js";
import { createWebhook, deleteWebhook, getWebhooks } from "./webhooks.js";
import { getHeroSnapshot } from "./public-signals.js";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const LANDING_PATH = path.resolve(process.cwd(), "public", "index.html");

loadStoreFromDisk();

// ---------------------------------------------------------------------------
// Response / body helpers
// ---------------------------------------------------------------------------

const SAFE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Content-Type, x-api-key",
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...SAFE_HEADERS,
    ...CORS_HEADERS,
  });
  response.end(JSON.stringify(body));
}

function sendTyped(response, statusCode, type, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": type,
    ...SAFE_HEADERS,
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  response.end(body);
}

function sendHtmlFile(response, absolutePath) {
  try {
    const html = fs.readFileSync(absolutePath, "utf8");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    response.end(html);
  } catch {
    sendJson(response, 500, { error: "Landing page unavailable." });
  }
}

function mimeTypeForPath(absolutePath) {
  const ext = path.extname(absolutePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function trySendStaticAsset(response, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return false;

  const absolutePath = path.resolve(PUBLIC_DIR, relative);
  if (
    absolutePath !== PUBLIC_DIR &&
    !absolutePath.startsWith(`${PUBLIC_DIR}${path.sep}`)
  ) {
    return false;
  }

  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  try {
    const body = fs.readFileSync(absolutePath);
    response.writeHead(200, {
      "content-type": mimeTypeForPath(absolutePath),
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...CORS_HEADERS,
    });
    response.end(body);
    return true;
  } catch {
    sendJson(response, 500, { error: "Static asset unavailable." });
    return true;
  }
}

/** Read body as parsed JSON (for normal routes). */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 1_000_000) reject(new Error("Payload too large"));
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    request.on("error", reject);
  });
}

/** Read body as raw string (for Stripe signature verification). */
function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 1_000_000) reject(new Error("Payload too large"));
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (request, response) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`
  );

  // --- CORS preflight ---
  if (request.method === "OPTIONS") {
    response.writeHead(204, { ...CORS_HEADERS });
    return response.end();
  }

  // --- Landing page ---
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return sendHtmlFile(response, LANDING_PATH);
  }

  if (request.method === "GET" && trySendStaticAsset(response, url.pathname)) {
    return;
  }

  // --- Health check ---
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "agent-trust-registry",
      version: "0.2.0",
    });
  }

  // --- Plans (public) ---
  if (request.method === "GET" && url.pathname === "/v1/plans") {
    return sendJson(response, 200, { plans: PLANS });
  }

  // --- Public hero snapshot (safe demo data for landing page) ---
  if (request.method === "GET" && url.pathname === "/v1/public/hero-snapshot") {
    return sendJson(response, 200, getHeroSnapshot());
  }

  // --- Self-serve signup (public, no auth required) ---
  if (request.method === "POST" && url.pathname === "/v1/users") {
    try {
      const payload = await readJsonBody(request);
      const result = await handleCreateUser(payload);
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  // --- Upgrade redirect (public, key in URL) ---
  if (request.method === "GET" && url.pathname.startsWith("/v1/upgrade/")) {
    const apiKey = url.pathname.split("/").pop();
    const tier = url.searchParams.get("tier") ?? "starter";
    try {
      const result = await handleUpgrade(apiKey, tier);
      // If we got a checkout URL, redirect the browser there
      if (result.body.checkoutUrl) {
        response.writeHead(302, {
          Location: result.body.checkoutUrl,
          ...CORS_HEADERS,
        });
        return response.end();
      }
      return sendJson(response, result.status, result.body);
    } catch (error) {
      return sendJson(response, 500, { error: "Internal error." });
    }
  }

  // --- Stripe webhook (public, signature-verified) ---
  if (request.method === "POST" && url.pathname === "/v1/stripe/webhook") {
    try {
      const rawBody = await readRawBody(request);
      const sig = request.headers["stripe-signature"] ?? "";
      const result = await handleStripeWebhook(rawBody, sig);
      return sendJson(response, result.status, result.body);
    } catch (error) {
      return sendJson(response, 400, { error: "Webhook processing failed." });
    }
  }

  // --- Upgrade success/cancel pages (simple HTML responses) ---
  if (request.method === "GET" && url.pathname === "/upgrade-success") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return response.end(`
      <!DOCTYPE html>
      <html><head><title>Upgrade Complete</title></head>
      <body style="font-family:system-ui;text-align:center;padding:60px;">
        <h1 style="color:#e63946;">🦀 Upgrade Complete!</h1>
        <p>Your API key has been upgraded. New limits are active immediately.</p>
        <p>Check your email for confirmation.</p>
      </body></html>
    `);
  }

  if (request.method === "GET" && url.pathname === "/upgrade-cancel") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return response.end(`
      <!DOCTYPE html>
      <html><head><title>Upgrade Cancelled</title></head>
      <body style="font-family:system-ui;text-align:center;padding:60px;">
        <h1>Upgrade Cancelled</h1>
        <p>No changes were made to your account.</p>
      </body></html>
    `);
  }

  // --- Everything below requires auth ---
  if (!url.pathname.startsWith("/v1/")) {
    return sendJson(response, 404, { error: "Not Found" });
  }

  const account = authenticate(request);
  if (!account) {
    return sendJson(response, 401, {
      error: "Unauthorized. Provide a valid x-api-key header.",
    });
  }

  // --- POST /v1/events ---
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

  // --- GET /v1/score ---
  if (request.method === "GET" && url.pathname === "/v1/score") {
    const agentId = url.searchParams.get("agentId");
    const result = getScore({ account, agentId });

    if (result.status === 200 && result.body?.agentId) {
      logDecision({
        account,
        action: "score_check",
        agentId: result.body.agentId,
        outcome: "scored",
        score: result.body.score,
        reason: result.body.explanation,
      });
    }

    return sendJson(response, result.status, result.body);
  }

  // --- POST /v1/integrations/clawcredit/preflight ---
  if (
    request.method === "POST" &&
    url.pathname === "/v1/integrations/clawcredit/preflight"
  ) {
    try {
      const payload = await readJsonBody(request);
      const result = clawCreditPreflight({ payload, account });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  // --- Usage snapshot ---
  if (request.method === "GET" && url.pathname === "/v1/usage") {
    const result = getUsageSnapshot({ account });
    return sendJson(response, result.status, result.body);
  }

  // --- Decision audit export ---
  if (request.method === "GET" && url.pathname === "/v1/audit/decisions") {
    const result = getDecisionLogs({ account, query: Object.fromEntries(url.searchParams.entries()) });

    if (result.type === "text/csv; charset=utf-8") {
      return sendTyped(response, result.status, result.type, result.body, {
        "content-disposition": `attachment; filename="${result.filename}"`,
      });
    }

    return sendJson(response, result.status, result.body);
  }

  // --- Webhooks CRUD ---
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Agent Trust Registry v0.2.0 listening on http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    flushStoreToDisk();
    process.exit(0);
  });
}
