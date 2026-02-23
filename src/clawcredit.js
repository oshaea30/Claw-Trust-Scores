import { scoreForAccountAgent } from "./service.js";
import { logDecision } from "./audit.js";

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function riskFromPayload(payload) {
  let risk = 0;

  const amountUsd = toNumber(payload.amountUsd, 0);
  if (amountUsd >= 1000) risk += 10;
  if (amountUsd >= 5000) risk += 15;
  if (amountUsd >= 20000) risk += 20;

  if (payload.newPayee === true) risk += 15;
  if (payload.firstTimeCounterparty === true) risk += 10;
  if (payload.highPrivilegeAction === true) risk += 20;
  if (payload.exposesApiKeys === true) risk += 25;

  return Math.min(risk, 60);
}

export function clawCreditPreflight({ account, payload }) {
  const agentId = String(payload.agentId ?? "").trim().toLowerCase();
  if (!agentId) {
    return { status: 400, body: { error: "agentId is required." } };
  }

  const trust = scoreForAccountAgent({ account, agentId });
  const behavior = trust.behavior;
  const riskPenalty = riskFromPayload(payload);
  let behaviorPenalty = 0;
  let behaviorCredit = 0;
  if (behavior.score < 40) behaviorPenalty = 12;
  else if (behavior.score < 55) behaviorPenalty = 6;
  else if (behavior.score >= 85) behaviorCredit = 3;

  const adjustedScore = Math.max(0, trust.score - riskPenalty - behaviorPenalty + behaviorCredit);

  let decision = "allow";
  let reason = `Trust score ${trust.score} and behavior score ${behavior.score} are acceptable for this action.`;

  if (trust.score < 35) {
    decision = "block";
    reason = `Blocked: trust score ${trust.score} is below hard minimum 35.`;
  } else if (trust.breakdown.severeNegative30d >= 2 && riskPenalty >= 20) {
    decision = "block";
    reason = `Blocked: severe trust incidents with high-risk context.`;
  } else if (adjustedScore < 35) {
    decision = "block";
    reason = `Blocked: decision score ${adjustedScore} is below hard minimum 35.`;
  } else if (adjustedScore < 55) {
    decision = "review";
    reason = `Manual review required: decision score ${adjustedScore} is in caution band.`;
  }

  const result = {
    status: 200,
    body: {
      integration: "clawcredit",
      decision,
      reason,
      trust: {
        agentId,
        score: trust.score,
        level: trust.level,
        explanation: trust.explanation
      },
      behavior: {
        score: behavior.score,
        level: behavior.level,
        explanation: behavior.explanation,
      },
      policy: {
        adjustedScore,
        riskPenalty,
        behaviorPenalty,
        behaviorCredit,
        thresholds: {
          blockBelow: 35,
          reviewBelow: 55
        }
      }
    }
  };

  logDecision({
    account,
    action: "clawcredit_preflight",
    agentId,
    outcome: decision,
    score: adjustedScore,
    reason,
    metadata: {
      trustScore: trust.score,
      behaviorScore: behavior.score,
      riskPenalty,
      behaviorPenalty,
      behaviorCredit,
    },
  });

  return result;
}
