import { scheduleFlush } from "./persistence.js";
import { appendDecisionLog, listDecisionLogs } from "./store.js";

function toSafeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function logDecision(args) {
  const { account, action, agentId, outcome, score, reason, metadata = {} } = args;
  const entry = appendDecisionLog(account.apiKey, {
    action,
    agentId,
    outcome,
    score,
    reason,
    metadata,
  });
  scheduleFlush();
  return entry;
}

export function getDecisionLogs(args) {
  const { account, query } = args;
  const format = (query?.format ?? "json").toLowerCase();
  const limit = Math.min(toSafeInt(query?.limit, 200), 2000);

  const rows = listDecisionLogs(account.apiKey).slice(0, limit);

  if (format === "csv") {
    const header = ["timestamp", "action", "agentId", "outcome", "score", "reason", "metadata"];
    const lines = [header.join(",")];

    for (const row of rows) {
      lines.push(
        [
          csvEscape(row.timestamp),
          csvEscape(row.action),
          csvEscape(row.agentId),
          csvEscape(row.outcome),
          csvEscape(typeof row.score === "number" ? row.score : ""),
          csvEscape(row.reason ?? ""),
          csvEscape(JSON.stringify(row.metadata ?? {})),
        ].join(",")
      );
    }

    return {
      status: 200,
      type: "text/csv; charset=utf-8",
      filename: `decision-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      body: lines.join("\n"),
    };
  }

  return {
    status: 200,
    type: "application/json",
    body: {
      count: rows.length,
      limit,
      logs: rows,
    },
  };
}
