import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createUser,
  getKeyTier,
  revokeUserApiKey,
  rotateUserApiKey,
} from "../src/key-store.js";
import { appendDecisionLog, getMonthKey, getUsage, putWebhooks, resetStore, store } from "../src/store.js";

beforeEach(() => {
  resetStore();
});

test("rotateUserApiKey migrates account data and invalidates old key", () => {
  const created = createUser("rotate@test.com");
  assert.equal(created.exists, false);
  const oldKey = created.apiKey;
  const monthKey = getMonthKey();
  const usage = getUsage(monthKey, oldKey);
  usage.eventsLogged = 3;
  usage.scoreChecks = 5;
  usage.trackedAgents.add("agent:1");

  putWebhooks(oldKey, [{ id: "hook-1", url: "https://example.com", threshold: 50, secret: "12345678", enabled: true }]);
  appendDecisionLog(oldKey, { action: "score_check", agentId: "agent:1", outcome: "scored", score: 70, reason: "ok" });

  const rotated = rotateUserApiKey(oldKey);
  assert.equal(rotated.ok, true);
  const newKey = rotated.apiKey;

  assert.equal(getKeyTier(oldKey), null);
  assert.equal(getKeyTier(newKey), "free");
  assert.equal(store.webhooksByApiKey.has(oldKey), false);
  assert.equal(store.webhooksByApiKey.has(newKey), true);
  assert.equal(store.decisionLogsByApiKey.has(oldKey), false);
  assert.equal(store.decisionLogsByApiKey.has(newKey), true);
  assert.equal(store.usageByMonthAndApiKey.has(`${monthKey}:${oldKey}`), false);
  assert.equal(store.usageByMonthAndApiKey.has(`${monthKey}:${newKey}`), true);
});

test("revokeUserApiKey removes user and key-scoped data", () => {
  const created = createUser("revoke@test.com");
  const apiKey = created.apiKey;
  const monthKey = getMonthKey();
  const usage = getUsage(monthKey, apiKey);
  usage.eventsLogged = 1;

  putWebhooks(apiKey, [{ id: "hook-2", url: "https://example.com", threshold: 40, secret: "12345678", enabled: true }]);
  store.webhookDeliveries.set("hook-2", [{ ok: true }]);
  store.webhookSuppression.set("hook-2:agent:1", Date.now() + 10000);
  appendDecisionLog(apiKey, { action: "score_check", agentId: "agent:1", outcome: "scored", score: 44, reason: "ok" });

  const revoked = revokeUserApiKey(apiKey);
  assert.equal(revoked.ok, true);
  assert.equal(getKeyTier(apiKey), null);
  assert.equal(store.users.has(apiKey), false);
  assert.equal(store.webhooksByApiKey.has(apiKey), false);
  assert.equal(store.decisionLogsByApiKey.has(apiKey), false);
  assert.equal(store.usageByMonthAndApiKey.has(`${monthKey}:${apiKey}`), false);
  assert.equal(store.webhookDeliveries.has("hook-2"), false);
  assert.equal(store.webhookSuppression.has("hook-2:agent:1"), false);
});
