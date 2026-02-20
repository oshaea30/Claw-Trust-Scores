import crypto from "node:crypto";

export const store = {
  eventsByAgentId: new Map(),
  usageByMonthAndApiKey: new Map(),
  rateCounterByWindowAndKey: new Map(),
  recentEventHashes: new Map(),
  inboundSecretsByApiKey: new Map(),
  processedInboundEvents: new Map(),
  policyByApiKey: new Map(),
  webhooksByApiKey: new Map(),
  webhookDeliveries: new Map(),
  webhookSuppression: new Map(),
  users: new Map(),
  decisionLogsByApiKey: new Map(),
};

export function resetStore() {
  store.eventsByAgentId = new Map();
  store.usageByMonthAndApiKey = new Map();
  store.rateCounterByWindowAndKey = new Map();
  store.recentEventHashes = new Map();
  store.inboundSecretsByApiKey = new Map();
  store.processedInboundEvents = new Map();
  store.policyByApiKey = new Map();
  store.webhooksByApiKey = new Map();
  store.webhookDeliveries = new Map();
  store.webhookSuppression = new Map();
  store.users = new Map();
  store.decisionLogsByApiKey = new Map();
}

export function getMonthKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getUsage(monthKey, apiKey) {
  const usageKey = `${monthKey}:${apiKey}`;
  let usage = store.usageByMonthAndApiKey.get(usageKey);
  if (!usage) {
    usage = {
      trackedAgents: new Set(),
      eventsLogged: 0,
      scoreChecks: 0
    };
    store.usageByMonthAndApiKey.set(usageKey, usage);
  }
  return usage;
}

export function appendEvent(event) {
  const existing = store.eventsByAgentId.get(event.agentId) ?? [];
  existing.push(event);
  store.eventsByAgentId.set(event.agentId, existing);
}

export function getAgentEvents(agentId) {
  return store.eventsByAgentId.get(agentId) ?? [];
}

export function listWebhooks(apiKey) {
  return store.webhooksByApiKey.get(apiKey) ?? [];
}

export function putWebhooks(apiKey, webhooks) {
  store.webhooksByApiKey.set(apiKey, webhooks);
}

export function appendWebhookDelivery(webhookId, delivery) {
  const existing = store.webhookDeliveries.get(webhookId) ?? [];
  existing.unshift(delivery);
  store.webhookDeliveries.set(webhookId, existing.slice(0, 20));
}

export function appendDecisionLog(apiKey, entry, maxItems = 5000) {
  const existing = store.decisionLogsByApiKey.get(apiKey) ?? [];
  const enriched = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  existing.unshift(enriched);
  store.decisionLogsByApiKey.set(apiKey, existing.slice(0, maxItems));
  return enriched;
}

export function listDecisionLogs(apiKey) {
  return store.decisionLogsByApiKey.get(apiKey) ?? [];
}
