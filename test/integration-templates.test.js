import test from "node:test";
import assert from "node:assert/strict";

import { listIntegrationTemplates, mapProviderEvent } from "../src/integration-templates.js";

test("integration templates include stripe mapping metadata", () => {
  const result = listIntegrationTemplates();
  assert.ok(result.templates);
  assert.ok(result.templates.stripe);
  assert.ok(result.templates.auth);
  assert.ok(result.templates.marketplace);
  assert.ok(result.templates.wallet);
  assert.ok(result.templates.prediction_market);
  assert.ok(result.templates.runtime);
  assert.equal(result.templates.stripe.source, "stripe");
  assert.equal(result.templates.stripe.status, "live");
  assert.ok(Array.isArray(result.templates.stripe.supportedEventTypes));
  assert.ok(result.templates.stripe.supportedEventTypes.includes("payment_intent.succeeded"));
  assert.ok(result.templates.wallet.supportedEventTypes.includes("wallet.tx.failed"));
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

  const wallet = mapProviderEvent({
    source: "wallet",
    providerEventType: "wallet.secret.exposed",
  });
  assert.equal(wallet.ok, true);
  assert.equal(wallet.mapping.eventType, "api_key_leak");
  assert.equal(wallet.mapping.kind, "negative");

  const prediction = mapProviderEvent({
    source: "prediction_market",
    providerEventType: "market.manipulation_flag",
  });
  assert.equal(prediction.ok, true);
  assert.equal(prediction.mapping.eventType, "abuse_report");

  const runtime = mapProviderEvent({
    source: "runtime",
    providerEventType: "sandbox.escape_detected",
  });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.mapping.eventType, "security_flag");
});
