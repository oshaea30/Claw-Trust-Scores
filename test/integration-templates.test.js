import test from "node:test";
import assert from "node:assert/strict";

import { listIntegrationTemplates } from "../src/integration-templates.js";

test("integration templates include stripe mapping metadata", () => {
  const result = listIntegrationTemplates();
  assert.ok(result.templates);
  assert.ok(result.templates.stripe);
  assert.equal(result.templates.stripe.source, "stripe");
  assert.equal(result.templates.stripe.status, "live");
  assert.ok(Array.isArray(result.templates.stripe.supportedEventTypes));
  assert.ok(result.templates.stripe.supportedEventTypes.includes("payment_intent.succeeded"));
});
