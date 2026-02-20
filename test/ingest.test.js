import crypto from "node:crypto";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { ingestVerifiedEvent, rotateIngestSecret } from "../src/ingest.js";
import { resetStore } from "../src/store.js";
import { resetPersistenceStateForTest } from "../src/persistence.js";

function sign(secret, timestamp, payload) {
  const raw = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return { raw, signature };
}

beforeEach(() => {
  resetStore();
  resetPersistenceStateForTest();
});

test("verified inbound event is accepted and duplicate is ignored", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  const { ingestSecret } = rotateIngestSecret(account);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    source: "stripe",
    eventId: "evt_123",
    agentId: "agent:ingest:1",
    kind: "negative",
    eventType: "failed_payment",
    details: "card declined",
    verified: true,
  };

  const firstSigned = sign(ingestSecret, timestamp, payload);
  const first = await ingestVerifiedEvent({
    account,
    payload,
    rawBody: firstSigned.raw,
    signature: firstSigned.signature,
    timestamp,
  });

  assert.equal(first.status, 201);
  assert.equal(first.body.accepted, true);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.event.source, "stripe");
  assert.equal(first.body.event.sourceType, "verified_integration");
  assert.equal(first.body.event.externalEventId, "evt_123");

  const secondSigned = sign(ingestSecret, timestamp, payload);
  const second = await ingestVerifiedEvent({
    account,
    payload,
    rawBody: secondSigned.raw,
    signature: secondSigned.signature,
    timestamp,
  });

  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
});

test("verified inbound event rejects invalid signature", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  rotateIngestSecret(account);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    source: "stripe",
    eventId: "evt_999",
    agentId: "agent:ingest:2",
    kind: "positive",
    eventType: "payment_success",
  };

  const rawBody = JSON.stringify(payload);
  const result = await ingestVerifiedEvent({
    account,
    payload,
    rawBody,
    signature: "deadbeef",
    timestamp,
  });

  assert.equal(result.status, 401);
  assert.match(result.body.error, /Invalid ingest signature/i);
});

test("verified inbound event rejects stale timestamp", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  const { ingestSecret } = rotateIngestSecret(account);
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 1000);
  const payload = {
    source: "stripe",
    eventId: "evt_1000",
    agentId: "agent:ingest:3",
    kind: "positive",
    eventType: "payment_success",
  };

  const signed = sign(ingestSecret, staleTimestamp, payload);
  const result = await ingestVerifiedEvent({
    account,
    payload,
    rawBody: signed.raw,
    signature: signed.signature,
    timestamp: staleTimestamp,
  });

  assert.equal(result.status, 401);
  assert.match(result.body.error, /timestamp expired/i);
});

test("stripe template maps provider event type when kind/eventType are omitted", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  const { ingestSecret } = rotateIngestSecret(account);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    source: "stripe",
    eventId: "evt_mapped_1",
    agentId: "agent:ingest:stripe:1",
    stripeEventType: "payment_intent.payment_failed",
    amountUsd: 49.99,
    currency: "usd",
  };

  const signed = sign(ingestSecret, timestamp, payload);
  const result = await ingestVerifiedEvent({
    account,
    payload,
    rawBody: signed.raw,
    signature: signed.signature,
    timestamp,
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.event.kind, "negative");
  assert.equal(result.body.event.eventType, "failed_payment");
  assert.equal(result.body.event.source, "stripe");
  assert.match(result.body.event.details, /stripe:payment_intent.payment_failed/i);
});

test("auth template maps provider event type when kind/eventType are omitted", async () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  const { ingestSecret } = rotateIngestSecret(account);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    source: "auth",
    eventId: "evt_auth_1",
    agentId: "agent:ingest:auth:1",
    providerEventType: "impersonation.detected",
  };

  const signed = sign(ingestSecret, timestamp, payload);
  const result = await ingestVerifiedEvent({
    account,
    payload,
    rawBody: signed.raw,
    signature: signed.signature,
    timestamp,
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.event.kind, "negative");
  assert.equal(result.body.event.eventType, "impersonation_report");
  assert.equal(result.body.event.source, "auth");
  assert.match(result.body.event.details, /auth:impersonation.detected/i);
});
