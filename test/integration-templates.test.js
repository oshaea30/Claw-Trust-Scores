import test from "node:test";
import assert from "node:assert/strict";

import { listIntegrationTemplates, mapProviderEvent } from "../src/integration-templates.js";

test("integration templates include stripe mapping metadata", () => {
  const result = listIntegrationTemplates();
  assert.ok(result.templates);
  assert.ok(result.templates.stripe);
  assert.ok(result.templates.auth);
  assert.ok(result.templates.marketplace);
  assert.equal(result.templates.stripe.source, "stripe");
  assert.equal(result.templates.stripe.status, "live");
  assert.ok(Array.isArray(result.templates.stripe.supportedEventTypes));
  assert.ok(result.templates.stripe.supportedEventTypes.includes("payment_intent.succeeded"));
});

test("mapProviderEvent resolves auth and marketplace mappings", () => {
  const auth = mapProviderEvent({
    source: "auth",
    providerEventType: "impersonation.detected",
  });
  assert.equal(auth.ok, true);
  assert.equal(auth.mapping.eventType, "impersonation_report");
  assert.equal(auth.mapping.kind, "negative");

  const market = mapProviderEvent({
    source: "marketplace",
    providerEventType: "task.missed_deadline",
  });
  assert.equal(market.ok, true);
  assert.equal(market.mapping.eventType, "missed_deadline");
  assert.equal(market.mapping.kind, "negative");
});
