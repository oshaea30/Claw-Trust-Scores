import { STRIPE_EVENT_TEMPLATE } from "./config.js";

const TEMPLATE_SUMMARY = {
  stripe: {
    source: "stripe",
    status: "live",
    description: "Map Stripe event types to trust-scoring events automatically.",
    supportedEventTypes: Object.keys(STRIPE_EVENT_TEMPLATE),
  },
};

export function listIntegrationTemplates() {
  return {
    templates: TEMPLATE_SUMMARY,
  };
}
