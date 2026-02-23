import crypto from "node:crypto";

import { scheduleFlush } from "./persistence.js";
import { store } from "./store.js";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeAgentId(input) {
  return String(input ?? "").trim().toLowerCase();
}

function normalizeType(input) {
  return String(input ?? "").trim().toLowerCase();
}

function isValidType(type) {
  return /^[a-z0-9._:-]{2,64}$/.test(type);
}

function base64urlEncode(value) {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return raw
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + "=".repeat(4 - pad);
  return Buffer.from(padded, "base64").toString("utf8");
}

function signingSecret() {
  const raw =
    process.env.ATTESTATION_SIGNING_KEY?.trim() ||
    process.env.DATA_ENCRYPTION_KEY?.trim() ||
    process.env.TRUST_API_KEYS?.trim() ||
    "local-attestation-dev-secret";
  return crypto.createHash("sha256").update(raw).digest();
}

function signCompactJws(header, payload) {
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", signingSecret()).update(input).digest();
  return `${input}.${base64urlEncode(signature)}`;
}

function timingSafeHexEquals(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCompactJws(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "Invalid token format." };
  }
  try {
    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
    const header = JSON.parse(base64urlDecode(headerEncoded));
    const payload = JSON.parse(base64urlDecode(payloadEncoded));
    const signed = `${headerEncoded}.${payloadEncoded}`;
    const expectedSig = base64urlEncode(crypto.createHmac("sha256", signingSecret()).update(signed).digest());
    const signatureValid = timingSafeHexEquals(expectedSig, signatureEncoded);
    return { ok: true, header, payload, signatureValid };
  } catch {
    return { ok: false, error: "Invalid token encoding." };
  }
}

function listForApiKey(apiKey) {
  const existing = store.attestationsByApiKey.get(apiKey);
  if (existing) return existing;
  const next = [];
  store.attestationsByApiKey.set(apiKey, next);
  return next;
}

function currentStatus(attestation) {
  if (attestation.status === "revoked") return "revoked";
  if (attestation.expiresAt && Date.parse(attestation.expiresAt) <= Date.now()) return "expired";
  return "active";
}

function sanitizeClaims(claims) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return {};
  const entries = Object.entries(claims).slice(0, 20);
  const out = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z0-9._:-]{1,40}$/.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 240);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function issueAttestation({ account, payload }) {
  const agentId = normalizeAgentId(payload.agentId);
  const type = normalizeType(payload.type);
  const ttlDaysRaw = Number(payload.ttlDays ?? 90);
  const ttlDays = Number.isFinite(ttlDaysRaw) ? Math.max(1, Math.min(365, Math.floor(ttlDaysRaw))) : 90;

  if (!agentId) return { status: 400, body: { error: "agentId is required." } };
  if (!type || !isValidType(type)) {
    return { status: 400, body: { error: "type is required and must match [a-z0-9._:-]{2,64}." } };
  }

  const issuedAtEpoch = nowSeconds();
  const expiresAtEpoch = issuedAtEpoch + ttlDays * 24 * 60 * 60;
  const issuedAt = new Date(issuedAtEpoch * 1000).toISOString();
  const expiresAt = new Date(expiresAtEpoch * 1000).toISOString();
  const attestationId = crypto.randomUUID();
  const claims = sanitizeClaims(payload.claims);

  const issuer = String(payload.issuer ?? process.env.BASE_URL ?? "https://clawtrustscores.com")
    .trim()
    .slice(0, 180);

  const tokenPayload = {
    iss: issuer,
    aud: "clawtrustscores.com",
    sub: agentId,
    typ: type,
    iat: issuedAtEpoch,
    exp: expiresAtEpoch,
    jti: attestationId,
    claims,
  };
  const tokenHeader = {
    alg: "HS256",
    typ: "ATR-ATTESTATION",
    kid: "v1",
  };
  const token = signCompactJws(tokenHeader, tokenPayload);

  const attestation = {
    id: attestationId,
    agentId,
    type,
    claims,
    issuer,
    issuedAt,
    expiresAt,
    status: "active",
    token,
    createdByApiKey: account.apiKey,
  };

  const list = listForApiKey(account.apiKey);
  list.unshift(attestation);
  store.attestationsByApiKey.set(account.apiKey, list.slice(0, 5000));
  scheduleFlush();

  return {
    status: 201,
    body: {
      attestation: {
        id: attestation.id,
        agentId: attestation.agentId,
        type: attestation.type,
        claims: attestation.claims,
        issuer: attestation.issuer,
        issuedAt: attestation.issuedAt,
        expiresAt: attestation.expiresAt,
        status: attestation.status,
      },
      token,
    },
  };
}

