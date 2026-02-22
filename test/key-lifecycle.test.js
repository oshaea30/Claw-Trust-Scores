import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { authenticate, issueApiKey, revokeApiKey, rotateApiKey } from "../src/auth.js";
import { resetStore } from "../src/store.js";

beforeEach(() => {
  resetStore();
  delete process.env.NODE_ENV;
  delete process.env.TRUST_API_KEYS;
});

test("issued key authenticates and revoked key no longer authenticates", () => {
  const issued = issueApiKey({ tier: "starter" });
  assert.equal(issued.status, 201);
  assert.ok(issued.body.apiKey.startsWith("claw_live_"));

  const accountBefore = authenticate({ headers: { "x-api-key": issued.body.apiKey } });
  assert.equal(accountBefore?.tier, "starter");

  const revoked = revokeApiKey({ apiKey: issued.body.apiKey });
  assert.equal(revoked.status, 200);

  const accountAfter = authenticate({ headers: { "x-api-key": issued.body.apiKey } });
  assert.equal(accountAfter, null);
});

test("rotating key invalidates old key and returns a new key of same tier", () => {
  const issued = issueApiKey({ tier: "pro" });
  assert.equal(issued.status, 201);

  const rotated = rotateApiKey({ apiKey: issued.body.apiKey });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.tier, "pro");
  assert.notEqual(rotated.body.apiKey, issued.body.apiKey);

  const oldAccount = authenticate({ headers: { "x-api-key": issued.body.apiKey } });
  const newAccount = authenticate({ headers: { "x-api-key": rotated.body.apiKey } });
  assert.equal(oldAccount, null);
  assert.equal(newAccount?.tier, "pro");
});
