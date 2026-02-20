import { scheduleFlush } from "./persistence.js";
import { store } from "./store.js";

const DEFAULT_SOURCE_TYPE_MULTIPLIERS = {
  verified_integration: 1,
  self_reported: 0.75,
  unverified: 0.6,
  manual: 1,
};

const POLICY_PRESETS = {
  open: {
    minConfidence: 0,
    allowedSources: [],
    sourceTypeMultipliers: {
      verified_integration: 1,
      self_reported: 0.75,
      unverified: 0.6,
      manual: 1,
    },
    eventOverrides: {},
    requireVerifiedSensitive: false,
    description: "Accept broad signals. Best for fast onboarding and experimentation.",
  },
  balanced: {
    minConfidence: 0.35,
    allowedSources: [],
    sourceTypeMultipliers: {
      verified_integration: 1,
      self_reported: 0.55,
      unverified: 0.35,
      manual: 0.75,
    },
    eventOverrides: {},
    requireVerifiedSensitive: true,
    description: "Default production posture: verified signals favored, low-confidence noise reduced.",
  },
  strict: {
    minConfidence: 0.75,
    allowedSources: [],
    sourceTypeMultipliers: {
      verified_integration: 1,
      self_reported: 0.2,
      unverified: 0,
      manual: 0.4,
    },
    eventOverrides: {},
    requireVerifiedSensitive: true,
    description: "High-assurance mode: only high-confidence signals have meaningful impact.",
  },
};

export function defaultPolicy() {
  return {
    minConfidence: 0,
    allowedSources: [],
    sourceTypeMultipliers: { ...DEFAULT_SOURCE_TYPE_MULTIPLIERS },
    eventOverrides: {},
    requireVerifiedSensitive: false,
  };
}

function clonePreset(name) {
  const preset = POLICY_PRESETS[name];
  if (!preset) return null;
  return {
    minConfidence: preset.minConfidence,
    allowedSources: [...preset.allowedSources],
    sourceTypeMultipliers: { ...preset.sourceTypeMultipliers },
    eventOverrides: { ...preset.eventOverrides },
    requireVerifiedSensitive: preset.requireVerifiedSensitive,
    preset: name,
    presetDescription: preset.description,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSource(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeEventType(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeSourceType(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeAllowedSources(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error("allowedSources must be an array of strings.");
  const values = [...new Set(input.map(normalizeSource).filter(Boolean))].slice(0, 100);
  return values;
}

function normalizeSourceTypeMultipliers(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("sourceTypeMultipliers must be an object.");
  }
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeSourceType(rawKey);
    if (!key) continue;
    const multiplier = Number(rawValue);
    if (!Number.isFinite(multiplier)) {
      throw new Error(`sourceTypeMultipliers.${key} must be a number.`);
    }
    output[key] = clamp(multiplier, 0, 2);
  }
  return output;
}

function normalizeEventOverrides(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("eventOverrides must be an object.");
  }

  const output = {};
  for (const [rawEventType, rawOverride] of Object.entries(input)) {
    const eventType = normalizeEventType(rawEventType);
    if (!eventType) continue;
    if (!rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) {
      throw new Error(`eventOverrides.${eventType} must be an object.`);
    }
    const normalized = {};
    if (rawOverride.enabled !== undefined) {
      if (typeof rawOverride.enabled !== "boolean") {
        throw new Error(`eventOverrides.${eventType}.enabled must be boolean.`);
      }
      normalized.enabled = rawOverride.enabled;
    }
    if (rawOverride.multiplier !== undefined) {
      const multiplier = Number(rawOverride.multiplier);
      if (!Number.isFinite(multiplier)) {
        throw new Error(`eventOverrides.${eventType}.multiplier must be a number.`);
      }
      normalized.multiplier = clamp(multiplier, 0, 3);
    }
    output[eventType] = normalized;
  }
  return output;
}

function ensurePolicyMap() {
  if (!store.policyByApiKey) {
    store.policyByApiKey = new Map();
  }
}

export function getPolicy(apiKey) {
  ensurePolicyMap();
  const stored = store.policyByApiKey.get(apiKey);
  const base = defaultPolicy();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    sourceTypeMultipliers: {
      ...base.sourceTypeMultipliers,
      ...(stored.sourceTypeMultipliers ?? {}),
    },
    eventOverrides: {
      ...(stored.eventOverrides ?? {}),
    },
  };
}

export function setPolicy(apiKey, payload) {
  ensurePolicyMap();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Policy payload must be a JSON object.");
  }

  const current = getPolicy(apiKey);
  const next = { ...current };

  if (payload.minConfidence !== undefined) {
    const minConfidence = Number(payload.minConfidence);
    if (!Number.isFinite(minConfidence)) {
      throw new Error("minConfidence must be a number between 0 and 1.");
    }
    next.minConfidence = clamp(minConfidence, 0, 1);
  }

  const allowedSources = normalizeAllowedSources(payload.allowedSources);
  if (allowedSources !== undefined) next.allowedSources = allowedSources;

  const sourceTypeMultipliers = normalizeSourceTypeMultipliers(payload.sourceTypeMultipliers);
  if (sourceTypeMultipliers !== undefined) {
    next.sourceTypeMultipliers = {
      ...current.sourceTypeMultipliers,
      ...sourceTypeMultipliers,
    };
  }

  const eventOverrides = normalizeEventOverrides(payload.eventOverrides);
  if (eventOverrides !== undefined) {
    next.eventOverrides = {
      ...current.eventOverrides,
      ...eventOverrides,
    };
  }

  if (payload.requireVerifiedSensitive !== undefined) {
    if (typeof payload.requireVerifiedSensitive !== "boolean") {
      throw new Error("requireVerifiedSensitive must be boolean.");
    }
    next.requireVerifiedSensitive = payload.requireVerifiedSensitive;
  }

  next.updatedAt = new Date().toISOString();
  store.policyByApiKey.set(apiKey, next);
  scheduleFlush();

  return next;
}

export function resetPolicy(apiKey) {
  ensurePolicyMap();
  store.policyByApiKey.delete(apiKey);
  scheduleFlush();
  return defaultPolicy();
}

export function listPolicyPresets() {
  return {
    presets: Object.fromEntries(
      Object.keys(POLICY_PRESETS).map((name) => [name, clonePreset(name)])
    ),
    recommended: "balanced",
  };
}

export function applyPolicyPreset(apiKey, presetName) {
  ensurePolicyMap();
  const normalized = String(presetName ?? "").trim().toLowerCase();
  const preset = clonePreset(normalized);
  if (!preset) {
    throw new Error("Unknown preset. Supported presets: open, balanced, strict.");
  }
  preset.updatedAt = new Date().toISOString();
  store.policyByApiKey.set(apiKey, preset);
  scheduleFlush();
  return preset;
}
