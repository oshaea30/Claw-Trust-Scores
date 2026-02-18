import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getMonthKey, getUsage, resetStore } from "../src/store.js";
import { getScore, postEvent } from "../src/service.js";
import {
  flushStoreToDisk,
  getPersistenceStatePath,
  loadStoreFromDisk,
  resetPersistenceStateForTest
} from "../src/persistence.js";
import { createWebhook } from "../src/webhooks.js";

beforeEach(() => {
  resetStore();
  resetPersistenceStateForTest();
});

test("free plan limit errors include upgrade guidance", async () => {
  const freeAccount = { apiKey: "demo_free_key", tier: "free" };
  const usage = getUsage(getMonthKey(), freeAccount.apiKey);

  usage.eventsLogged = 100;
  const eventLimit = await postEvent({
    account: freeAccount,
    payload: {
      agentId: "agent:quota:event",
      kind: "positive",
      eventType: "completed_task_on_time"
    }
  });
  assert.equal(eventLimit.status, 402);
  assert.match(eventLimit.body.error, /Free plan limit hit: 100 events\/month exceeded\. Upgrade to Starter\./);

  usage.scoreChecks = 200;
  const checkLimit = getScore({ account: freeAccount, agentId: "agent:quota:event" });
  assert.equal(checkLimit.status, 402);
  assert.match(checkLimit.body.error, /Free plan limit hit: 200 score checks\/month exceeded\. Upgrade to Starter\./);
});

test("state persists across reload and reloads score/history", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-registry-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;

  try {
    const account = { apiKey: "demo_starter_key", tier: "starter" };
    await postEvent({
      account,
      payload: {
        agentId: "agent:persist:1",
        kind: "positive",
        eventType: "completed_task_on_time",
        details: "persist me"
      }
    });

    flushStoreToDisk();
    const statePath = getPersistenceStatePath();
    assert.equal(fs.existsSync(statePath), true);

    resetStore();
    resetPersistenceStateForTest();
    loadStoreFromDisk();

    const score = getScore({ account, agentId: "agent:persist:1" });
    assert.equal(score.status, 200);
    assert.equal(score.body.breakdown.lifetimeEvents, 1);
    assert.equal(score.body.history[0].details, "persist me");
  } finally {
    process.env.DATA_DIR = previousDataDir;
  }
});

test("webhook fires once on downward crossing and includes valid signature", async () => {
  const secret = "supersecret123";
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204 };
  };

  try {
    const account = { apiKey: "demo_starter_key", tier: "starter" };
    const webhook = createWebhook({
      account,
      payload: {
        url: "https://example.com/hook",
        threshold: 50,
        secret
      }
    });
    assert.equal(webhook.status, 201);

    await postEvent({
      account,
      payload: {
        agentId: "agent:webhook:1",
        kind: "positive",
        eventType: "completed_task_on_time",
        details: "score above threshold"
      }
    });

    await postEvent({
      account,
      payload: {
        agentId: "agent:webhook:1",
        kind: "negative",
        eventType: "api_key_leak",
        details: "score below threshold"
      }
    });

    assert.equal(calls.length, 1);
    const firstCall = calls[0];
    const rawBody = firstCall.options.body;
    const sentSig = firstCall.options.headers["x-trust-signature"];
    const expectedSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    assert.equal(sentSig, expectedSig);

    const payload = JSON.parse(rawBody);
    assert.equal(payload.event, "trust.score_below_threshold");
    assert.equal(payload.agentId, "agent:webhook:1");
    assert.equal(payload.threshold, 50);

    await postEvent({
      account,
      payload: {
        agentId: "agent:webhook:1",
        kind: "negative",
        eventType: "abuse_report",
        details: "still below threshold"
      }
    });

    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
