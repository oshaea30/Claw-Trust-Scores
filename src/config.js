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
  spam_report: -15
};

export const SCORE_BASELINE = 50;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export const DECAY_HALF_LIFE_DAYS = 30;
