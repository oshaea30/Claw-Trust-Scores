import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { getAdminAgentSnapshot, getAdminOverview, getRecentDecisionFeed } from "./admin.js";
import {
  issueAttestation,
  listAttestations,
  revokeAttestation,
  verifyAttestationToken,
} from "./attestations.js";
import { authenticate, issueApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "./auth.js";
import { getDecisionLogs, logDecision } from "./audit.js";
import { clawCreditPreflight } from "./clawcredit.js";
import { PLANS } from "./config.js";
import { getIngestSecretStatus, ingestVerifiedEvent, rotateIngestSecret } from "./ingest.js";
import { listIntegrationTemplates, mapProviderEvent } from "./integration-templates.js";
import { revokeUserApiKey, rotateUserApiKey } from "./key-store.js";
import { flushStoreToDisk, loadStoreFromDisk } from "./persistence.js";
import { applyPolicyPreset, getPolicy, listPolicyPresets, resetPolicy, setPolicy } from "./policy.js";
import { getHeroSnapshot } from "./public-signals.js";
import { logSecurityEvent } from "./security-log.js";
import { getScore, postEvent } from "./service.js";
import { handleCreateUser, handleStripeWebhook, handleUpgrade } from "./selfserve.js";
import { getUsageSnapshot } from "./usage.js";
import { createWebhook, deleteWebhook, getWebhooks } from "./webhooks.js";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY_BYTES = 1_000_000;
const MAX_UNAUTH_PER_MINUTE = 60;
const unauthRateByWindowAndIp = new Map();

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

const STATIC_ROUTES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/api-docs": "api-docs.html",
  "/admin-dashboard": "admin-dashboard.html",
  "/getting-started": "getting-started.html",
  "/changelog": "changelog.html",
  "/status": "status.html",
  "/privacy": "privacy.html",
  "/terms": "terms.html"
};

const LEGACY_HTML_REDIRECTS = {
  "/api-docs.html": "/api-docs",
  "/admin-dashboard.html": "/admin-dashboard",
  "/getting-started.html": "/getting-started",
  "/changelog.html": "/changelog",
  "/status.html": "/status",
  "/privacy.html": "/privacy",
  "/terms.html": "/terms"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const SAFE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Content-Type, x-api-key, x-admin-token, x-ingest-signature, x-ingest-timestamp"
};

function hasValidTrustApiKeys(raw) {
  if (!raw || !raw.trim()) return false;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .some((entry) => {
      const [key, tier] = entry.split(":").map((part) => part.trim());
      return Boolean(key) && (tier === "owner" || tier === "free" || tier === "starter" || tier === "pro");
    });
}

function assertProductionSecurityConfig() {
  if (process.env.NODE_ENV !== "production") return;

  const trustApiKeys = process.env.TRUST_API_KEYS;
  if (!hasValidTrustApiKeys(trustApiKeys)) {
    throw new Error(
      "TRUST_API_KEYS is required in production and must contain at least one valid api_key:tier entry."
    );
  }

  const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!dataEncryptionKey) {
    throw new Error("DATA_ENCRYPTION_KEY is required in production.");
  }
}

assertProductionSecurityConfig();
loadStoreFromDisk();

function sendJson(response, statusCode, body) {
  const isApi = response._requestPath?.startsWith("/v1/") === true;
  const requestId = String(response._requestId ?? "");
  const payload = normalizeErrorPayload({ statusCode, body, isApi, requestId, path: response._requestPath });
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...(requestId ? { "x-request-id": requestId } : {}),
    ...SAFE_HEADERS,
    ...CORS_HEADERS
  });
  if (response._requestMethod === "HEAD") {
    return response.end();
  }
  response.end(JSON.stringify(payload));
}

