/**
 * Key Store — single source of truth for API key → tier mappings.
 *
 * Merges two sources:
 *   1. Static keys from TRUST_API_KEYS env var (demo/manually-provisioned)
 *   2. Dynamic keys from store.users Map (self-serve signups, persisted in state.json)
 *
 * Both auth.js and selfserve.js import from here.
 */

import crypto from "node:crypto";
import { store } from "./store.js";
import { scheduleFlush } from "./persistence.js";

// ---------------------------------------------------------------------------
// Static keys (parsed once at import — no per-request overhead)
// ---------------------------------------------------------------------------

function parseEnvKeys() {
  const raw = process.env.TRUST_API_KEYS;
  if (!raw) {
    if (process.env.NODE_ENV === "production") return {};
    return {
      demo_free_key: "free",
      demo_starter_key: "starter",
      demo_pro_key: "pro",
    };
  }

  const parsed = {};
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [key, tier] = trimmed.split(":").map((p) => p.trim());
    if (key && (tier === "free" || tier === "starter" || tier === "pro")) {
      parsed[key] = tier;
    }
  }

  if (Object.keys(parsed).length === 0 && process.env.NODE_ENV !== "production") {
    return {
      demo_free_key: "free",
      demo_starter_key: "starter",
      demo_pro_key: "pro",
    };
  }

  return parsed;
}

function currentStaticKeys() {
  return parseEnvKeys();
}

