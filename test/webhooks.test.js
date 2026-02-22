import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { resetStore, store } from "../src/store.js";
import { createWebhook } from "../src/webhooks.js";

beforeEach(() => {
  resetStore();
});

test("free tier cannot create webhook", () => {
  const result = createWebhook({
    account: { apiKey: "demo_free_key", tier: "free" },
    payload: {
      url: "https://example.com/hook",
      threshold: 50,
      secret: "supersecret"
    }
  });

  assert.equal(result.status, 403);
});

test("starter tier can create webhook", () => {
  const result = createWebhook({
    account: { apiKey: "demo_starter_key", tier: "starter" },
    payload: {
      url: "https://example.com/hook",
      threshold: 50,
      secret: "supersecret"
    }
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.webhook.threshold, 50);
});

test("webhook secret is encrypted at rest", () => {
  const plainSecret = "supersecret";
  const result = createWebhook({
    account: { apiKey: "demo_starter_key", tier: "starter" },
    payload: {
      url: "https://example.com/hook",
      threshold: 50,
      secret: plainSecret
    }
  });

  assert.equal(result.status, 201);
  const stored = store.webhooksByApiKey.get("demo_starter_key");
  assert.equal(Array.isArray(stored), true);
  assert.ok(stored[0].secret.startsWith("enc:v1:"));
  assert.notEqual(stored[0].secret, plainSecret);
});
