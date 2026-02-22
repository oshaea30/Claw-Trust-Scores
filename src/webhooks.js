import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";

import { appendWebhookDelivery, listWebhooks, putWebhooks, store } from "./store.js";
import { scheduleFlush } from "./persistence.js";
import { logSecurityEvent } from "./security-log.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

const WEBHOOK_TIMEOUT_MS = 5000;
const WEBHOOK_COOLDOWN_MS = 60 * 60 * 1000;
let dnsLookup = dns.lookup;

function isPrivateIpv4(host) {
  const parts = host.split(".").map((value) => Number(value));
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  return false;
}

function isPrivateIpv6(host) {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase();
  if (!host) return true;

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "host.docker.internal") {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return isPrivateIpv4(host);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(host);
  }

  return false;
}

function parseWebhookUrl(input) {
  try {
    const parsed = new URL(input);
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return null;
    }

    if (isBlockedHostname(parsed.hostname)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function sign(secret, bodyString) {
  return crypto.createHmac("sha256", secret).update(bodyString).digest("hex");
}

async function resolvesToBlockedAddress(hostname) {
  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return true;
    }

    return addresses.some((entry) => isBlockedHostname(entry.address));
  } catch {
    return true;
  }
}

export function setDnsLookupForTest(fn) {
  dnsLookup = fn;
}

export function resetDnsLookupForTest() {
  dnsLookup = dns.lookup;
}

export function createWebhook({ account, payload }) {
  if (account.tier === "free") {
    return { status: 403, body: { error: "Webhooks are available on Starter and Pro only." } };
  }

  const urlRaw = String(payload.url ?? "").trim();
  const parsedUrl = parseWebhookUrl(urlRaw);
  const threshold = Number(payload.threshold);
  const secret = String(payload.secret ?? "").trim();

  if (!parsedUrl) {
    return {
      status: 400,
      body: {
        error: "url is required and must be a valid public http/https URL (localhost/private network blocked)."
      }
    };
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    return { status: 400, body: { error: "threshold is required and must be a number between 0 and 100." } };
  }

  if (!secret || secret.length < 8) {
    return { status: 400, body: { error: "secret is required and must be at least 8 chars." } };
  }

  const webhooks = listWebhooks(account.apiKey);
  if (webhooks.length >= 20) {
    return { status: 402, body: { error: "Webhook limit reached (20 per API key)." } };
  }

  const webhook = {
    id: crypto.randomUUID(),
    url: parsedUrl.toString(),
    threshold: Math.round(threshold),
    secret: encryptSecret(secret),
    createdAt: new Date().toISOString(),
    enabled: true
  };

  putWebhooks(account.apiKey, [...webhooks, webhook]);
  scheduleFlush();
  const { secret: _secret, ...safeWebhook } = webhook;
  return { status: 201, body: { webhook: safeWebhook } };
}

export function getWebhooks({ account }) {
  const webhooks = listWebhooks(account.apiKey).map((webhook) => {
    const { secret: _secret, ...safeWebhook } = webhook;
    return {
      ...safeWebhook,
      deliveries: store.webhookDeliveries.get(webhook.id) ?? []
    };
  });

  return { status: 200, body: { webhooks } };
}

export function deleteWebhook({ account, webhookId }) {
  const webhooks = listWebhooks(account.apiKey);
  const updated = webhooks.filter((webhook) => webhook.id !== webhookId);

  if (updated.length === webhooks.length) {
    return { status: 404, body: { error: "Webhook not found." } };
  }

  putWebhooks(account.apiKey, updated);
  scheduleFlush();
  return { status: 200, body: { deleted: true } };
}

async function postWebhook(webhook, bodyString, signature) {
  const targetHost = new URL(webhook.url).hostname;
  if (await resolvesToBlockedAddress(targetHost)) {
    logSecurityEvent("webhook_target_blocked", { webhookId: webhook.id, host: targetHost });
    return {
      ok: false,
      status: 0,
      error: "Blocked webhook target (resolves to non-public address)."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  const sentAt = new Date().toISOString();

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trust-signature": signature,
        "x-trust-webhook-id": webhook.id,
        "x-trust-sent-at": sentAt
      },
      body: bodyString,
      signal: controller.signal,
      redirect: "error"
    });

    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "unknown error"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function emitScoreAlerts({ account, agentId, score, previousScore }) {
  if (account.tier === "free") return;

  const webhooks = listWebhooks(account.apiKey).filter((webhook) => webhook.enabled);
  if (webhooks.length === 0) return;

  for (const webhook of webhooks) {
    const crossedDown = previousScore > webhook.threshold && score <= webhook.threshold;
    if (!crossedDown) continue;

    const suppressionKey = `${webhook.id}:${agentId}`;
    const now = Date.now();
    const suppressedUntil = Number(store.webhookSuppression.get(suppressionKey) ?? 0);
    if (now < suppressedUntil) {
      continue;
    }

    const body = {
      event: "trust.score_below_threshold",
      sentAt: new Date(now).toISOString(),
      webhookId: webhook.id,
      threshold: webhook.threshold,
      agentId,
      score,
      previousScore
    };

    const bodyString = JSON.stringify(body);
    let secret;
    try {
      secret = decryptSecret(webhook.secret);
    } catch {
      appendWebhookDelivery(webhook.id, {
        sentAt: body.sentAt,
        agentId,
        score,
        status: 0,
        ok: false,
        error: "Webhook secret decryption failed."
      });
      scheduleFlush();
      continue;
    }

    const signature = sign(secret, bodyString);
    const delivery = await postWebhook(webhook, bodyString, signature);

    appendWebhookDelivery(webhook.id, {
      sentAt: body.sentAt,
      agentId,
      score,
      status: delivery.status,
      ok: delivery.ok,
      error: delivery.error
    });

    store.webhookSuppression.set(suppressionKey, now + WEBHOOK_COOLDOWN_MS);
    scheduleFlush();
  }
}
