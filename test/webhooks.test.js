import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { resetStore } from "../src/store.js";
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
