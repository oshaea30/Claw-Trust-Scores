import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { applyPolicyPreset, listPolicyPresets, setPolicy, getPolicy, resetPolicy } from "../src/policy.js";
import { getScore, postEvent } from "../src/service.js";
import { resetStore } from "../src/store.js";
import { resetPersistenceStateForTest } from "../src/persistence.js";

beforeEach(() => {
  resetStore();
  resetPersistenceStateForTest();
});

test("policy can require confidence and allowed source", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  setPolicy(account.apiKey, {
    minConfidence: 0.9,
    allowedSources: ["stripe"],
  });

  await postEvent({
    account,
    payload: {
      agentId: "agent:policy:1",
      kind: "negative",
      eventType: "failed_payment",
      source: "unknown",
      sourceType: "self_reported",
      confidence: 0.2,
    },
  });

  const result = getScore({
    account,
    agentId: "agent:policy:1",
    includeTrace: true,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.score, 50);
  assert.equal(result.body.breakdown.policy.excludedByConfidence, 1);
});

test("policy can require verified source for sensitive event types", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  setPolicy(account.apiKey, {
    requireVerifiedSensitive: true,
  });

  await postEvent({
    account,
    payload: {
      agentId: "agent:policy:verified:1",
      kind: "negative",
      eventType: "failed_payment",
      sourceType: "self_reported",
      confidence: 1,
    },
  });

  const result = getScore({
    account,
    agentId: "agent:policy:verified:1",
    includeTrace: true,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.score, 50);
  assert.equal(result.body.breakdown.policy.excludedByVerification, 1);
  assert.equal(result.body.trace[0].verificationStatus, "policy_excluded");
});

test("policy override can disable an event type", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  setPolicy(account.apiKey, {
    eventOverrides: {
      payment_success: {
        enabled: false,
      },
    },
  });

  await postEvent({
    account,
    payload: {
      agentId: "agent:policy:2",
      kind: "positive",
      eventType: "payment_success",
      sourceType: "verified_integration",
      confidence: 1,
    },
  });

  const result = getScore({
    account,
    agentId: "agent:policy:2",
    includeTrace: true,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.score, 50);
  assert.equal(result.body.breakdown.policy.excludedByEventOverride, 1);
});

test("policy reset returns defaults", () => {
  const apiKey = "demo_starter_key";
  setPolicy(apiKey, { minConfidence: 0.8, minSignalQuality: 75, allowedSources: ["stripe"] });
  const reset = resetPolicy(apiKey);
  const current = getPolicy(apiKey);

  assert.equal(reset.minConfidence, 0);
  assert.equal(reset.minSignalQuality, 0);
  assert.deepEqual(reset.allowedSources, []);
  assert.equal(current.minConfidence, 0);
  assert.equal(current.minSignalQuality, 0);
  assert.deepEqual(current.allowedSources, []);
});

test("policy presets can be listed and applied", () => {
  const apiKey = "demo_starter_key";
  const listed = listPolicyPresets();
  assert.equal(listed.recommended, "balanced");
  assert.ok(listed.presets.strict);
  assert.ok(listed.presets.open);

  const applied = applyPolicyPreset(apiKey, "strict");
  assert.equal(applied.preset, "strict");
  assert.equal(applied.minConfidence, 0.75);
  assert.equal(applied.minSignalQuality, 70);
  assert.equal(applied.sourceTypeMultipliers.unverified, 0);
  assert.equal(applied.requireVerifiedSensitive, true);
  assert.equal(applied.attestationFailureDecision, "block");
  assert.equal(applied.requireAttestationsForRiskAbove, 20);

  const current = getPolicy(apiKey);
  assert.equal(current.preset, "strict");
  assert.equal(current.minConfidence, 0.75);
  assert.equal(current.minSignalQuality, 70);
  assert.equal(current.requireVerifiedSensitive, true);
});

test("policy can set required attestations and gate mode", () => {
  const apiKey = "demo_starter_key";
  const updated = setPolicy(apiKey, {
    requiredAttestations: ["connector.stripe.verified", "operator.kya.completed"],
    requireAttestationsForRiskAbove: 18,
    attestationFailureDecision: "review",
  });

  assert.deepEqual(updated.requiredAttestations, ["connector.stripe.verified", "operator.kya.completed"]);
  assert.equal(updated.requireAttestationsForRiskAbove, 18);
  assert.equal(updated.attestationFailureDecision, "review");
});
