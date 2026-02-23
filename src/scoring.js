import {
  BEHAVIOR_EVENT_WEIGHTS,
  DECAY_HALF_LIFE_DAYS,
  EVENT_WEIGHTS,
  SCORE_BASELINE,
  SCORE_MAX,
  SCORE_MIN,
  SENSITIVE_EVENT_TYPES,
} from "./config.js";

const LN_2 = Math.log(2);
const DEFAULT_SOURCE_TYPE_FACTORS = {
  verified_integration: 1,
  self_reported: 0.75,
  unverified: 0.6,
  manual: 1,
};

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

function sourceQualityFactor(event) {
  const sourceType = String(event.sourceType ?? "").trim().toLowerCase();
  if (sourceType === "verified_integration") return 1;
  if (sourceType === "manual") return 0.85;
  if (sourceType === "self_reported") return 0.55;
  if (sourceType === "unverified") return 0.35;
  return 0.7;
}

function confidenceFactor(event) {
  const confidence = Number(event.confidence);
  if (!Number.isFinite(confidence)) return 1;
  return clamp(confidence, 0, 1);
}

function normalizedPolicy(input) {
  const base = {
    minConfidence: 0,
    allowedSources: [],
    sourceTypeMultipliers: { ...DEFAULT_SOURCE_TYPE_FACTORS },
    eventOverrides: {},
    requireVerifiedSensitive: false,
  };
  if (!input || typeof input !== "object") return base;
  return {
    ...base,
    ...input,
    sourceTypeMultipliers: {
      ...base.sourceTypeMultipliers,
      ...(input.sourceTypeMultipliers ?? {}),
    },
    eventOverrides: {
      ...(input.eventOverrides ?? {}),
    },
    allowedSources: Array.isArray(input.allowedSources)
      ? input.allowedSources.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

function evaluatePolicy(event, policy, confidence) {
  const eventType = String(event.eventType ?? "").trim().toLowerCase();
  const source = String(event.source ?? "").trim().toLowerCase();
  const sourceType = String(event.sourceType ?? "").trim().toLowerCase();
  const override = policy.eventOverrides[eventType] ?? null;
  const isSensitive = SENSITIVE_EVENT_TYPES.has(eventType);
  const verified = sourceType === "verified_integration";

  if (override?.enabled === false) {
    return { included: false, reason: "event_override_disabled" };
  }

  if (policy.requireVerifiedSensitive && isSensitive && !verified) {
    return { included: false, reason: "unverified_sensitive_event" };
  }

  if (confidence < policy.minConfidence) {
    return { included: false, reason: "below_min_confidence" };
  }

  if (policy.allowedSources.length > 0 && (!source || !policy.allowedSources.includes(source))) {
    return { included: false, reason: "source_not_allowed" };
  }

  const sourceFactor = Number(policy.sourceTypeMultipliers[sourceType]);
  const normalizedSourceFactor = Number.isFinite(sourceFactor)
    ? clamp(sourceFactor, 0, 2)
    : sourceTrustFactor(event);

  const overrideMultiplier = Number(override?.multiplier);
  const eventMultiplier = Number.isFinite(overrideMultiplier)
    ? clamp(overrideMultiplier, 0, 3)
    : 1;

  return {
    included: true,
    reason: null,
    sourceFactor: normalizedSourceFactor,
    eventMultiplier,
  };
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

function signalQualityLevel(score) {
  if (score >= 80) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

function behaviorLevelFor(score) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 50) return "Stable";
  if (score >= 35) return "At Risk";
  return "Poor";
}

function behaviorWeightOf(event) {
  if (typeof BEHAVIOR_EVENT_WEIGHTS[event.eventType] === "number") {
    return BEHAVIOR_EVENT_WEIGHTS[event.eventType];
  }
  if (event.kind === "positive") return 4;
  if (event.kind === "negative") return -6;
  return 0;
}

function calculateBehaviorScore(events, nowMs) {
  let base = 60;
  let onTime30d = 0;
  let missed30d = 0;
  let abandoned30d = 0;
  let severeRisk30d = 0;

  const severeTypes = new Set(["api_key_leak", "security_flag", "abuse_report", "impersonation_report"]);

  for (const event of events) {
    const ageDays = daysSince(event.createdAt, nowMs);
    const confidence = confidenceFactor(event);
    const sourceFactor = sourceTrustFactor(event);
    const contribution = behaviorWeightOf(event) * decay(ageDays) * confidence * sourceFactor;
    base += contribution;

    if (ageDays <= 30) {
      if (event.eventType === "completed_task_on_time") onTime30d += 1;
      if (event.eventType === "missed_deadline") missed30d += 1;
      if (event.eventType === "task_abandoned") abandoned30d += 1;
      if (severeTypes.has(String(event.eventType ?? "").trim().toLowerCase())) severeRisk30d += 1;
    }
  }

  const trustPenalty = Math.min(12, severeRisk30d * 4);
  const score = Math.round(clamp(base - trustPenalty, SCORE_MIN, SCORE_MAX));
  const level = behaviorLevelFor(score);
  const onTimeRatio30d =
    onTime30d + missed30d > 0 ? Math.round((onTime30d / (onTime30d + missed30d)) * 100) : null;

  let explanation = `${level}: behavior reliability score based on recent execution outcomes.`;
  if (onTimeRatio30d !== null) {
    explanation = `${level}: ${onTimeRatio30d}% on-time rate in last 30 days (${onTime30d} on time / ${missed30d} missed).`;
  }

  return {
    score,
    level,
    explanation,
    trustInfluencePenalty: trustPenalty,
    breakdown: {
      onTime30d,
      missedDeadline30d: missed30d,
      abandoned30d,
      severeRisk30d,
      onTimeRate30d: onTimeRatio30d,
    },
  };
}

export function scoreAgent(agentId, events, options = {}) {
  const includeTrace = options.includeTrace === true;
  const traceLimit = clamp(Number(options.traceLimit ?? 5), 1, 20);
  const policy = normalizedPolicy(options.policy);
  const nowMs = Date.now();
  let scoreValue = SCORE_BASELINE;
  let positive30d = 0;
  let neutral30d = 0;
  let negative30d = 0;
  const trace = [];
  const policySummary = {
    excludedByConfidence: 0,
    excludedBySource: 0,
    excludedByEventOverride: 0,
    excludedByVerification: 0,
    included: 0,
  };
  let qualityNumerator = 0;
  let qualityDenominator = 0;
  let qualitySampleSize = 0;
  let qualityVerifiedEvents = 0;
  let severeNegative30d = 0;

  for (const event of events) {
    const ageDays = daysSince(event.createdAt, nowMs);
    const baseWeight = weightOf(event);
    const decayFactor = decay(ageDays);
    const confidence = confidenceFactor(event);
    const policyEffect = evaluatePolicy(event, policy, confidence);

    let sourceFactor = policyEffect.sourceFactor ?? sourceTrustFactor(event);
    let eventMultiplier = policyEffect.eventMultiplier ?? 1;
    let contribution = 0;

    if (policyEffect.included) {
      contribution = baseWeight * decayFactor * sourceFactor * confidence * eventMultiplier;
      scoreValue += contribution;
      policySummary.included += 1;
      qualitySampleSize += 1;
      if (String(event.sourceType ?? "").trim().toLowerCase() === "verified_integration") {
        qualityVerifiedEvents += 1;
      }
      const qualityWeight = Math.max(0.05, decayFactor * confidence);
      qualityDenominator += qualityWeight;
      qualityNumerator += qualityWeight * sourceQualityFactor(event);
    } else if (policyEffect.reason === "below_min_confidence") {
      policySummary.excludedByConfidence += 1;
    } else if (policyEffect.reason === "source_not_allowed") {
      policySummary.excludedBySource += 1;
    } else if (policyEffect.reason === "event_override_disabled") {
      policySummary.excludedByEventOverride += 1;
    } else if (policyEffect.reason === "unverified_sensitive_event") {
      policySummary.excludedByVerification += 1;
    }

    const verificationStatus = policyEffect.included
      ? (String(event.sourceType ?? "").trim().toLowerCase() === "verified_integration"
          ? "verified"
          : "unverified")
      : "policy_excluded";

    if (ageDays <= 30) {
      if (event.kind === "positive") positive30d += 1;
      if (event.kind === "neutral") neutral30d += 1;
      if (event.kind === "negative") negative30d += 1;
      if (SENSITIVE_EVENT_TYPES.has(String(event.eventType ?? "").trim().toLowerCase()) && event.kind === "negative") {
        severeNegative30d += 1;
      }
    }

    if (includeTrace) {
      trace.push({
        id: event.id,
        kind: event.kind,
        eventType: event.eventType,
        source: event.source,
        sourceType: event.sourceType,
        externalEventId: event.externalEventId,
        verificationStatus,
        included: policyEffect.included,
        excludedReason: policyEffect.reason,
        baseWeight,
        decayFactor: Number(decayFactor.toFixed(4)),
        sourceFactor: Number(sourceFactor.toFixed(4)),
        confidenceFactor: Number(confidence.toFixed(4)),
        eventMultiplier: Number(eventMultiplier.toFixed(4)),
        contribution: Number(contribution.toFixed(4)),
        createdAt: event.createdAt,
      });
    }
  }

  const trustScore = Math.round(clamp(scoreValue, SCORE_MIN, SCORE_MAX));
  const behavior = calculateBehaviorScore(events, nowMs);
  let behaviorInfluence = 0;
  if (behavior.score <= 35) behaviorInfluence -= 6;
  else if (behavior.score <= 50) behaviorInfluence -= 3;
  else if (behavior.score >= 85) behaviorInfluence += 2;
  if (behavior.breakdown.abandoned30d >= 2) behaviorInfluence -= 4;

  const score = trustScore;
  const level = levelFor(score);
  const signalQualityScore = qualityDenominator > 0
    ? Math.round(clamp((qualityNumerator / qualityDenominator) * 100, 0, 100))
    : 0;
  const signalQuality = {
    score: signalQualityScore,
    level: signalQualityLevel(signalQualityScore),
    sampleSize: qualitySampleSize,
    verifiedPercent: qualitySampleSize > 0
      ? Math.round((qualityVerifiedEvents / qualitySampleSize) * 100)
      : 0,
  };
  const history = [...events]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((event) => ({
      eventType: event.eventType,
      kind: event.kind,
      sourceType: event.sourceType,
      confidence: event.confidence,
      verificationStatus:
        String(event.sourceType ?? "").trim().toLowerCase() === "verified_integration"
          ? "verified"
          : "unverified",
      id: event.id,
      details: event.details,
      source: event.source,
      externalEventId: event.externalEventId,
      createdAt: event.createdAt
    }));

  const result = {
    agentId,
    score,
    level,
    explanation:
      behaviorInfluence === 0
        ? explanation(level, positive30d, negative30d)
        : `${explanation(level, positive30d, negative30d)} Behavior influence ${behaviorInfluence > 0 ? "+" : ""}${behaviorInfluence}.`,
    signalQuality,
    breakdown: {
      positive30d,
      neutral30d,
      negative30d,
      severeNegative30d,
      lifetimeEvents: events.length,
      policy: policySummary,
    },
    history,
    behavior: {
      ...behavior,
      trustInfluence: behaviorInfluence,
    },
    trust: {
      baseScore: trustScore,
      behaviorInfluence,
      finalScore: score,
    },
    scoreModel: {
      trustScore: score,
      behaviorScore: behavior.score,
      coupling: "separate_base_scores_with_policy_layer",
    },
  };

  if (includeTrace) {
    result.trace = trace
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, traceLimit);
  }

  return result;
}
