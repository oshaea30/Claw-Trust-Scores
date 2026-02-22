import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { authenticate } from "../src/auth.js";
import { resetStore } from "../src/store.js";
import { createWebhook, emitScoreAlerts, resetDnsLookupForTest, setDnsLookupForTest } from "../src/webhooks.js";

beforeEach(() => {
  resetStore();
  delete process.env.NODE_ENV;
  delete process.env.TRUST_API_KEYS;
});

test("production mode requires explicit TRUST_API_KEYS", () => {
  process.env.NODE_ENV = "production";
  delete process.env.TRUST_API_KEYS;

  const account = authenticate({ headers: { "x-api-key": "demo_starter_key" } });
  assert.equal(account, null);
});

test("development mode allows demo keys for local testing", () => {
  const account = authenticate({ headers: { "x-api-key": "demo_starter_key" } });
  assert.equal(account.tier, "starter");
});

test("webhook URL rejects localhost and private network targets", () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };

  const localhost = createWebhook({
    account,
    payload: {
      url: "http://localhost:8081/hook",
      threshold: 50,
      secret: "supersecret123"
    }
  });
  assert.equal(localhost.status, 400);

  const privateIp = createWebhook({
    account,
    payload: {
      url: "http://192.168.1.10/hook",
      threshold: 50,
      secret: "supersecret123"
    }
  });
  assert.equal(privateIp.status, 400);

  const publicUrl = createWebhook({
    account,
    payload: {
      url: "https://example.com/hook",
      threshold: 50,
      secret: "supersecret123"
    }
  });
  assert.equal(publicUrl.status, 201);
});

test("webhook delivery blocks DNS targets that resolve to private IPs", async () => {
  const originalFetch = globalThis.fetch;
  const account = { apiKey: "demo_starter_key", tier: "starter" };

  setDnsLookupForTest(async () => [{ address: "127.0.0.1", family: 4 }]);
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200 };
  };

  try {
    const created = createWebhook({
      account,
      payload: {
        url: "https://example.com/hook",
        threshold: 50,
        secret: "supersecret123"
      }
    });
    assert.equal(created.status, 201);

    await emitScoreAlerts({
      account,
      agentId: "agent:ssrf:test",
      previousScore: 80,
      score: 40
    });

    assert.equal(fetchCalled, false);
  } finally {
    resetDnsLookupForTest();
    globalThis.fetch = originalFetch;
  }
});
