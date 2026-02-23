import test from "node:test";
import assert from "node:assert/strict";

import { scoreAgent } from "../src/scoring.js";

test("score increases with positive events and gives explanation", () => {
  const now = new Date();
  const events = [
    {
      id: "1",
      agentId: "agent-x",
      kind: "positive",
      eventType: "completed_task_on_time",
      details: "",
      createdAt: now.toISOString()
    }
  ];

  const result = scoreAgent("agent-x", events);
  assert.ok(result.score > 50);
  assert.equal(result.breakdown.positive30d, 1);
  assert.match(result.explanation, /no negative events in 30 days/i);
});

test("score decreases with severe negative events", () => {
  const now = new Date();
  const events = [
    {
      id: "1",
      agentId: "agent-y",
      kind: "negative",
      eventType: "api_key_leak",
      details: "",
      createdAt: now.toISOString()
    }
  ];

  const result = scoreAgent("agent-y", events);
  assert.ok(result.score < 50);
  assert.equal(result.breakdown.negative30d, 1);
});

test("confidence and source type reduce low-trust signal impact and trace is available", () => {
  const now = new Date();
  const highConfidenceVerified = {
    id: "high",
    agentId: "agent-z",
    kind: "negative",
    eventType: "failed_payment",
    details: "",
    sourceType: "verified_integration",
    confidence: 1,
    createdAt: now.toISOString(),
  };
  const lowConfidenceSelfReported = {
    ...highConfidenceVerified,
    id: "low",
    sourceType: "self_reported",
    confidence: 0.2,
  };

  const strong = scoreAgent("agent-z", [highConfidenceVerified], { includeTrace: true });
  const weak = scoreAgent("agent-z", [lowConfidenceSelfReported], { includeTrace: true });

  assert.ok(strong.score < weak.score, "verified high-confidence negative event should lower score more");
  assert.ok(Array.isArray(strong.trace));
  assert.equal(strong.trace.length, 1);
  assert.equal(strong.trace[0].sourceFactor, 1);
  assert.equal(strong.trace[0].confidenceFactor, 1);
  assert.ok(strong.trace[0].contribution < 0);
  assert.equal(strong.trace[0].verificationStatus, "verified");
  assert.equal(weak.trace[0].verificationStatus, "unverified");
  assert.equal(strong.history[0].verificationStatus, "verified");
  assert.equal(weak.history[0].verificationStatus, "unverified");
});

test("score response includes signal quality with verified percentage", () => {
  const now = new Date().toISOString();
  const events = [
    {
      id: "v1",
      agentId: "agent-q",
      kind: "positive",
      eventType: "completed_task_on_time",
      sourceType: "verified_integration",
      confidence: 1,
      createdAt: now,
    },
    {
      id: "u1",
      agentId: "agent-q",
      kind: "negative",
      eventType: "failed_payment",
      sourceType: "self_reported",
      confidence: 1,
      createdAt: now,
    },
  ];

  const result = scoreAgent("agent-q", events);
  assert.equal(typeof result.signalQuality.score, "number");
  assert.equal(typeof result.signalQuality.level, "string");
  assert.equal(result.signalQuality.sampleSize, 2);
  assert.equal(result.signalQuality.verifiedPercent, 50);
  assert.equal(typeof result.behavior.score, "number");
  assert.equal(typeof result.trust.baseScore, "number");
  assert.equal(typeof result.trust.behaviorInfluence, "number");
  assert.equal(result.scoreModel.coupling, "separate_base_scores_with_policy_layer");
});

test("severe trust events reduce behavior score through cross influence", () => {
  const now = new Date().toISOString();
  const events = [
    {
      id: "s1",
      agentId: "agent-k",
      kind: "negative",
      eventType: "api_key_leak",
      sourceType: "verified_integration",
      confidence: 1,
      createdAt: now,
    },
    {
      id: "s2",
      agentId: "agent-k",
      kind: "negative",
      eventType: "abuse_report",
      sourceType: "verified_integration",
      confidence: 1,
      createdAt: now,
    },
  ];

  const result = scoreAgent("agent-k", events);
  assert.ok(result.behavior.trustInfluencePenalty >= 8);
  assert.ok(result.behavior.score < 60);
});