function sendTyped(response, statusCode, contentType, body, extraHeaders = {}) {
  const requestId = String(response._requestId ?? "");
  response.writeHead(statusCode, {
    "content-type": contentType,
    ...(requestId ? { "x-request-id": requestId } : {}),
    "cache-control": statusCode === 200 ? "public, max-age=300" : "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...CORS_HEADERS,
    ...extraHeaders
  });
  if (response._requestMethod === "HEAD") {
    return response.end();
  }
  response.end(body);
}

function normalizeCode(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getErrorHint({ statusCode, message, path }) {
  const text = String(message ?? "").toLowerCase();
  if (statusCode === 401) return "Provide header: x-api-key: claw_...";
  if (statusCode === 402) return "Plan limit reached. Use /v1/upgrade/{apiKey}?tier=starter (or ?tier=pro).";
  if (statusCode === 404 && String(path ?? "").startsWith("/v1/")) return "Check endpoint path and HTTP method.";
  if (statusCode === 404) return "Check URL path and try / for the homepage.";
  if (statusCode === 429) return "Retry after a short delay or reduce request rate.";
  if (statusCode === 413) return "Reduce request payload size.";
  if (text.includes("payload too large")) return "Reduce request payload size.";
  if (text.includes("invalid json")) return "Send valid JSON with header Content-Type: application/json.";
  if (text.includes("unauthorized")) return "Provide a valid x-api-key header.";
  if (text.includes("api key not found")) return "Create a key with POST /v1/users, then retry.";
  return "See docs at /api-docs for request examples.";
}

function normalizeErrorPayload({ statusCode, body, isApi, requestId, path }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (!isApi || statusCode < 400) return body;
  if (!("error" in body) || typeof body.error !== "string") return body;
  if ("message" in body && "code" in body && "hint" in body && "requestId" in body) return body;
  const message = body.error;
  const code = normalizeCode(body.code || message || `http_${statusCode}`) || `http_${statusCode}`;
  const hint = body.hint || getErrorHint({ statusCode, message, path });
  return {
    ...body,
    code,
    message,
    hint,
    requestId,
  };
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
        logSecurityEvent("payload_too_large", {
          remoteAddress: request.socket.remoteAddress ?? "unknown"
        });
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

function readRawBody(request) {
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
        logSecurityEvent("payload_too_large", {
          remoteAddress: request.socket.remoteAddress ?? "unknown"
        });
        reject(new Error("Payload too large"));
      }
    });

    request.on("end", () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
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

function authenticateAdminToken(request) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const provided = request.headers["x-admin-token"]?.trim();
  return safeEquals(provided, expected);
}

function ensureAdminToken(request, response) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) {
    sendJson(response, 503, { error: "Admin endpoint is not configured." });
    return false;
  }
  if (!authenticateAdminToken(request)) {
    logSecurityEvent("admin_auth_failed", {
      remoteAddress: request.socket.remoteAddress ?? "unknown"
    });
    sendJson(response, 401, { error: "Unauthorized admin token." });
    return false;
  }
  return true;
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

function safeStaticPath(urlPathname) {
  if (LEGACY_HTML_REDIRECTS[urlPathname]) return null;
  const mapped = STATIC_ROUTES[urlPathname] ?? urlPathname.slice(1);
  if (!mapped) return null;
  const normalized = path.normalize(mapped).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!normalized) return null;
  const full = path.resolve(PUBLIC_DIR, normalized);
  if (!full.startsWith(PUBLIC_DIR)) return null;
  return full;
}

