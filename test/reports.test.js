import test from "node:test";
import assert from "node:assert/strict";

import { logDecision } from "../src/audit.js";
import { buildWeeklyReport } from "../src/reports.js";
import { resetStore, store } from "../src/store.js";

const account = { apiKey: "demo_starter_key", tier: "starter" };

test("weekly report summarizes outcomes and shadow mode counts", () => {
  resetStore();

  logDecision({
    account,
    action: "clawcredit_preflight",
    agentId: "agent:a",
    outcome: "allow",
    score: 72,
    reason: "ok"
  });
  logDecision({
    account,
    action: "clawcredit_preflight",
    agentId: "agent:b",
    outcome: "block",
    score: 20,
    reason: "Blocked: trust too low."
  });
  logDecision({
    account,
    action: "clawcredit_preflight",
    agentId: "agent:b",
    outcome: "review",
    score: 49,
    reason: "Manual review required."
  });

  // Force one old row outside weekly window.
  const rows = store.decisionLogsByApiKey.get(account.apiKey);
  rows[rows.length - 1].timestamp = "2000-01-01T00:00:00.000Z";

  const report = buildWeeklyReport({ account });
  assert.equal(report.totals.decisions, 2);
  assert.equal(report.totals.block, 1);
  assert.equal(report.totals.review, 1);
  assert.equal(report.totals.allow, 0);
  assert.equal(report.totals.uniqueAgents, 1);
  assert.equal(report.shadowMode.last24h.wouldBlock, 1);
  assert.equal(report.shadowMode.last24h.wouldReview, 1);
  assert.equal(report.topRiskAgents[0].name, "agent:b");
});
