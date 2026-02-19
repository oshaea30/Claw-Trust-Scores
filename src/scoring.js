import {
  DECAY_HALF_LIFE_DAYS,
  EVENT_WEIGHTS,
  SCORE_BASELINE,
  SCORE_MAX,
  SCORE_MIN
} from "./config.js";

const LN_2 = Math.log(2);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function daysSince(isoDate, nowMs) {
  const eventMs = new Date(isoDate).getTime();
  if (Number.isNaN(eventMs)) return 0;
  return Math.max(0, (nowMs - eventMs) / 86400000);
}

function decay(daysAgo) {
  return Math.exp((-LN_2 * daysAgo) / DECAY_HALF_LIFE_DAYS);
}

function weightOf(event) {
  if (typeof EVENT_WEIGHTS[event.eventType] === "number") {
    return EVENT_WEIGHTS[event.eventType];
  }

  if (event.kind === "positive") return 5;
  if (event.kind === "negative") return -8;
  return 0;
}

function levelFor(score) {
  if (score >= 90) return "Very High";
  if (score >= 75) return "High";
  if (score >= 55) return "Medium";
  if (score >= 35) return "Low";
  return "Very Low";
}

function explanation(level, positive30d, negative30d) {
  if (positive30d > 0 && negative30d === 0) {
    return `${level}: ${positive30d} successful/positive events, no negative events in 30 days.`;
  }

  if (positive30d === 0 && negative30d === 0) {
    return `${level}: no recent events; score currently reflects older activity with time decay.`;
  }

  return `${level}: ${positive30d} positive vs ${negative30d} negative events in 30 days.`;
}

export function scoreAgent(agentId, events) {
  const nowMs = Date.now();
  let scoreValue = SCORE_BASELINE;
  let positive30d = 0;
  let neutral30d = 0;
  let negative30d = 0;

  for (const event of events) {
    const ageDays = daysSince(event.createdAt, nowMs);
    scoreValue += weightOf(event) * decay(ageDays);

    if (ageDays <= 30) {
      if (event.kind === "positive") positive30d += 1;
      if (event.kind === "neutral") neutral30d += 1;
      if (event.kind === "negative") negative30d += 1;
    }
  }

  const score = Math.round(clamp(scoreValue, SCORE_MIN, SCORE_MAX));
  const level = levelFor(score);
  const history = [...events]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      eventType: event.eventType,
      details: event.details,
      source: event.source,
      sourceType: event.sourceType,
      confidence: event.confidence,
      externalEventId: event.externalEventId,
      createdAt: event.createdAt
    }));

  return {
    agentId,
    score,
    level,
    explanation: explanation(level, positive30d, negative30d),
    breakdown: {
      positive30d,
      neutral30d,
      negative30d,
      lifetimeEvents: events.length
    },
    history
  };
}
