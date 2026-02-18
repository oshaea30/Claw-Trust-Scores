import test from "node:test";
import assert from "node:assert/strict";

import { getHeroSnapshot } from "../src/public-signals.js";

test("public hero snapshot returns expected card structure", () => {
  const snapshot = getHeroSnapshot();
  assert.equal(typeof snapshot.generatedAt, "string");
  assert.ok(snapshot.cards);

  assert.equal(typeof snapshot.cards.high.score, "number");
  assert.equal(typeof snapshot.cards.low.score, "number");
  assert.equal(typeof snapshot.cards.stable.score, "number");
  assert.equal(typeof snapshot.cards.decision.adjustedScore, "number");

  assert.ok(snapshot.cards.high.score >= 0 && snapshot.cards.high.score <= 100);
  assert.ok(snapshot.cards.low.score >= 0 && snapshot.cards.low.score <= 100);
  assert.ok(snapshot.cards.stable.score >= 0 && snapshot.cards.stable.score <= 100);
  assert.ok(snapshot.cards.decision.adjustedScore >= 0 && snapshot.cards.decision.adjustedScore <= 100);
  assert.match(snapshot.cards.decision.decision, /^(allow|review|block)$/);
});
