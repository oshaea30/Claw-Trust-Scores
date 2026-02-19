import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getAdminOverview } from "../src/admin.js";
import { createUser, upgradeTier } from "../src/key-store.js";
import { appendDecisionLog, putWebhooks, resetStore } from "../src/store.js";

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
