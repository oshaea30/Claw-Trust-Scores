import crypto from "node:crypto";

import { appendWebhookDelivery, listWebhooks, putWebhooks, store } from "./store.js";
import { scheduleFlush } from "./persistence.js";

const WEBHOOK_TIMEOUT_MS = 5000;
const WEBHOOK_COOLDOWN_MS = 60 * 60 * 1000;

function isValidHttpUrl(input) {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sign(secret, bodyString) {
  return crypto.createHmac("sha256", secret).update(bodyString).digest("hex");
}

export function createWebhook({ account, payload }) {
  if (account.tier === "free") {
    return { status: 403, body: { error: "Webhooks are available on Starter and Pro only." } };
  }

  const url = String(payload.url ?? "").trim();
  const threshold = Number(payload.threshold);
  const secret = String(payload.secret ?? "").trim();

  if (!url || !isValidHttpUrl(url)) {
    return { status: 400, body: { error: "url is required and must be a valid http/https URL." } };
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
    url,
    threshold: Math.round(threshold),
    secret,
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trust-signature": signature,
        "x-trust-webhook-id": webhook.id
      },
      body: bodyString,
      signal: controller.signal
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
    const signature = sign(webhook.secret, bodyString);
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