function isStaticKey(apiKey) {
  return Boolean(currentStaticKeys()[apiKey]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure store.users exists (older state.json files won't have it). */
function users() {
  if (!store.users) {
    store.users = new Map();
  }
  return store.users;
}

/** Generate a claw_<32 hex> API key. */
function generateApiKey() {
  return "claw_" + crypto.randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Returns "free" | "starter" | "pro" or null if key is unknown. */
export function getKeyTier(apiKey) {
  if (!apiKey) return null;
  const staticKeys = currentStaticKeys();
  // Static keys win (admin-provisioned)
  if (staticKeys[apiKey]) return staticKeys[apiKey];
  // Dynamic keys from self-serve
  const user = users().get(apiKey);
  return user?.tier ?? null;
}

/** Returns full user record by API key, or null. */
export function getUserByKey(apiKey) {
  return users().get(apiKey) ?? null;
}

export function getAllUsers() {
  return [...users().entries()].map(([apiKey, user]) => ({ apiKey, ...user }));
}

/** Find user by email (linear scan — fine for early scale). */
export function getUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  for (const [apiKey, user] of users()) {
    if (user.email === normalized) {
      return { apiKey, ...user };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a new free-tier user. Returns { apiKey, user } or throws if email taken.
 */
export function createUser(email) {
  const normalized = email.trim().toLowerCase();

  const existing = getUserByEmail(normalized);
  if (existing) {
    return { exists: true, apiKey: existing.apiKey };
  }

  const apiKey = generateApiKey();
  const user = {
    email: normalized,
    tier: "free",
    createdAt: new Date().toISOString(),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };

  users().set(apiKey, user);
  scheduleFlush();

  return { exists: false, apiKey, user };
}

/**
 * Upgrade a key's tier. Returns true if changed, false if key not found.
 */
export function upgradeTier(apiKey, newTier, stripeData = {}) {
  const user = users().get(apiKey);
  if (!user) return false;

  user.tier = newTier;
  if (stripeData.customerId) user.stripeCustomerId = stripeData.customerId;
  if (stripeData.subscriptionId) user.stripeSubscriptionId = stripeData.subscriptionId;
  user.upgradedAt = new Date().toISOString();

  scheduleFlush();
  return true;
}

/**
 * Downgrade a key back to free (e.g. on subscription cancellation).
 */
export function downgradeTier(apiKey) {
  return upgradeTier(apiKey, "free", {});
}

/**
 * Find a user by Stripe customer ID (for webhook processing).
 */
export function getUserByStripeCustomerId(customerId) {
  for (const [apiKey, user] of users()) {
    if (user.stripeCustomerId === customerId) {
      return { apiKey, ...user };
    }
  }
  return null;
}

function moveUsageKeys(oldApiKey, newApiKey) {
  for (const [usageKey, usageValue] of [...store.usageByMonthAndApiKey.entries()]) {
    const suffix = `:${oldApiKey}`;
    if (!usageKey.endsWith(suffix)) continue;
    const monthPrefix = usageKey.slice(0, -suffix.length);
    store.usageByMonthAndApiKey.set(`${monthPrefix}:${newApiKey}`, usageValue);
    store.usageByMonthAndApiKey.delete(usageKey);
  }
}

function moveApiKeyScopedMaps(oldApiKey, newApiKey) {
  if (store.webhooksByApiKey.has(oldApiKey)) {
    store.webhooksByApiKey.set(newApiKey, store.webhooksByApiKey.get(oldApiKey));
    store.webhooksByApiKey.delete(oldApiKey);
  }

  if (store.decisionLogsByApiKey.has(oldApiKey)) {
    store.decisionLogsByApiKey.set(newApiKey, store.decisionLogsByApiKey.get(oldApiKey));
    store.decisionLogsByApiKey.delete(oldApiKey);
  }

  if (store.policyByApiKey?.has(oldApiKey)) {
    store.policyByApiKey.set(newApiKey, store.policyByApiKey.get(oldApiKey));
    store.policyByApiKey.delete(oldApiKey);
  }

  if (store.inboundSecretsByApiKey.has(oldApiKey)) {
    store.inboundSecretsByApiKey.set(newApiKey, store.inboundSecretsByApiKey.get(oldApiKey));
    store.inboundSecretsByApiKey.delete(oldApiKey);
  }

  for (const [processedKey, processedValue] of [...store.processedInboundEvents.entries()]) {
    if (!processedKey.startsWith(`${oldApiKey}:`)) continue;
    const suffix = processedKey.slice(oldApiKey.length + 1);
    store.processedInboundEvents.set(`${newApiKey}:${suffix}`, processedValue);
    store.processedInboundEvents.delete(processedKey);
  }
}

function purgeApiKeyScopedData(apiKey) {
  const hooks = store.webhooksByApiKey.get(apiKey) ?? [];
  store.webhooksByApiKey.delete(apiKey);
  store.decisionLogsByApiKey.delete(apiKey);
  store.policyByApiKey?.delete(apiKey);
  store.inboundSecretsByApiKey.delete(apiKey);

  for (const [usageKey] of [...store.usageByMonthAndApiKey.entries()]) {
    if (usageKey.endsWith(`:${apiKey}`)) {
      store.usageByMonthAndApiKey.delete(usageKey);
    }
  }

  for (const [processedKey] of [...store.processedInboundEvents.entries()]) {
    if (processedKey.startsWith(`${apiKey}:`)) {
      store.processedInboundEvents.delete(processedKey);
    }
  }

  for (const hook of hooks) {
    store.webhookDeliveries.delete(hook.id);
    for (const [suppressionKey] of [...store.webhookSuppression.entries()]) {
      if (suppressionKey.startsWith(`${hook.id}:`)) {
        store.webhookSuppression.delete(suppressionKey);
      }
    }
  }
}

export function rotateUserApiKey(oldApiKey) {
  if (!oldApiKey) return { ok: false, error: "API key is required." };
  if (isStaticKey(oldApiKey)) {
    return { ok: false, error: "Static keys cannot be rotated via API." };
  }

  const existing = users().get(oldApiKey);
  if (!existing) return { ok: false, error: "API key not found." };

  let newApiKey = generateApiKey();
  while (users().has(newApiKey) || isStaticKey(newApiKey)) {
    newApiKey = generateApiKey();
  }

  users().set(newApiKey, {
    ...existing,
    rotatedAt: new Date().toISOString(),
  });
  users().delete(oldApiKey);

  moveUsageKeys(oldApiKey, newApiKey);
  moveApiKeyScopedMaps(oldApiKey, newApiKey);

  scheduleFlush();
  return { ok: true, apiKey: newApiKey, tier: existing.tier };
}

export function revokeUserApiKey(apiKey) {
  if (!apiKey) return { ok: false, error: "API key is required." };
  if (isStaticKey(apiKey)) {
    return { ok: false, error: "Static keys cannot be revoked via API." };
  }

  const existing = users().get(apiKey);
  if (!existing) return { ok: false, error: "API key not found." };

  users().delete(apiKey);
  purgeApiKeyScopedData(apiKey);
  scheduleFlush();

  return { ok: true, email: existing.email };
}
