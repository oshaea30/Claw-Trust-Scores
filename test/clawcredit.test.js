import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { postEvent } from "../src/service.js";
import { clawCreditPreflight } from "../src/clawcredit.js";
import { setPolicy } from "../src/policy.js";
import { resetStore } from "../src/store.js";

const account = { apiKey: "demo_starter_key", tier: "starter" };

beforeEach(() => {
  resetStore();
});

test("clawcredit preflight blocks risky low-trust payment", async () => {
  await postEvent({
    account,
    payload: {
      agentId: "agent:claw:block",
      kind: "negative",
      eventType: "api_key_leak",
      details: "leaked creds"
    }
  });

  const result = clawCreditPreflight({
    payload: {
      agentId: "agent:claw:block",
      amountUsd: 20000,
      newPayee: true,
      highPrivilegeAction: true
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.integration, "clawcredit");
  assert.equal(result.body.decision, "block");
});

test("clawcredit preflight allows low-risk high-trust payment", async () => {
  await postEvent({
    account,
    payload: {
      agentId: "agent:claw:allow",
      kind: "positive",
      eventType: "completed_task_on_time",
      details: "good behavior"
    }
  });

  const result = clawCreditPreflight({
    payload: {
      agentId: "agent:claw:allow",
      amountUsd: 20,
      newPayee: false,
      highPrivilegeAction: false
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.decision, "allow");
});

test("clawcredit preflight can require minimum signal quality", async () => {
  setPolicy(account.apiKey, { minSignalQuality: 90 });
  await postEvent({
    account,
    payload: {
      agentId: "agent:claw:quality",
      kind: "positive",
      eventType: "completed_task_on_time",
      sourceType: "self_reported",
      confidence: 1,
      details: "high score but low quality",
    }
  });

  const result = clawCreditPreflight({
    account,
    payload: {
      agentId: "agent:claw:quality",
      amountUsd: 20,
      newPayee: false,
      highPrivilegeAction: false
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.decision, "review");
  assert.match(result.body.reason, /signal quality/i);
  assert.equal(typeof result.body.trust.signalQuality.score, "number");
  assert.equal(result.body.policy.minSignalQuality, 90);
});