export function listAttestations({ account, query }) {
  const agentIdFilter = normalizeAgentId(query.agentId ?? "");
  const typeFilter = normalizeType(query.type ?? "");
  const statusFilter = normalizeType(query.status ?? "");
  const includeToken = String(query.includeToken ?? "").trim().toLowerCase() === "true";
  const rawLimit = Number(query.limit ?? 100);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 100;

  const list = listForApiKey(account.apiKey)
    .map((entry) => ({
      ...entry,
      status: currentStatus(entry),
    }))
    .filter((entry) => (agentIdFilter ? entry.agentId === agentIdFilter : true))
    .filter((entry) => (typeFilter ? entry.type === typeFilter : true))
    .filter((entry) => (statusFilter ? entry.status === statusFilter : true))
    .slice(0, limit)
    .map((entry) => {
      if (includeToken) return entry;
      const { token, createdByApiKey, ...safe } = entry;
      return safe;
    });

  return {
    status: 200,
    body: {
      attestations: list,
      count: list.length,
    },
  };
}

export function revokeAttestation({ account, attestationId, reason }) {
  const id = String(attestationId ?? "").trim();
  if (!id) return { status: 400, body: { error: "attestationId is required." } };

  const list = listForApiKey(account.apiKey);
  const found = list.find((entry) => entry.id === id);
  if (!found) return { status: 404, body: { error: "Attestation not found." } };

  found.status = "revoked";
  found.revokedAt = new Date().toISOString();
  found.revokeReason = String(reason ?? "revoked_by_owner").slice(0, 120);
  scheduleFlush();

  return {
    status: 200,
    body: {
      revoked: true,
      attestation: {
        id: found.id,
        agentId: found.agentId,
        type: found.type,
        status: found.status,
        revokedAt: found.revokedAt,
        revokeReason: found.revokeReason,
      },
    },
  };
}

function findAttestationById(jti) {
  for (const [apiKey, entries] of store.attestationsByApiKey.entries()) {
    const found = entries.find((entry) => entry.id === jti);
    if (found) return { apiKey, attestation: found };
  }
  return null;
}

export function verifyAttestationToken({ token }) {
  const parsed = parseCompactJws(token);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  if (!parsed.signatureValid) return { status: 400, body: { error: "Invalid attestation signature." } };

  const payload = parsed.payload ?? {};
  const attestationId = String(payload.jti ?? "").trim();
  if (!attestationId) {
    return { status: 400, body: { error: "Attestation token missing jti." } };
  }

  const found = findAttestationById(attestationId);
  if (!found) {
    return { status: 404, body: { error: "Attestation not found." } };
  }

  const status = currentStatus(found.attestation);
  const now = nowSeconds();
  const tokenExpired = Number(payload.exp ?? 0) > 0 && now >= Number(payload.exp);

  return {
    status: 200,
    body: {
      valid: !tokenExpired && status === "active",
      signatureValid: true,
      status,
      tokenExpired,
      attestation: {
        id: found.attestation.id,
        agentId: found.attestation.agentId,
        type: found.attestation.type,
        claims: found.attestation.claims,
        issuer: found.attestation.issuer,
        issuedAt: found.attestation.issuedAt,
        expiresAt: found.attestation.expiresAt,
        revokedAt: found.attestation.revokedAt,
      },
      tokenClaims: payload,
    },
  };
}
