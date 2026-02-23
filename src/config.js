export const PLANS = {
  free: {
    maxAgents: 5,
    maxEventsPerMonth: 100,
    maxChecksPerMonth: 200,
    webhooks: false,
    bulkExports: false,
    support: "basic"
  },
  starter: {
    maxAgents: 100,
    maxEventsPerMonth: 5000,
    maxChecksPerMonth: 10000,
    webhooks: true,
    bulkExports: false,
    support: "email"
  },
  pro: {
    maxAgents: 1000,
    maxEventsPerMonth: 100000,
    maxChecksPerMonth: 200000,
    webhooks: true,
    bulkExports: true,
    support: "priority"
  }
};

export const RATE_LIMITS_PER_MINUTE = {
  free: { eventWrites: 30, scoreReads: 120 },
  starter: { eventWrites: 300, scoreReads: 1200 },
  pro: { eventWrites: 1200, scoreReads: 5000 }
};

export const EVENT_WEIGHTS = {
  completed_task_on_time: 8,
  payment_success: 10,
  verification_passed: 6,
  collaborative_feedback_positive: 5,
  failed_payment: -12,
  unresolved_dispute: -10,
  security_flag: -20,
  abuse_report: -25,
  api_key_leak: -35,
  impersonation_report: -22,
  spam_report: -15,
  missed_deadline: -9,
  task_abandoned: -14,
  subscription_canceled: -6,
};

export const BEHAVIOR_EVENT_WEIGHTS = {
  completed_task_on_time: 10,
  payment_success: 3,
  verification_passed: 2,
  collaborative_feedback_positive: 4,
  failed_payment: -2,
  missed_deadline: -10,
  task_abandoned: -14,
  unresolved_dispute: -6,
  abuse_report: -8,
  spam_report: -5,
  security_flag: -4,
};

export const SENSITIVE_EVENT_TYPES = new Set([
  "payment_success",
  "failed_payment",
  "security_flag",
  "abuse_report",
  "api_key_leak",
  "impersonation_report",
  "unresolved_dispute",
]);

export const STRIPE_EVENT_TEMPLATE = {
  "payment_intent.succeeded": {
    kind: "positive",
    eventType: "payment_success",
    confidence: 0.98,
  },
  "payment_intent.payment_failed": {
    kind: "negative",
    eventType: "failed_payment",
    confidence: 0.98,
  },
  "charge.dispute.created": {
    kind: "negative",
    eventType: "unresolved_dispute",
    confidence: 0.95,
  },
  "charge.dispute.closed": {
    kind: "neutral",
    eventType: "dispute_closed",
    confidence: 0.95,
  },
  "customer.subscription.created": {
    kind: "positive",
    eventType: "verification_passed",
    confidence: 0.9,
  },
  "customer.subscription.deleted": {
    kind: "negative",
    eventType: "subscription_canceled",
    confidence: 0.9,
  },
};

export const AUTH_EVENT_TEMPLATE = {
  "signin.success": {
    kind: "positive",
    eventType: "verification_passed",
    confidence: 0.9,
  },
  "mfa.challenge.failed": {
    kind: "negative",
    eventType: "security_flag",
    confidence: 0.95,
  },
  "account.locked": {
    kind: "negative",
    eventType: "security_flag",
    confidence: 0.95,
  },
  "token.exposed": {
    kind: "negative",
    eventType: "api_key_leak",
    confidence: 0.98,
  },
  "impersonation.detected": {
    kind: "negative",
    eventType: "impersonation_report",
    confidence: 0.97,
  },
};

export const MARKETPLACE_EVENT_TEMPLATE = {
  "task.completed_on_time": {
    kind: "positive",
    eventType: "completed_task_on_time",
    confidence: 0.9,
  },
  "task.missed_deadline": {
    kind: "negative",
    eventType: "missed_deadline",
    confidence: 0.9,
  },
  "task.abandoned": {
    kind: "negative",
    eventType: "task_abandoned",
    confidence: 0.92,
  },
  "abuse.reported": {
    kind: "negative",
    eventType: "abuse_report",
    confidence: 0.95,
  },
  "dispute.opened": {
    kind: "negative",
    eventType: "unresolved_dispute",
    confidence: 0.94,
  },
};

export const SCORE_BASELINE = 50;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export const DECAY_HALF_LIFE_DAYS = 30;
