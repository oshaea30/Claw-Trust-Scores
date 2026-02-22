import { scoreForAccountAgent } from "./service.js";

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function riskFromPayload(payload) {
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
  const riskPenalty = riskFromPayload(payload);
  const adjustedScore = Math.max(0, trust.score - riskPenalty);

  let decision = "allow";
  let reason = `Trust score ${trust.score} is acceptable for this action.`;

  if (adjustedScore < 35) {
    decision = "block";
    reason = `Blocked: adjusted score ${adjustedScore} is below hard minimum 35.`;
  } else if (adjustedScore < 55) {
    decision = "review";
    reason = `Manual review required: adjusted score ${adjustedScore} is in caution band.`;
  }

  return {
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
      policy: {
        adjustedScore,
        riskPenalty,
        thresholds: {
          blockBelow: 35,
          reviewBelow: 55
        }
      }
    }
  };
}
