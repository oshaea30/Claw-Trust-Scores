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

function sourceTrustFactor(event) {
  const sourceType = String(event.sourceType ?? "").trim().toLowerCase();
  if (sourceType === "verified_integration") return 1;
  if (sourceType === "self_reported") return 0.75;
  if (sourceType === "unverified") return 0.6;
  return 1;
}

function confidenceFactor(event) {
  const confidence = Number(event.confidence);
  if (!Number.isFinite(confidence)) return 1;
  return clamp(confidence, 0, 1);
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

export function scoreAgent(agentId, events, options = {}) {
  const includeTrace = options.includeTrace === true;
  const traceLimit = clamp(Number(options.traceLimit ?? 5), 1, 20);
  const nowMs = Date.now();
  let scoreValue = SCORE_BASELINE;
  let positive30d = 0;
  let neutral30d = 0;
  let negative30d = 0;
  const trace = [];

  for (const event of events) {
    const ageDays = daysSince(event.createdAt, nowMs);
    const baseWeight = weightOf(event);
    const decayFactor = decay(ageDays);
    const sourceFactor = sourceTrustFactor(event);
    const confidence = confidenceFactor(event);
    const contribution = baseWeight * decayFactor * sourceFactor * confidence;
    scoreValue += contribution;

    if (ageDays <= 30) {
      if (event.kind === "positive") positive30d += 1;
      if (event.kind === "neutral") neutral30d += 1;
      if (event.kind === "negative") negative30d += 1;
    }

    if (includeTrace) {
      trace.push({
        id: event.id,
        kind: event.kind,
        eventType: event.eventType,
        source: event.source,
        sourceType: event.sourceType,
        externalEventId: event.externalEventId,
        baseWeight,
        decayFactor: Number(decayFactor.toFixed(4)),
        sourceFactor: Number(sourceFactor.toFixed(4)),
        confidenceFactor: Number(confidence.toFixed(4)),
        contribution: Number(contribution.toFixed(4)),
        createdAt: event.createdAt,
      });
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

  const result = {
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

  if (includeTrace) {
    result.trace = trace
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, traceLimit);
  }

  return result;
}
