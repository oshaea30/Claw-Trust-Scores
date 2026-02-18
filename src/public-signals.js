import { scoreAgent } from "./scoring.js";
import { riskFromPayload } from "./clawcredit.js";

function event(agentId, kind, eventType, hoursAgo, details = "") {
  return {
    id: `${agentId}:${eventType}:${hoursAgo}`,
    agentId,
    kind,
    eventType,
    details,
    createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function trendLabel(delta) {
  if (delta >= 6) return `+${delta} this week`;
  if (delta > 0) return `+${delta} trend`;
  if (delta <= -10) return `${delta} risk spike`;
  if (delta < 0) return `${delta} drift`;
  return "0 stable";
}

function updatedLabel(minutesAgo) {
  return `updated ${minutesAgo}m ago`;
}

function scoreWithTrend(agentId, events) {
  const nowScore = scoreAgent(agentId, events).score;
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekAgoScore = scoreAgent(
    agentId,
    events.filter((entry) => new Date(entry.createdAt).getTime() <= cutoffMs)
  ).score;
  return { score: nowScore, delta: nowScore - weekAgoScore };
}

export function getHeroSnapshot() {
  const highEvents = [
    event("hero:high", "positive", "payment_success", 2, "clean payout"),
    event("hero:high", "positive", "completed_task_on_time", 7, "met SLA"),
    event("hero:high", "positive", "verification_passed", 26, "re-verified"),
    event("hero:high", "positive", "payment_success", 52, "settled"),
    event("hero:high", "neutral", "collaborative_feedback_positive", 95, "stable"),
  ];

  const lowEvents = [
    event("hero:low", "negative", "abuse_report", 3, "abuse signal"),
    event("hero:low", "negative", "security_flag", 8, "high-risk action"),
    event("hero:low", "negative", "failed_payment", 22, "failed payment"),
    event("hero:low", "negative", "impersonation_report", 61, "impersonation"),
  ];

  const stableEvents = [
    event("hero:stable", "positive", "completed_task_on_time", 4, "met SLA"),
    event("hero:stable", "positive", "verification_passed", 15, "verified"),
    event("hero:stable", "neutral", "collaborative_feedback_positive", 44, "steady"),
    event("hero:stable", "negative", "failed_payment", 120, "old payment issue"),
  ];

  const high = scoreWithTrend("hero:high", highEvents);
  const low = scoreWithTrend("hero:low", lowEvents);
  const stable = scoreWithTrend("hero:stable", stableEvents);

  const decisionEvents = [
    event("hero:decision", "positive", "payment_success", 8, "payout"),
    event("hero:decision", "positive", "completed_task_on_time", 18, "task done"),
    event("hero:decision", "negative", "failed_payment", 34, "late settlement"),
  ];
  const trustScore = scoreAgent("hero:decision", decisionEvents).score;
  const riskPayload = {
    amountUsd: 2500,
    newPayee: true,
    firstTimeCounterparty: true,
  };
  const riskPenalty = riskFromPayload(riskPayload);
  const adjustedScore = clamp(trustScore - riskPenalty, 0, 100);
  const decision =
    adjustedScore < 35 ? "block" : adjustedScore < 55 ? "review" : "allow";

  return {
    generatedAt: new Date().toISOString(),
    cards: {
      high: {
        score: high.score,
        trend: trendLabel(high.delta),
        updated: updatedLabel(2),
      },
      low: {
        score: low.score,
        trend: trendLabel(low.delta),
        updated: updatedLabel(1),
      },
      stable: {
        score: stable.score,
        trend: trendLabel(stable.delta),
        updated: updatedLabel(4),
      },
      decision: {
        adjustedScore,
        decision,
        context: "$2,500 + new payee",
        updated: "policy run now",
      },
    },
  };
}
