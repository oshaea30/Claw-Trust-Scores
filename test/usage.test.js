import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { postEvent, getScore } from "../src/service.js";
import { resetStore } from "../src/store.js";
import { getUsageSnapshot } from "../src/usage.js";

const freeAccount = { apiKey: "demo_free_key", tier: "free" };

test("usage snapshot starts at zero with full remaining", () => {
  resetStore();
  const result = getUsageSnapshot({ account: freeAccount });

  assert.equal(result.status, 200);
  assert.equal(result.body.usage.trackedAgents, 0);
  assert.equal(result.body.usage.eventsLogged, 0);
  assert.equal(result.body.usage.scoreChecks, 0);

  assert.equal(result.body.remaining.trackedAgents, 20);
  assert.equal(result.body.remaining.eventsLogged, 1000);
  assert.equal(result.body.remaining.scoreChecks, 3000);
});

beforeEach(() => {
  resetStore();
});

test("usage snapshot reflects events and score checks", async () => {
  await postEvent({
    account: freeAccount,
    payload: {
      agentId: "agent:usage:1",
      kind: "positive",
      eventType: "completed_task_on_time",
      details: "ok"
    }
  });

  getScore({ account: freeAccount, agentId: "agent:usage:1" });

  const usage = getUsageSnapshot({ account: freeAccount });
  assert.equal(usage.body.usage.trackedAgents, 1);
  assert.equal(usage.body.usage.eventsLogged, 1);
  assert.equal(usage.body.usage.scoreChecks, 1);

  assert.equal(usage.body.remaining.trackedAgents, 19);
  assert.equal(usage.body.remaining.eventsLogged, 999);
  assert.equal(usage.body.remaining.scoreChecks, 2999);
});
