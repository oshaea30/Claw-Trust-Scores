import crypto from "node:crypto";

import { scheduleFlush } from "./persistence.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import {
  listDiscordAlerts,
  listTelegramAlerts,
  putDiscordAlerts,
  putTelegramAlerts,
  store
} from "./store.js";

const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

function supportsPushAlerts(account) {
  return account.tier !== "free";
}

function sanitizeThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) return null;
  return Math.round(threshold);
}

function maskToken(token) {
  const raw = String(token ?? "");
  if (raw.length < 10) return "****";
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function parseDiscordWebhookUrl(input) {
  try {
    const parsed = new URL(String(input ?? "").trim());
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    const allowedHosts = new Set(["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"]);
    if (!allowedHosts.has(host)) return null;
    if (!parsed.pathname.startsWith("/api/webhooks/")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function validateTelegramToken(token) {
  const raw = String(token ?? "").trim();
  return /^[0-9]{6,12}:[A-Za-z0-9_-]{20,}$/.test(raw);
}

function formatAlertText({ threshold, score, previousScore, agentId }) {
  return [
    "Claw Trust Alert",
    `Agent: ${agentId}`,
    `Score crossed below threshold ${threshold}`,
    `Previous: ${previousScore} -> Current: ${score}`,
    "Review before allowing risky actions."
  ].join("\n");
}

async function postDiscord(webhookUrl, text) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text })
  });
  return res.ok ? { ok: true } : { ok: false, status: res.status };
}

async function postTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  });
  return res.ok ? { ok: true } : { ok: false, status: res.status };
}

export function createTelegramAlert({ account, payload }) {
  if (!supportsPushAlerts(account)) {
    return { status: 403, body: { error: "Telegram alerts are available on Starter and Pro only." } };
  }

  const botToken = String(payload.botToken ?? "").trim();
  const chatId = String(payload.chatId ?? "").trim();
  const threshold = sanitizeThreshold(payload.threshold ?? 50);
  if (!validateTelegramToken(botToken)) {
    return { status: 400, body: { error: "Invalid Telegram bot token format." } };
  }
  if (!chatId || chatId.length > 64) {
    return { status: 400, body: { error: "chatId is required." } };
  }
  if (threshold === null) {
    return { status: 400, body: { error: "threshold must be between 0 and 100." } };
  }

  const alerts = listTelegramAlerts(account.apiKey);
  if (alerts.length >= 10) {
    return { status: 402, body: { error: "Telegram alert limit reached (10 per API key)." } };
  }

  const alert = {
    id: crypto.randomUUID(),
    threshold,
    chatId,
    botToken: encryptSecret(botToken),
    tokenMasked: maskToken(botToken),
    createdAt: new Date().toISOString(),
    enabled: true
  };
  putTelegramAlerts(account.apiKey, [...alerts, alert]);
  scheduleFlush();

  return {
    status: 201,
    body: {
      alert: {
        id: alert.id,
        threshold: alert.threshold,
        chatId: alert.chatId,
        tokenMasked: alert.tokenMasked,
        createdAt: alert.createdAt,
        enabled: alert.enabled
      }
    }
  };
}

export function createDiscordAlert({ account, payload }) {
  if (!supportsPushAlerts(account)) {
    return { status: 403, body: { error: "Discord alerts are available on Starter and Pro only." } };
  }

  const webhookUrl = parseDiscordWebhookUrl(payload.webhookUrl);
  const threshold = sanitizeThreshold(payload.threshold ?? 50);
  if (!webhookUrl) {
    return { status: 400, body: { error: "webhookUrl must be a valid Discord webhook URL." } };
  }
  if (threshold === null) {
    return { status: 400, body: { error: "threshold must be between 0 and 100." } };
  }

  const alerts = listDiscordAlerts(account.apiKey);
  if (alerts.length >= 10) {
    return { status: 402, body: { error: "Discord alert limit reached (10 per API key)." } };
  }

  const alert = {
    id: crypto.randomUUID(),
    threshold,
    webhookUrl,
    createdAt: new Date().toISOString(),
    enabled: true
  };
  putDiscordAlerts(account.apiKey, [...alerts, alert]);
  scheduleFlush();

  return {
    status: 201,
    body: { alert }
  };
}

export function listAlertDestinations({ account }) {
  const telegram = listTelegramAlerts(account.apiKey).map((item) => ({
    id: item.id,
    threshold: item.threshold,
    chatId: item.chatId,
    tokenMasked: item.tokenMasked,
    createdAt: item.createdAt,
    enabled: item.enabled
  }));
  const discord = listDiscordAlerts(account.apiKey).map((item) => ({
    id: item.id,
    threshold: item.threshold,
    webhookHost: new URL(item.webhookUrl).host,
    webhookPathTail: item.webhookUrl.split("/").slice(-2).join("/"),
    createdAt: item.createdAt,
    enabled: item.enabled
  }));

  return { status: 200, body: { telegram, discord } };
}

