import { store } from "./store.js";
import { getAllUsers } from "./key-store.js";

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
