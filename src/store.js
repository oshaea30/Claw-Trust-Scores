export const store = {
  eventsByAgentId: new Map(),
  attestationsByApiKey: new Map(),
  usageByMonthAndApiKey: new Map(),
  rateCounterByWindowAndKey: new Map(),
  recentEventHashes: new Map(),
  managedApiKeys: new Map(),
  revokedApiKeys: new Set(),
  decisionLogsByApiKey: new Map(),
  inboundSecretsByApiKey: new Map(),
  processedInboundEvents: new Map(),
  webhooksByApiKey: new Map(),
  webhookDeliveries: new Map(),
  webhookSuppression: new Map()
};

export function resetStore() {
  store.eventsByAgentId = new Map();
  store.attestationsByApiKey = new Map();
  store.usageByMonthAndApiKey = new Map();
  store.rateCounterByWindowAndKey = new Map();
  store.recentEventHashes = new Map();
  store.managedApiKeys = new Map();
  store.revokedApiKeys = new Set();
  store.decisionLogsByApiKey = new Map();
  store.inboundSecretsByApiKey = new Map();
  store.processedInboundEvents = new Map();
  store.webhooksByApiKey = new Map();
  store.webhookDeliveries = new Map();
  store.webhookSuppression = new Map();
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

export function appendEvent(scopeIdOrEvent, maybeEvent) {
  const scopeId = maybeEvent ? scopeIdOrEvent : scopeIdOrEvent.agentId;
  const event = maybeEvent ?? scopeIdOrEvent;
  const existing = store.eventsByAgentId.get(scopeId) ?? [];
  existing.push(event);
  store.eventsByAgentId.set(scopeId, existing);
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

export function appendDecisionLog(apiKey, row) {
  const existing = store.decisionLogsByApiKey.get(apiKey) ?? [];
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    ...row
  };
  existing.unshift(entry);
  store.decisionLogsByApiKey.set(apiKey, existing.slice(0, 5000));
  return entry;
}

export function listDecisionLogs(apiKey) {
  return store.decisionLogsByApiKey.get(apiKey) ?? [];
}
