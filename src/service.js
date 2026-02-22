import crypto from "node:crypto";

import { PLANS, RATE_LIMITS_PER_MINUTE } from "./config.js";
import { scheduleFlush } from "./persistence.js";
import { scoreAgent } from "./scoring.js";
import { appendEvent, getAgentEvents, getMonthKey, getUsage, store } from "./store.js";
import { emitScoreAlerts } from "./webhooks.js";

function normalizeAgentId(agentId) {
  return String(agentId).trim().toLowerCase();
}

function scopedAgentId(apiKey, agentId) {
  return `${apiKey}::${agentId}`;
}

function normalizeEventType(eventType) {
  return String(eventType).trim().toLowerCase();
}

function kindValid(kind) {
  return kind === "positive" || kind === "neutral" || kind === "negative";
}

function prettyTier(tier) {
  if (tier === "free") return "Free";
  if (tier === "starter") return "Starter";
  return "Pro";
}

function nextTier(tier) {
  if (tier === "free") return "Starter";
  if (tier === "starter") return "Pro";
  return "Enterprise";
}

function rateLimited({ apiKey, tier, action }) {
  const limit = RATE_LIMITS_PER_MINUTE[tier][action];
  const minuteWindow = Math.floor(Date.now() / 60000);
  const key = `${minuteWindow}:${apiKey}:${action}`;
  const current = store.rateCounterByWindowAndKey.get(key) ?? 0;

  if (current >= limit) {
    return true;
  }

  store.rateCounterByWindowAndKey.set(key, current + 1);
  return false;
}

function duplicateEvent(event) {
  const hashInput = `${event.agentId}|${event.kind}|${event.eventType}|${event.details ?? ""}|${event.sourceApiKey}`;
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex");
  const seenAt = store.recentEventHashes.get(hash);
  const now = Date.now();

  store.recentEventHashes.set(hash, now);
  if (!seenAt) return false;
  return now - seenAt < 10000;
}

function enforceAgentCap(usage, plan, normalizedAgentId, tier) {
  const newAgent = !usage.trackedAgents.has(normalizedAgentId);
  if (newAgent && usage.trackedAgents.size >= plan.maxAgents) {
    return {
      ok: false,
      error: `${prettyTier(tier)} plan limit hit: ${plan.maxAgents} tracked agents/month. Upgrade to ${nextTier(tier)}.`
    };
  }
  return { ok: true };
}

export async function postEvent({ account, payload }) {
  if (rateLimited({ apiKey: account.apiKey, tier: account.tier, action: "eventWrites" })) {
    return { status: 429, body: { error: "Rate limit exceeded for event logging." } };
  }

  const plan = PLANS[account.tier];
  const monthKey = getMonthKey();
  const usage = getUsage(monthKey, account.apiKey);

  const agentId = normalizeAgentId(payload.agentId ?? "");
  const agentScope = scopedAgentId(account.apiKey, agentId);
  const eventType = normalizeEventType(payload.eventType ?? "");
  const kind = payload.kind;

  if (!agentId) return { status: 400, body: { error: "agentId is required." } };
  if (!eventType) return { status: 400, body: { error: "eventType is required." } };
  if (!kindValid(kind)) {
    return {
      status: 400,
      body: { error: "kind is required and must be one of: positive, neutral, negative." }
    };
  }

  const cap = enforceAgentCap(usage, plan, agentId, account.tier);
  if (!cap.ok) return { status: 402, body: { error: cap.error } };

  if (usage.eventsLogged >= plan.maxEventsPerMonth) {
    return {
      status: 402,
      body: {
        error: `${prettyTier(account.tier)} plan limit hit: ${plan.maxEventsPerMonth} events/month exceeded. Upgrade to ${nextTier(account.tier)}.`
      }
    };
  }

  const createdAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();
  if (Number.isNaN(createdAt.getTime())) {
    return { status: 400, body: { error: "occurredAt must be valid ISO-8601 if provided." } };
  }

  const oldScore = scoreAgent(agentId, getAgentEvents(agentScope)).score;

  const event = {
    id: crypto.randomUUID(),
    agentId,
    kind,
    eventType,
    details: typeof payload.details === "string" ? payload.details.trim().slice(0, 300) : undefined,
    sourceApiKey: account.apiKey,
    createdAt: createdAt.toISOString()
  };

  if (duplicateEvent(event)) {
    return { status: 409, body: { error: "Duplicate event rejected (same event submitted too quickly)." } };
  }

  appendEvent(agentScope, event);
  usage.eventsLogged += 1;
  usage.trackedAgents.add(agentId);

  const score = scoreAgent(agentId, getAgentEvents(agentScope));
  scheduleFlush();
  await emitScoreAlerts({
    account,
    agentId,
    previousScore: oldScore,
    score: score.score
  });

  return {
    status: 201,
    body: {
      event,
      score: {
        value: score.score,
        level: score.level,
        explanation: score.explanation
      }
    }
  };
}

export function getScore({ account, agentId }) {
  if (rateLimited({ apiKey: account.apiKey, tier: account.tier, action: "scoreReads" })) {
    return { status: 429, body: { error: "Rate limit exceeded for score checks." } };
  }

  const normalizedAgentId = normalizeAgentId(agentId ?? "");
  const agentScope = scopedAgentId(account.apiKey, normalizedAgentId);
  if (!normalizedAgentId) {
    return { status: 400, body: { error: "agentId query param is required." } };
  }

  const plan = PLANS[account.tier];
  const monthKey = getMonthKey();
  const usage = getUsage(monthKey, account.apiKey);

  const cap = enforceAgentCap(usage, plan, normalizedAgentId, account.tier);
  if (!cap.ok) return { status: 402, body: { error: cap.error } };

  if (usage.scoreChecks >= plan.maxChecksPerMonth) {
    return {
      status: 402,
      body: {
        error: `${prettyTier(account.tier)} plan limit hit: ${plan.maxChecksPerMonth} score checks/month exceeded. Upgrade to ${nextTier(account.tier)}.`
      }
    };
  }

  usage.scoreChecks += 1;
  usage.trackedAgents.add(normalizedAgentId);
  scheduleFlush();

  return {
    status: 200,
    body: scoreAgent(normalizedAgentId, getAgentEvents(agentScope))
  };
}

export function scoreForAccountAgent({ account, agentId }) {
  const normalizedAgentId = normalizeAgentId(agentId ?? "");
  if (!normalizedAgentId) {
    return null;
  }
  return scoreAgent(normalizedAgentId, getAgentEvents(scopedAgentId(account.apiKey, normalizedAgentId)));
}
