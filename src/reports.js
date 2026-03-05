import { listDecisionLogs } from "./store.js";
import { scheduleFlush } from "./persistence.js";
import { sendDigestToChannel } from "./alerts.js";
import { store } from "./store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function nowIso() {
  return new Date().toISOString();
}

function toMillis(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : 0;
}

function topEntries(map, limit = 5) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export function buildWeeklyReport({ account }) {
  const now = Date.now();
  const weekStartMs = now - WEEK_MS;
  const dayStartMs = now - DAY_MS;
  const logs = listDecisionLogs(account.apiKey);
  const weekLogs = logs.filter((row) => toMillis(row.timestamp) >= weekStartMs);
  const dayLogs = weekLogs.filter((row) => toMillis(row.timestamp) >= dayStartMs);

  const outcomes = { allow: 0, review: 0, block: 0, scored: 0, other: 0 };
  const riskyAgents = new Map();
  const riskyReasons = new Map();
  const uniqueAgents = new Set();

  for (const row of weekLogs) {
    const outcome = String(row.outcome ?? "").toLowerCase();
    if (outcome in outcomes) outcomes[outcome] += 1;
    else outcomes.other += 1;
    if (row.agentId) uniqueAgents.add(row.agentId);

    if (outcome === "block" || outcome === "review") {
      const agentId = String(row.agentId ?? "unknown");
      const reason = String(row.reason ?? "Unknown reason");
      riskyAgents.set(agentId, (riskyAgents.get(agentId) ?? 0) + 1);
      riskyReasons.set(reason, (riskyReasons.get(reason) ?? 0) + 1);
    }
  }

  const shadowWouldBlock24h = dayLogs.filter((row) => String(row.outcome ?? "").toLowerCase() === "block").length;
  const shadowWouldReview24h = dayLogs.filter((row) => String(row.outcome ?? "").toLowerCase() === "review").length;

  return {
    generatedAt: nowIso(),
    window: {
      start: new Date(weekStartMs).toISOString(),
      end: new Date(now).toISOString(),
      days: 7,
    },
    totals: {
      decisions: weekLogs.length,
      uniqueAgents: uniqueAgents.size,
      allow: outcomes.allow,
      review: outcomes.review,
      block: outcomes.block,
      scoreChecks: outcomes.scored,
    },
    shadowMode: {
      last24h: {
        wouldBlock: shadowWouldBlock24h,
        wouldReview: shadowWouldReview24h,
      },
    },
    topRiskAgents: topEntries(riskyAgents),
    topRiskReasons: topEntries(riskyReasons),
  };
}

async function sendViaResend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return { status: 503, body: { error: "Email digest not configured. Set RESEND_API_KEY and FROM_EMAIL." } };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { status: 502, body: { error: `Email provider error: ${text.slice(0, 300)}` } };
  }

  return { status: 200, body: { sent: true } };
}

function weeklyHtml(report) {
  const list = (items) =>
    items.length === 0
      ? "<li>None</li>"
      : items.map((item) => `<li>${item.name} (${item.count})</li>`).join("");

  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;color:#1f1a16;line-height:1.5">
    <h2 style="margin:0 0 10px;color:#d4532a">Claw Trust Scores Weekly Report</h2>
    <p style="margin:0 0 14px">Window: ${report.window.start} to ${report.window.end}</p>
    <ul>
      <li>Total decisions: ${report.totals.decisions}</li>
      <li>Unique agents: ${report.totals.uniqueAgents}</li>
      <li>Allow: ${report.totals.allow}</li>
      <li>Review: ${report.totals.review}</li>
      <li>Block: ${report.totals.block}</li>
      <li>Score checks: ${report.totals.scoreChecks}</li>
    </ul>
    <p><strong>Shadow mode (24h):</strong> would block ${report.shadowMode.last24h.wouldBlock}, would review ${report.shadowMode.last24h.wouldReview}</p>
    <p><strong>Top risk agents</strong></p>
    <ul>${list(report.topRiskAgents)}</ul>
    <p><strong>Top risk reasons</strong></p>
    <ul>${list(report.topRiskReasons)}</ul>
  </div>`;
}

export async function emailWeeklyReport({ account, payload }) {
  const to = String(payload?.email ?? "").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { status: 400, body: { error: "Valid email is required." } };
  }
  const report = buildWeeklyReport({ account });
  return sendViaResend({
    to,
    subject: "Your Claw Trust Scores weekly report",
    html: weeklyHtml(report),
  });
}

function cadenceWindowMs(cadence) {
  return cadence === "weekly" ? WEEK_MS : DAY_MS;
}

function emailDigestStateKey(apiKey, cadence) {
  return `${apiKey}:email:${cadence === "weekly" ? "weekly" : "daily"}`;
}

export async function sendDigest({ account, payload }) {
  const channel = String(payload?.channel ?? "email").trim().toLowerCase();
  const cadence = payload?.cadence === "weekly" ? "weekly" : "daily";
  const report = buildWeeklyReport({ account });

  if (channel === "telegram" || channel === "discord") {
    return sendDigestToChannel({ account, channel, cadence, report });
  }

  if (channel !== "email") {
    return { status: 400, body: { error: "channel must be email, telegram, or discord." } };
  }

  const to = String(payload?.email ?? "").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { status: 400, body: { error: "Valid email is required for email digests." } };
  }

  const stateKey = emailDigestStateKey(account.apiKey, cadence);
  const lastSent = Number(store.digestDispatchByKey.get(stateKey) ?? 0);
  const now = Date.now();
  if (lastSent && now - lastSent < cadenceWindowMs(cadence)) {
    return { status: 200, body: { sent: false, skipped: true, reason: "Digest already sent for current cadence window." } };
  }

  const result = await sendViaResend({
    to,
    subject: `Claw Trust ${cadence} report`,
    html: weeklyHtml(report),
  });
  if (result.status !== 200) return result;

  store.digestDispatchByKey.set(stateKey, now);
  scheduleFlush();
  return { status: 200, body: { sent: true, channel: "email", cadence } };
}
