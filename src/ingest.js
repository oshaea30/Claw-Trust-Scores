import crypto from "node:crypto";

import { STRIPE_EVENT_TEMPLATE } from "./config.js";
import { scheduleFlush } from "./persistence.js";
import { postEvent } from "./service.js";
import { store } from "./store.js";

const INGEST_TTL_MS = 24 * 60 * 60 * 1000;
const INGEST_MAX_CLOCK_SKEW_SECONDS = 300;

function ensureIngestStores() {
  if (!store.inboundSecretsByApiKey) store.inboundSecretsByApiKey = new Map();
  if (!store.processedInboundEvents) store.processedInboundEvents = new Map();
}

function normalizeSource(source) {
  return String(source ?? "").trim().toLowerCase();
}

function normalizeEventId(eventId) {
  return String(eventId ?? "").trim();
}

function normalizeSignature(input) {
  const value = String(input ?? "").trim();
  if (!value) return "";
  if (value.startsWith("sha256=")) return value.slice("sha256=".length);
  return value;
}

function parseTimestampSeconds(input) {
  const value = Number(String(input ?? "").trim());
  if (!Number.isFinite(value)) return null;
  return Math.floor(value);
}

function timingSafeHexEqual(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length === 0 || bBuf.length === 0 || aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function pruneProcessedInbound(nowMs = Date.now()) {
  ensureIngestStores();
  for (const [key, ts] of store.processedInboundEvents.entries()) {
    if (nowMs - Number(ts) > INGEST_TTL_MS) {
      store.processedInboundEvents.delete(key);
    }
  }
}

function markProcessedInbound({ apiKey, source, eventId, nowMs = Date.now() }) {
  ensureIngestStores();
  pruneProcessedInbound(nowMs);
  const key = `${apiKey}:${source}:${eventId}`;
  if (store.processedInboundEvents.has(key)) {
    return { duplicate: true };
  }
  store.processedInboundEvents.set(key, nowMs);
  return { duplicate: false };
}

function generateIngestSecret() {
  return `ingest_${crypto.randomBytes(24).toString("hex")}`;
}

export function rotateIngestSecret(account) {
  ensureIngestStores();
  const secret = generateIngestSecret();
  const now = new Date().toISOString();
  const previous = store.inboundSecretsByApiKey.get(account.apiKey);

  store.inboundSecretsByApiKey.set(account.apiKey, {
    secret,
    createdAt: previous?.createdAt ?? now,
    rotatedAt: now,
  });
  scheduleFlush();

  return {
    ingestSecret: secret,
    rotatedAt: now,
  };
}

function verifyInboundSignature({ apiKey, rawBody, signature, timestamp }) {
  ensureIngestStores();
  const record = store.inboundSecretsByApiKey.get(apiKey);
  if (!record?.secret) {
    return {
      ok: false,
      status: 403,
      error: "Ingest secret not configured. Call POST /v1/integrations/ingest/secret first.",
    };
  }

  const ts = parseTimestampSeconds(timestamp);
  if (!ts) {
    return { ok: false, status: 400, error: "Missing or invalid x-ingest-timestamp header." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > INGEST_MAX_CLOCK_SKEW_SECONDS) {
    return {
      ok: false,
      status: 401,
      error: "Signature timestamp expired or too far in the future.",
    };
  }

  const normalizedSig = normalizeSignature(signature);
  if (!normalizedSig) {
    return { ok: false, status: 400, error: "Missing x-ingest-signature header." };
  }

  const expected = crypto
    .createHmac("sha256", record.secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");

  if (!timingSafeHexEqual(expected, normalizedSig)) {
    return { ok: false, status: 401, error: "Invalid ingest signature." };
  }

  return { ok: true };
}

function confidenceForPayload(payload) {
  const provided = Number(payload.confidence);
  if (Number.isFinite(provided)) {
    return Math.max(0, Math.min(1, provided));
  }
  return payload.verified === true ? 0.95 : 0.8;
}

function mapStripePayload(payload) {
  const providerType = String(
    payload.providerEventType ?? payload.stripeEventType ?? ""
  )
    .trim()
    .toLowerCase();

  if (!providerType) return { ok: true, payload };

  const mapped = STRIPE_EVENT_TEMPLATE[providerType];
  if (!mapped && (!payload.kind || !payload.eventType)) {
    return {
      ok: false,
      error:
        "Unsupported stripeEventType/providerEventType. Provide kind+eventType or use a supported Stripe event type.",
      metadata: { providerType, supported: Object.keys(STRIPE_EVENT_TEMPLATE) },
    };
  }

  const detailsParts = [];
  if (providerType) detailsParts.push(`stripe:${providerType}`);
  if (Number.isFinite(Number(payload.amountUsd))) {
    detailsParts.push(`amountUsd=${Number(payload.amountUsd)}`);
  }
  if (payload.currency) detailsParts.push(`currency=${String(payload.currency).toUpperCase()}`);
  if (payload.chargeId) detailsParts.push(`chargeId=${String(payload.chargeId)}`);
  if (payload.paymentIntentId) detailsParts.push(`paymentIntentId=${String(payload.paymentIntentId)}`);

  return {
    ok: true,
    payload: {
      ...payload,
      kind: payload.kind ?? mapped?.kind,
      eventType: payload.eventType ?? mapped?.eventType,
      confidence:
        payload.confidence ??
        mapped?.confidence ??
        payload.confidence,
      details: payload.details ?? (detailsParts.length ? detailsParts.join(" | ") : undefined),
      providerEventType: providerType || undefined,
    },
  };
}

export async function ingestVerifiedEvent({
  account,
  payload,
  rawBody,
  signature,
  timestamp,
}) {
  const verify = verifyInboundSignature({
    apiKey: account.apiKey,
    rawBody,
    signature,
    timestamp,
  });
  if (!verify.ok) {
    return { status: verify.status, body: { error: verify.error } };
  }

  const source = normalizeSource(payload.source);
  const eventId = normalizeEventId(payload.eventId);
  if (!source) {
    return { status: 400, body: { error: "source is required." } };
  }
  if (!eventId) {
    return { status: 400, body: { error: "eventId is required." } };
  }

  let normalizedPayload = { ...payload };
  if (source === "stripe") {
    const mapped = mapStripePayload(normalizedPayload);
    if (!mapped.ok) {
      return { status: 400, body: { error: mapped.error, ...mapped.metadata } };
    }
    normalizedPayload = mapped.payload;
  }

  const processed = markProcessedInbound({ apiKey: account.apiKey, source, eventId });
  if (processed.duplicate) {
    return {
      status: 200,
      body: {
        accepted: true,
        duplicate: true,
        message: "Duplicate inbound event ignored.",
      },
    };
  }

  const result = await postEvent({
    account,
    payload: {
      agentId: normalizedPayload.agentId,
      kind: normalizedPayload.kind,
      eventType: normalizedPayload.eventType,
      details: normalizedPayload.details,
      occurredAt: normalizedPayload.occurredAt,
      source,
      sourceType: "verified_integration",
      confidence: confidenceForPayload(normalizedPayload),
      externalEventId: eventId,
    },
  });

  if (result.status >= 400) return result;

  return {
    status: 201,
    body: {
      accepted: true,
      duplicate: false,
      source,
      eventId,
      event: result.body.event,
      score: result.body.score,
    },
  };
}
