import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { postEvent } from "../src/service.js";
import { clawCreditPreflight } from "../src/clawcredit.js";
import { resetStore } from "../src/store.js";
import { issueAttestation } from "../src/attestations.js";
import { setPolicy } from "../src/policy.js";

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
    account,
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
  assert.equal(typeof result.body.behavior.score, "number");
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
    account,
    payload: {
      agentId: "agent:claw:allow",
      amountUsd: 20,
      newPayee: false,
      highPrivilegeAction: false
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.decision, "allow");
  assert.equal(typeof result.body.policy.behaviorPenalty, "number");
  assert.equal(typeof result.body.policy.behaviorCredit, "number");
});

test("clawcredit preflight enforces required attestations on high-risk actions", async () => {
  await postEvent({
    account,
    payload: {
      agentId: "agent:claw:attestation",
      kind: "positive",
      eventType: "completed_task_on_time",
      details: "good behavior"
    }
  });

  setPolicy(account.apiKey, {
    requiredAttestations: ["connector.stripe.verified"],
    requireAttestationsForRiskAbove: 10,
    attestationFailureDecision: "block",
  });

  const withoutAttestation = clawCreditPreflight({
    account,
    payload: {
      agentId: "agent:claw:attestation",
      amountUsd: 1000,
      newPayee: false,
      highPrivilegeAction: false
    }
  });
  assert.equal(withoutAttestation.status, 200);
  assert.equal(withoutAttestation.body.decision, "block");
  assert.equal(withoutAttestation.body.policy.attestationGate.applies, true);
  assert.deepEqual(withoutAttestation.body.policy.attestationGate.missing, ["connector.stripe.verified"]);

  issueAttestation({
    account,
    payload: {
      agentId: "agent:claw:attestation",
      type: "connector.stripe.verified",
      ttlDays: 30,
      claims: { provider: "stripe" },
    },
  });

  const withAttestation = clawCreditPreflight({
    account,
    payload: {
      agentId: "agent:claw:attestation",
      amountUsd: 1000,
      newPayee: false,
      highPrivilegeAction: false
    }
  });
  assert.equal(withAttestation.status, 200);
  assert.equal(withAttestation.body.decision, "review");
  assert.deepEqual(withAttestation.body.policy.attestationGate.missing, []);
});
