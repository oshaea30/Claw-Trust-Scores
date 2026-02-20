import {
  AUTH_EVENT_TEMPLATE,
  MARKETPLACE_EVENT_TEMPLATE,
  STRIPE_EVENT_TEMPLATE,
} from "./config.js";

const TEMPLATES = {
  stripe: {
    source: "stripe",
    status: "live",
    description: "Map Stripe payment, dispute, and subscription events to trust signals.",
    mappings: STRIPE_EVENT_TEMPLATE,
  },
  auth: {
    source: "auth",
    status: "live",
    description: "Map authentication/security provider events to trust signals.",
    mappings: AUTH_EVENT_TEMPLATE,
  },
  marketplace: {
    source: "marketplace",
    status: "live",
    description: "Map task and abuse moderation events to trust signals.",
    mappings: MARKETPLACE_EVENT_TEMPLATE,
  },
};

function normalizedSource(source) {
  return String(source ?? "").trim().toLowerCase();
}

function normalizedProviderEventType(providerEventType) {
  return String(providerEventType ?? "").trim().toLowerCase();
}

export function listIntegrationTemplates() {
  return {
    templates: Object.fromEntries(
      Object.entries(TEMPLATES).map(([name, config]) => [
        name,
        {
          source: config.source,
          status: config.status,
          description: config.description,
          supportedEventTypes: Object.keys(config.mappings),
        },
      ])
    ),
  };
}

export function mapProviderEvent({ source, providerEventType }) {
  const normalized = normalizedSource(source);
  const template = TEMPLATES[normalized];
  if (!template) {
    return {
      ok: false,
      error: "Unsupported source. Use /v1/integrations/templates for supported sources.",
    };
  }

  const type = normalizedProviderEventType(providerEventType);
  const mapping = template.mappings[type];
  if (!mapping) {
    return {
      ok: false,
      error: "Unsupported providerEventType for this source.",
      source: normalized,
      supportedEventTypes: Object.keys(template.mappings),
    };
  }

  return {
    ok: true,
    source: normalized,
    providerEventType: type,
    mapping: { ...mapping },
  };
}
