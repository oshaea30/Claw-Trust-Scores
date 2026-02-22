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
