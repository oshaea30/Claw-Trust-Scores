import { PLANS } from "./config.js";
import { getMonthKey, getUsage } from "./store.js";

function setToCount(value) {
  if (!value || typeof value.size !== "number") return 0;
  return value.size;
}

function clampRemaining(limit, used) {
  return Math.max(0, limit - used);
}

export function getUsageSnapshot({ account }) {
  const monthKey = getMonthKey();
  const usage = getUsage(monthKey, account.apiKey);
  const plan = PLANS[account.tier];

  const agentsUsed = setToCount(usage.trackedAgents);
  const eventsUsed = Number(usage.eventsLogged ?? 0);
  const checksUsed = Number(usage.scoreChecks ?? 0);

  return {
    status: 200,
    body: {
      month: monthKey,
      tier: account.tier,
      usage: {
        trackedAgents: agentsUsed,
        eventsLogged: eventsUsed,
        scoreChecks: checksUsed,
      },
      limits: {
        trackedAgents: plan.maxAgents,
        eventsLogged: plan.maxEventsPerMonth,
        scoreChecks: plan.maxChecksPerMonth,
      },
      remaining: {
        trackedAgents: clampRemaining(plan.maxAgents, agentsUsed),
        eventsLogged: clampRemaining(plan.maxEventsPerMonth, eventsUsed),
        scoreChecks: clampRemaining(plan.maxChecksPerMonth, checksUsed),
      },
      features: {
        webhooks: plan.webhooks,
        bulkExports: plan.bulkExports,
        support: plan.support,
      },
    },
  };
}
