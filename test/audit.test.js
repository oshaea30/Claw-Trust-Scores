import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getDecisionLogs, logDecision } from "../src/audit.js";
import { clawCreditPreflight } from "../src/clawcredit.js";
import { postEvent, getScore } from "../src/service.js";
import { resetStore } from "../src/store.js";

const account = { apiKey: "demo_starter_key", tier: "starter" };

beforeEach(() => {
  resetStore();
});

test("audit endpoint returns logs in json and csv formats", () => {
  logDecision({
    account,
    action: "score_check",
    agentId: "agent:audit:1",
    outcome: "scored",
    score: 61,
    reason: "Medium: no recent events",
  });

  const json = getDecisionLogs({ account, query: { format: "json", limit: "10" } });
  assert.equal(json.status, 200);
  assert.equal(json.body.count, 1);
  assert.equal(json.body.logs[0].action, "score_check");

  const csv = getDecisionLogs({ account, query: { format: "csv", limit: "10" } });
  assert.equal(csv.status, 200);
  assert.match(csv.body, /timestamp,action,agentId,outcome,score,reason,metadata/);
  assert.match(csv.body, /score_check/);
});

test("clawcredit preflight writes decision logs", async () => {
  await postEvent({
    account,
    payload: {
      agentId: "agent:audit:claw",
      kind: "negative",
      eventType: "api_key_leak",
      details: "major incident"
    }
  });

  const preflight = clawCreditPreflight({
    account,
    payload: {
      agentId: "agent:audit:claw",
      amountUsd: 20000,
      newPayee: true,
      highPrivilegeAction: true,
    }
  });

  assert.equal(preflight.status, 200);

  const logs = getDecisionLogs({ account, query: { format: "json", limit: "10" } });
  const clawLog = logs.body.logs.find((row) => row.action === "clawcredit_preflight");

  assert.ok(clawLog);
  assert.equal(clawLog.agentId, "agent:audit:claw");
  assert.equal(clawLog.outcome, preflight.body.decision);
});

test("score checks can be logged and exported", async () => {
  await postEvent({
    account,
    payload: {
      agentId: "agent:audit:score",
      kind: "positive",
      eventType: "completed_task_on_time",
      details: "good"
    }
  });

  const scoreResult = getScore({ account, agentId: "agent:audit:score" });
  assert.equal(scoreResult.status, 200);

  logDecision({
    account,
    action: "score_check",
    agentId: "agent:audit:score",
    outcome: "scored",
    score: scoreResult.body.score,
    reason: scoreResult.body.explanation,
  });

  const logs = getDecisionLogs({ account, query: { format: "json", limit: "10" } });
  assert.equal(logs.body.logs[0].action, "score_check");
});