function tryServeStatic(response, urlPathname) {
  const full = safeStaticPath(urlPathname);
  if (!full) return false;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const ext = path.extname(full).toLowerCase();
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = fs.readFileSync(full);
  sendTyped(response, 200, mime, content);
  return true;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  response._requestId = crypto.randomUUID();
  response._requestPath = url.pathname;
  response._requestMethod = request.method;

  if (request.method === "OPTIONS") {
    response.writeHead(204, { ...CORS_HEADERS });
    return response.end();
  }

  if (LEGACY_HTML_REDIRECTS[url.pathname]) {
    response.writeHead(308, { Location: LEGACY_HTML_REDIRECTS[url.pathname] });
    return response.end();
  }

  if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/health" || url.pathname === "/healthz")) {
    return sendJson(response, 200, {
      ok: true,
      service: "agent-trust-registry",
      requestId: String(response._requestId),
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/plans") {
    const { owner, ...publicPlans } = PLANS;
    return sendJson(response, 200, { plans: publicPlans });
  }

  if (request.method === "GET" && url.pathname === "/v1/public/hero-snapshot") {
    return sendJson(response, 200, getHeroSnapshot());
  }

  if (request.method === "GET" && url.pathname === "/v1/integrations/templates") {
    return sendJson(response, 200, listIntegrationTemplates());
  }

  if (request.method === "GET" && url.pathname === "/v1/admin/overview") {
    if (!ensureAdminToken(request, response)) return;
    return sendJson(response, 200, getAdminOverview());
  }

  if (request.method === "GET" && url.pathname === "/v1/admin/agents") {
    if (!ensureAdminToken(request, response)) return;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    return sendJson(response, 200, getAdminAgentSnapshot({ limit }));
  }

  if (request.method === "GET" && url.pathname === "/v1/admin/decisions/recent") {
    if (!ensureAdminToken(request, response)) return;
    const limit = Number(url.searchParams.get("limit") ?? "100");
    return sendJson(response, 200, getRecentDecisionFeed({ limit }));
  }

  if (url.pathname === "/v1/admin/keys" || url.pathname === "/v1/admin/keys/rotate" || url.pathname === "/v1/admin/keys/revoke") {
    if (!ensureAdminToken(request, response)) return;

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

  if (request.method === "GET" && url.pathname.startsWith("/v1/upgrade/")) {
    const apiKey = url.pathname.split("/").pop();
    const tier = url.searchParams.get("tier") ?? "starter";
    try {
      const result = await handleUpgrade(apiKey, tier);
      if (result.body.checkoutUrl) {
        response.writeHead(302, {
          Location: result.body.checkoutUrl,
          ...CORS_HEADERS,
        });
        return response.end();
      }
      return sendJson(response, result.status, result.body);
    } catch {
      return sendJson(response, 500, { error: "Internal error." });
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/stripe/webhook") {
    try {
      const rawBody = await readRawBody(request);
      const sig = request.headers["stripe-signature"] ?? "";
      const result = await handleStripeWebhook(rawBody, sig);
      return sendJson(response, result.status, result.body);
    } catch {
      return sendJson(response, 400, { error: "Webhook processing failed." });
    }
  }

  if (request.method === "GET" && url.pathname === "/upgrade-success") {
    const html = `<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Upgrade complete</title></head><body style=\"font-family:system-ui,-apple-system,sans-serif;background:#faf7f2;color:#1f1a16;padding:48px;text-align:center\"><h1 style=\"margin:0 0 10px;color:#d4532a\">Upgrade complete</h1><p style=\"margin:0 0 14px\">Your plan was updated. New limits are active now.</p><a href=\"/\" style=\"display:inline-block;padding:10px 16px;border-radius:999px;background:#1a1612;color:#fff;text-decoration:none\">Back to home</a></body></html>`;
    return sendTyped(response, 200, "text/html; charset=utf-8", html);
  }

  if (request.method === "GET" && url.pathname === "/upgrade-cancel") {
    const html = `<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Upgrade canceled</title></head><body style=\"font-family:system-ui,-apple-system,sans-serif;background:#faf7f2;color:#1f1a16;padding:48px;text-align:center\"><h1 style=\"margin:0 0 10px\">Upgrade canceled</h1><p style=\"margin:0 0 14px\">No changes were made to your current plan.</p><a href=\"/\" style=\"display:inline-block;padding:10px 16px;border-radius:999px;border:1px solid #d8cfc6;color:#1a1612;text-decoration:none\">Back to home</a></body></html>`;
    return sendTyped(response, 200, "text/html; charset=utf-8", html);
  }

  if (!url.pathname.startsWith("/v1/")) {
    if ((request.method === "GET" || request.method === "HEAD") && tryServeStatic(response, url.pathname)) {
      return;
    }
    return sendJson(response, 404, { error: "Not Found" });
  }

  const account = authenticate(request);
  if (!account) {
    if (unauthRateLimited(request)) {
      logSecurityEvent("unauthorized_rate_limited", {
        remoteAddress: request.socket.remoteAddress ?? "unknown",
        path: url.pathname
      });
      return sendJson(response, 429, { error: "Too many unauthorized requests." });
    }
    logSecurityEvent("unauthorized_request", {
      remoteAddress: request.socket.remoteAddress ?? "unknown",
      path: url.pathname
    });
    return sendJson(response, 401, { error: "Unauthorized. Provide a valid x-api-key header." });
  }

  if (request.method === "GET" && url.pathname === "/v1/policy") {
    return sendJson(response, 200, { policy: getPolicy(account.apiKey) });
  }

  if (request.method === "GET" && url.pathname === "/v1/policy/presets") {
    return sendJson(response, 200, listPolicyPresets());
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/policy/presets/")) {
    const presetName = url.pathname.split("/").pop();
    try {
      const policy = applyPolicyPreset(account.apiKey, presetName);
      return sendJson(response, 200, { policy, presetApplied: presetName });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid policy preset.";
      return sendJson(response, 400, { error: message });
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/policy") {
    try {
      const payload = await readJsonBody(request);
      const policy = setPolicy(account.apiKey, payload);
      return sendJson(response, 200, { policy });
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      const message = error instanceof Error ? error.message : "Invalid policy payload.";
      return sendJson(response, 400, { error: message });
    }
  }

  if (request.method === "DELETE" && url.pathname === "/v1/policy") {
    const policy = resetPolicy(account.apiKey);
    return sendJson(response, 200, { policy, reset: true });
  }

  if (request.method === "POST" && url.pathname === "/v1/integrations/map-event") {
    try {
      const payload = await readJsonBody(request);
      const result = mapProviderEvent({
        source: payload.source,
        providerEventType: payload.providerEventType ?? payload.stripeEventType,
      });
      if (!result.ok) {
        return sendJson(response, 400, result);
      }
      return sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/integrations/readiness") {
    const source = String(url.searchParams.get("source") ?? "stripe").trim().toLowerCase();
    const templates = listIntegrationTemplates().templates;
    if (!templates[source]) {
      return sendJson(response, 400, {
        error: "Unsupported source.",
        supportedSources: Object.keys(templates),
      });
    }
    const ingest = getIngestSecretStatus(account);
    const policy = getPolicy(account.apiKey);
    const minSignalQuality = Number(policy.minSignalQuality ?? 0);
    const requireVerifiedSensitive = policy.requireVerifiedSensitive === true;
    const recommendedBySource = {
      stripe: 40,
      auth: 45,
      marketplace: 50,
      wallet: 65,
      prediction_market: 60,
      runtime: 55,
    };
    const recommendedMinSignalQuality = recommendedBySource[source] ?? 40;
    const ready = ingest.configured && requireVerifiedSensitive && minSignalQuality >= recommendedMinSignalQuality;

    const checklist = [
      {
        key: "ingest_secret",
        label: "Ingest secret configured",
        ok: ingest.configured,
        action: "POST /v1/integrations/ingest/secret",
      },
      {
        key: "verified_guardrail",
        label: "Verified sensitive guardrail enabled",
        ok: requireVerifiedSensitive,
        action: 'POST /v1/policy {"requireVerifiedSensitive":true}',
      },
      {
        key: "signal_quality_floor",
        label: `Minimum signal quality >= ${recommendedMinSignalQuality}`,
        ok: minSignalQuality >= recommendedMinSignalQuality,
        action: `POST /v1/policy {"minSignalQuality":${recommendedMinSignalQuality}}`,
      },
    ];

    return sendJson(response, 200, {
      source,
      ready,
      template: templates[source],
      ingest,
      policy: {
        minSignalQuality,
        requireVerifiedSensitive,
      },
      recommended: {
        minSignalQuality: recommendedMinSignalQuality,
        requireVerifiedSensitive: true,
      },
      checklist,
      next: ready
        ? "Ready to ingest signed events."
        : "Complete failed checklist items, then start signed ingest events.",
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/integrations/ingest/secret") {
    const rotated = rotateIngestSecret(account);
    return sendJson(response, 200, {
      message: "Ingest secret rotated. Store it securely in your integration provider.",
      ingestSecret: rotated.ingestSecret,
      rotatedAt: rotated.rotatedAt,
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/integrations/ingest/events") {
    try {
      const rawBody = await readRawBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const signature = request.headers["x-ingest-signature"] ?? "";
      const timestamp = request.headers["x-ingest-timestamp"] ?? "";
      const result = await ingestVerifiedEvent({
        account,
        payload,
        rawBody,
        signature,
        timestamp,
      });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
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
    const includeTrace =
      String(url.searchParams.get("includeTrace") ?? "").trim().toLowerCase() === "true" ||
      String(url.searchParams.get("trace") ?? "").trim() === "1";

    const result = getScore({ account, agentId: url.searchParams.get("agentId"), includeTrace });

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

  if (request.method === "GET" && url.pathname === "/v1/usage") {
    const result = getUsageSnapshot({ account });
    return sendJson(response, result.status, result.body);
  }

  if (request.method === "POST" && url.pathname === "/v1/attestations") {
    try {
      const payload = await readJsonBody(request);
      const result = issueAttestation({ account, payload });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/attestations") {
    const result = listAttestations({
      account,
      query: Object.fromEntries(url.searchParams.entries()),
    });
    return sendJson(response, result.status, result.body);
  }

  if (request.method === "POST" && url.pathname === "/v1/attestations/verify") {
    try {
      const payload = await readJsonBody(request);
      const result = verifyAttestationToken({ token: payload.token });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/attestations/") && url.pathname.endsWith("/revoke")) {
    const parts = url.pathname.split("/");
    const attestationId = parts[3] ?? "";
    try {
      const payload = await readJsonBody(request);
      const result = revokeAttestation({
        account,
        attestationId,
        reason: payload.reason,
      });
      return sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/keys/rotate") {
    const result = rotateUserApiKey(account.apiKey);
    if (!result.ok) {
      return sendJson(response, 400, { error: result.error });
    }
    return sendJson(response, 200, {
      message: "API key rotated. Use the new key immediately; the old key is invalid.",
      apiKey: result.apiKey,
      tier: result.tier,
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/keys/revoke") {
    try {
      const payload = await readJsonBody(request);
      if (payload.confirm !== "REVOKE") {
        return sendJson(response, 400, {
          error: 'Set {"confirm":"REVOKE"} to confirm key revocation.',
        });
      }
      const result = revokeUserApiKey(account.apiKey);
      if (!result.ok) {
        return sendJson(response, 400, { error: result.error });
      }
      return sendJson(response, 200, {
        message: "API key revoked. Create a new key from the signup flow to continue.",
        revoked: true,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Payload too large") {
        return sendJson(response, 413, { error: "Payload too large." });
      }
      return sendJson(response, 400, { error: "Invalid JSON body." });
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/audit/decisions") {
    const result = getDecisionLogs({
      account,
      query: Object.fromEntries(url.searchParams.entries())
    });

    if (result.type === "text/csv; charset=utf-8") {
      return sendTyped(response, result.status, result.type, result.body, {
        "content-disposition": `attachment; filename="${result.filename}"`
      });
    }

    return sendJson(response, result.status, result.body);
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
