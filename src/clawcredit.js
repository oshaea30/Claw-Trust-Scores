import { logDecision } from "./audit.js";
import { getAgentEvents } from "./store.js";
import { scoreAgent } from "./scoring.js";

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

export function clawCreditPreflight({ payload, account }) {
  const agentId = String(payload.agentId ?? "").trim().toLowerCase();
  if (!agentId) {
    return { status: 400, body: { error: "agentId is required." } };
  }

  const trust = scoreAgent(agentId, getAgentEvents(agentId));
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

  if (account) {
    logDecision({
      account,
      action: "clawcredit_preflight",
      agentId,
      outcome: decision,
      score: adjustedScore,
      reason,
      metadata: {
        trustScore: trust.score,
        amountUsd: Number(payload.amountUsd ?? 0),
        newPayee: payload.newPayee === true,
        firstTimeCounterparty: payload.firstTimeCounterparty === true,
      },
    });
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
