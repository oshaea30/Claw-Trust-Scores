import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  createDiscordAlert,
  createTelegramAlert,
  listAlertDestinations,
  sendDigestToChannel
} from "../src/alerts.js";
import { resetStore } from "../src/store.js";

const starter = { apiKey: "demo_starter_key", tier: "starter" };
const free = { apiKey: "demo_free_key", tier: "free" };

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("free tier cannot create telegram destination", () => {
  const result = createTelegramAlert({
    account: free,
    payload: { botToken: "123456:abcdefghijklmnopqrstuvwx", chatId: "1", threshold: 50 }
  });
  assert.equal(result.status, 403);
});

test("discord destination validates url host", () => {
  const result = createDiscordAlert({
    account: starter,
    payload: { webhookUrl: "https://example.com/hook", threshold: 50 }
  });
  assert.equal(result.status, 400);
});

test("telegram and discord destinations are listed in safe format", () => {
  const t = createTelegramAlert({
    account: starter,
    payload: { botToken: "123456:abcdefghijklmnopqrstuvwxyzABCD", chatId: "12345", threshold: 45 }
  });
  const d = createDiscordAlert({
    account: starter,
    payload: { webhookUrl: "https://discord.com/api/webhooks/1/abc", threshold: 55 }
  });
  assert.equal(t.status, 201);
  assert.equal(d.status, 201);

  const listed = listAlertDestinations({ account: starter });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.telegram.length, 1);
  assert.equal(listed.body.discord.length, 1);
  assert.ok(String(listed.body.telegram[0].tokenMasked).includes("..."));
  assert.equal(listed.body.discord[0].webhookHost, "discord.com");
});

test("digest send skips duplicate sends in same cadence window", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  createTelegramAlert({
    account: starter,
    payload: { botToken: "123456:abcdefghijklmnopqrstuvwxyzABCD", chatId: "12345", threshold: 50 }
  });

  const report = {
    totals: { decisions: 2, uniqueAgents: 1 },
    shadowMode: { last24h: { wouldBlock: 1, wouldReview: 1 } },
    topRiskReasons: [{ name: "Blocked: trust too low", count: 1 }]
  };

  const first = await sendDigestToChannel({
    account: starter,
    channel: "telegram",
    cadence: "daily",
    report
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.sent, true);

  const second = await sendDigestToChannel({
    account: starter,
    channel: "telegram",
    cadence: "daily",
    report
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.skipped, true);
});