export function deleteAlertDestination({ account, channel, id }) {
  const normalizedChannel = String(channel ?? "").trim().toLowerCase();
  const alertId = String(id ?? "").trim();
  if (!alertId) return { status: 400, body: { error: "Alert id is required." } };

  if (normalizedChannel === "telegram") {
    const current = listTelegramAlerts(account.apiKey);
    const next = current.filter((item) => item.id !== alertId);
    if (next.length === current.length) return { status: 404, body: { error: "Alert destination not found." } };
    putTelegramAlerts(account.apiKey, next);
    scheduleFlush();
    return { status: 200, body: { deleted: true } };
  }

  if (normalizedChannel === "discord") {
    const current = listDiscordAlerts(account.apiKey);
    const next = current.filter((item) => item.id !== alertId);
    if (next.length === current.length) return { status: 404, body: { error: "Alert destination not found." } };
    putDiscordAlerts(account.apiKey, next);
    scheduleFlush();
    return { status: 200, body: { deleted: true } };
  }

  return { status: 400, body: { error: "channel must be telegram or discord." } };
}

export async function emitChannelScoreAlerts({ account, agentId, score, previousScore }) {
  if (!supportsPushAlerts(account)) return;

  const textFor = (threshold) => formatAlertText({ threshold, score, previousScore, agentId });
  const now = Date.now();

  const tAlerts = listTelegramAlerts(account.apiKey).filter((item) => item.enabled);
  for (const alert of tAlerts) {
    const crossedDown = previousScore > alert.threshold && score <= alert.threshold;
    if (!crossedDown) continue;
    const suppressionKey = `tg:${alert.id}:${agentId}`;
    const suppressedUntil = Number(store.webhookSuppression.get(suppressionKey) ?? 0);
    if (now < suppressedUntil) continue;
    try {
      const token = decryptSecret(alert.botToken);
      await postTelegram(token, alert.chatId, textFor(alert.threshold));
      store.webhookSuppression.set(suppressionKey, now + ALERT_COOLDOWN_MS);
    } catch {
      // no-op: best effort delivery
    }
  }

  const dAlerts = listDiscordAlerts(account.apiKey).filter((item) => item.enabled);
  for (const alert of dAlerts) {
    const crossedDown = previousScore > alert.threshold && score <= alert.threshold;
    if (!crossedDown) continue;
    const suppressionKey = `dc:${alert.id}:${agentId}`;
    const suppressedUntil = Number(store.webhookSuppression.get(suppressionKey) ?? 0);
    if (now < suppressedUntil) continue;
    try {
      await postDiscord(alert.webhookUrl, textFor(alert.threshold));
      store.webhookSuppression.set(suppressionKey, now + ALERT_COOLDOWN_MS);
    } catch {
      // no-op: best effort delivery
    }
  }

  scheduleFlush();
}

function digestText(report, cadence) {
  return [
    `Claw Trust ${cadence} digest`,
    `Decisions: ${report.totals.decisions}`,
    `Unique agents: ${report.totals.uniqueAgents}`,
    `Would block (24h): ${report.shadowMode.last24h.wouldBlock}`,
    `Would review (24h): ${report.shadowMode.last24h.wouldReview}`,
    `Top risk reason: ${(report.topRiskReasons[0]?.name ?? "none")}`
  ].join("\n");
}

function digestKey(apiKey, channel, cadence) {
  return `${apiKey}:${channel}:${cadence}`;
}

function cadenceMs(cadence) {
  return cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export async function sendDigestToChannel({ account, channel, cadence, report }) {
  const normalizedChannel = String(channel ?? "").trim().toLowerCase();
  const normalizedCadence = cadence === "weekly" ? "weekly" : "daily";
  const key = digestKey(account.apiKey, normalizedChannel, normalizedCadence);
  const lastSent = Number(store.digestDispatchByKey.get(key) ?? 0);
  const now = Date.now();
  if (lastSent && now - lastSent < cadenceMs(normalizedCadence)) {
    return { status: 200, body: { sent: false, skipped: true, reason: "Digest already sent for current cadence window." } };
  }

  const text = digestText(report, normalizedCadence);
  if (normalizedChannel === "telegram") {
    const alert = listTelegramAlerts(account.apiKey).find((item) => item.enabled);
    if (!alert) return { status: 404, body: { error: "No Telegram destination configured." } };
    const token = decryptSecret(alert.botToken);
    const sent = await postTelegram(token, alert.chatId, text);
    if (!sent.ok) return { status: 502, body: { error: "Telegram delivery failed." } };
  } else if (normalizedChannel === "discord") {
    const alert = listDiscordAlerts(account.apiKey).find((item) => item.enabled);
    if (!alert) return { status: 404, body: { error: "No Discord destination configured." } };
    const sent = await postDiscord(alert.webhookUrl, text);
    if (!sent.ok) return { status: 502, body: { error: "Discord delivery failed." } };
  } else {
    return { status: 400, body: { error: "channel must be telegram or discord." } };
  }

  store.digestDispatchByKey.set(key, now);
  scheduleFlush();
  return { status: 200, body: { sent: true, channel: normalizedChannel, cadence: normalizedCadence } };
}
