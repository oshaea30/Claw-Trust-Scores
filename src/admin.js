import { store } from "./store.js";
import { getAllUsers } from "./key-store.js";
import { scoreAgent } from "./scoring.js";

function monthFromIso(iso) {
  if (!iso || typeof iso !== "string") return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getAdminOverview() {
  const users = getAllUsers();

  const tiers = { free: 0, starter: 0, pro: 0 };
  for (const user of users) {
    if (tiers[user.tier] !== undefined) {
      tiers[user.tier] += 1;
    }
  }

  const signupsByMonth = {};
  for (const user of users) {
    const key = monthFromIso(user.createdAt);
    signupsByMonth[key] = (signupsByMonth[key] ?? 0) + 1;
  }

  const usageByKey = {};
  for (const [usageKey, value] of store.usageByMonthAndApiKey.entries()) {
    const idx = usageKey.indexOf(":");
    if (idx === -1) continue;
    const apiKey = usageKey.slice(idx + 1);
    if (!usageByKey[apiKey]) {
      usageByKey[apiKey] = {
        trackedAgents: 0,
        eventsLogged: 0,
        scoreChecks: 0,
      };
    }
    usageByKey[apiKey].trackedAgents += value.trackedAgents.size;
    usageByKey[apiKey].eventsLogged += value.eventsLogged;
    usageByKey[apiKey].scoreChecks += value.scoreChecks;
  }

  const topUsage = Object.entries(usageByKey)
    .map(([apiKey, usage]) => ({
      apiKey,
      ...usage,
      totalRequests: usage.eventsLogged + usage.scoreChecks,
    }))
    .sort((a, b) => b.totalRequests - a.totalRequests)
    .slice(0, 10);

  let totalEvents = 0;
  for (const events of store.eventsByAgentId.values()) {
    totalEvents += events.length;
  }

  let totalWebhooks = 0;
  for (const hooks of store.webhooksByApiKey.values()) {
    totalWebhooks += hooks.length;
  }

  let totalDecisionLogs = 0;
  for (const logs of store.decisionLogsByApiKey.values()) {
    totalDecisionLogs += logs.length;
  }

  const recentUsers = users
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((entry) => ({
      apiKey: entry.apiKey,
      email: entry.email,
      tier: entry.tier,
      createdAt: entry.createdAt,
      upgradedAt: entry.upgradedAt ?? null,
      rotatedAt: entry.rotatedAt ?? null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      users: users.length,
      usersByTier: tiers,
      events: totalEvents,
      webhooks: totalWebhooks,
      decisionLogs: totalDecisionLogs,
    },
    signupsByMonth,
    recentUsers,
    topUsage,
  };
}

export function getAdminAgentSnapshot({ limit = 50 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = [];

  for (const [agentId, events] of store.eventsByAgentId.entries()) {
    const score = scoreAgent(agentId, events);
    const sorted = [...events].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const latest = sorted[0];

    rows.push({
      agentId,
      score: score.score,
      level: score.level,
      signalQuality: score.signalQuality,
      lifetimeEvents: score.breakdown.lifetimeEvents,
      negative30d: score.breakdown.negative30d,
      positive30d: score.breakdown.positive30d,
      lastEventType: latest?.eventType ?? null,
      lastSource: latest?.source ?? null,
      lastSeenAt: latest?.createdAt ?? null,
    });
  }

  rows.sort((a, b) => {
    const aTs = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const bTs = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    return bTs - aTs;
  });

  return {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    rows: rows.slice(0, normalizedLimit),
  };
}

export function getRecentDecisionFeed({ limit = 100 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const entries = [];

  for (const [apiKey, rows] of store.decisionLogsByApiKey.entries()) {
    for (const row of rows) {
      entries.push({
        ...row,
        apiKey,
      });
    }
  }

  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    rows: entries.slice(0, normalizedLimit),
  };
}
