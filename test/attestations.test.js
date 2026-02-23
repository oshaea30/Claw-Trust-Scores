import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  issueAttestation,
  listAttestations,
  revokeAttestation,
  verifyAttestationToken,
} from "../src/attestations.js";
import { resetPersistenceStateForTest } from "../src/persistence.js";
import { resetStore } from "../src/store.js";

beforeEach(() => {
  resetStore();
  resetPersistenceStateForTest();
  delete process.env.ATTESTATION_SIGNING_KEY;
});

test("issue and list attestations", () => {
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  const issued = issueAttestation({
    account,
    payload: {
      agentId: "agent:vendor:one",
      type: "connector.stripe.verified",
      ttlDays: 30,
      claims: { provider: "stripe", mode: "live" },
    },
  });

  assert.equal(issued.status, 201);
  assert.ok(issued.body.token);
  assert.equal(issued.body.attestation.agentId, "agent:vendor:one");

  const listed = listAttestations({
    account,
    query: { agentId: "agent:vendor:one", includeToken: "false" },
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.attestations[0].type, "connector.stripe.verified");
  assert.equal(listed.body.attestations[0].status, "active");
  assert.equal(typeof listed.body.attestations[0].token, "undefined");
});

test("verify and revoke attestation token", () => {
  process.env.ATTESTATION_SIGNING_KEY = "test-attestation-signing-key";
  const account = { apiKey: "demo_starter_key", tier: "starter" };
  const issued = issueAttestation({
    account,
    payload: {
      agentId: "agent:vendor:two",
      type: "connector.auth.verified",
      ttlDays: 7,
      claims: { provider: "auth0" },
    },
  });

  const token = issued.body.token;
  const verified = verifyAttestationToken({ token });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.valid, true);
  assert.equal(verified.body.attestation.agentId, "agent:vendor:two");

  const revoked = revokeAttestation({
    account,
    attestationId: issued.body.attestation.id,
    reason: "integration_removed",
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.attestation.status, "revoked");

  const verifiedAfter = verifyAttestationToken({ token });
  assert.equal(verifiedAfter.status, 200);
  assert.equal(verifiedAfter.body.valid, false);
  assert.equal(verifiedAfter.body.status, "revoked");
});

