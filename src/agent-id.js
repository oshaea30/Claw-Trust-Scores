export function normalizeAgentId(input) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return "";
  // Canonicalize ephemeral run-scoped IDs so repeated cron/task executions
  // roll up to a stable agent identity.
  return raw.replace(/:run:[^:]+$/i, "");
}
