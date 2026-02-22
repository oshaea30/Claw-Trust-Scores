import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getAdminAgentSnapshot, getAdminOverview, getRecentDecisionFeed } from "../src/admin.js";
import { createUser, upgradeTier } from "../src/key-store.js";
import { appendDecisionLog, appendEvent, putWebhooks, resetStore } from "../src/store.js";

beforeEach(() => {
  resetStore();
});

test("admin overview returns aggregate totals and recent users", () => {
  const u1 = createUser("a@test.com");
  const u2 = createUser("b@test.com");
  upgradeTier(u2.apiKey, "starter");
  putWebhooks(u2.apiKey, [{ id: "hook-admin", url: "https://example.com", threshold: 60, secret: "12345678", enabled: true }]);
  appendDecisionLog(u2.apiKey, { action: "score_check", agentId: "agent:1", outcome: "scored", score: 80, reason: "ok" });

  const overview = getAdminOverview();
  assert.equal(typeof overview.generatedAt, "string");
  assert.equal(overview.totals.users, 2);
  assert.equal(overview.totals.usersByTier.free, 1);
  assert.equal(overview.totals.usersByTier.starter, 1);
  assert.equal(overview.totals.webhooks, 1);
  assert.equal(overview.totals.decisionLogs, 1);
  assert.ok(Array.isArray(overview.recentUsers));
});

test("admin agent snapshot returns score + signal quality rows", () => {
  appendEvent({
    id: "e1",
    agentId: "agent:admin:1",
    kind: "positive",
    eventType: "completed_task_on_time",
    sourceType: "verified_integration",
    createdAt: new Date().toISOString(),
  });

  const snapshot = getAdminAgentSnapshot({ limit: 20 });
  assert.equal(typeof snapshot.generatedAt, "string");
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].agentId, "agent:admin:1");
  assert.equal(typeof snapshot.rows[0].score, "number");
  assert.equal(typeof snapshot.rows[0].signalQuality.score, "number");
});

test("recent decision feed flattens and sorts rows", () => {
  appendDecisionLog("key_a", {
    action: "score_check",
    agentId: "agent:1",
    outcome: "scored",
    score: 80,
    reason: "ok",
  });
  appendDecisionLog("key_b", {
    action: "clawcredit_preflight",
    agentId: "agent:2",
    outcome: "review",
    score: 49,
    reason: "caution",
  });

  const feed = getRecentDecisionFeed({ limit: 10 });
  assert.equal(typeof feed.generatedAt, "string");
  assert.equal(feed.count, 2);
  assert.equal(feed.rows.length, 2);
  assert.equal(typeof feed.rows[0].apiKey, "string");
});
