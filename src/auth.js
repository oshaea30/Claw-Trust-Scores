import crypto from "node:crypto";

import { getAllUsers, getKeyTier } from "./key-store.js";
import { scheduleFlush } from "./persistence.js";
import { logSecurityEvent } from "./security-log.js";
import { store } from "./store.js";

function defaultDevKeys() {
  return {
    demo_free_key: "free",
    demo_starter_key: "starter",
    demo_pro_key: "pro"
  };
}

function parseKeys(raw) {
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      return {};
    }
    return defaultDevKeys();
  }

  const parsed = {};
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [key, tier] = trimmed.split(":").map((part) => part.trim());
    if (!key || !tier) continue;
    if (tier === "free" || tier === "starter" || tier === "pro") {
      parsed[key] = tier;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : process.env.NODE_ENV === "production" ? {} : defaultDevKeys();
}

function currentApiKeys() {
  return parseKeys(process.env.TRUST_API_KEYS);
}

function userApiKeys() {
  const users = getAllUsers();
  return Object.fromEntries(users.map((entry) => [entry.apiKey, entry.tier]));
}

function mergedApiKeys() {
  return {
    ...currentApiKeys(),
    ...userApiKeys(),
    ...Object.fromEntries(store.managedApiKeys.entries())
  };
}

function tierValid(tier) {
  return tier === "free" || tier === "starter" || tier === "pro";
}

function maskKey(key) {
  if (!key || key.length < 8) return "****";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function randomApiKey() {
  return `claw_live_${crypto.randomBytes(16).toString("hex")}`;
}

export function listApiKeys() {
  const envKeys = currentApiKeys();
  const userKeys = userApiKeys();
  const managed = Object.fromEntries(store.managedApiKeys.entries());
  const merged = { ...envKeys, ...userKeys, ...managed };

  return Object.entries(merged).map(([key, tier]) => ({
    keyMasked: maskKey(key),
    tier,
    source: Object.prototype.hasOwnProperty.call(managed, key)
      ? "managed"
      : Object.prototype.hasOwnProperty.call(userKeys, key)
        ? "self_serve"
        : "env",
    revoked: store.revokedApiKeys.has(key)
  }));
}

export function issueApiKey({ tier }) {
  if (!tierValid(tier)) {
    return { status: 400, body: { error: "tier must be one of: free, starter, pro." } };
  }
  let key = randomApiKey();
  while (mergedApiKeys()[key]) {
    key = randomApiKey();
  }
  store.managedApiKeys.set(key, tier);
  store.revokedApiKeys.delete(key);
  scheduleFlush();
  return {
    status: 201,
    body: {
      apiKey: key,
      tier
    }
  };
}

export function revokeApiKey({ apiKey }) {
  const key = String(apiKey ?? "").trim();
  if (!key) {
    return { status: 400, body: { error: "apiKey is required." } };
  }
  const keys = mergedApiKeys();
  if (!keys[key]) {
    return { status: 404, body: { error: "API key not found." } };
  }
  store.managedApiKeys.delete(key);
  store.revokedApiKeys.add(key);
  scheduleFlush();
  return {
    status: 200,
    body: { revoked: true, keyMasked: maskKey(key) }
  };
}

export function rotateApiKey({ apiKey }) {
  const key = String(apiKey ?? "").trim();
  if (!key) {
    return { status: 400, body: { error: "apiKey is required." } };
  }

  const keys = mergedApiKeys();
  const tier = keys[key];
  if (!tier) {
    return { status: 404, body: { error: "API key not found." } };
  }

  store.revokedApiKeys.add(key);
  store.managedApiKeys.delete(key);
  let newKey = randomApiKey();
  while (keys[newKey] || store.managedApiKeys.has(newKey)) {
    newKey = randomApiKey();
  }
  store.managedApiKeys.set(newKey, tier);
  scheduleFlush();

  return {
    status: 200,
    body: {
      oldKeyMasked: maskKey(key),
      apiKey: newKey,
      tier
    }
  };
}

export function authenticate(request) {
  const key = request.headers["x-api-key"]?.trim();
  if (!key) return null;
  if (store.revokedApiKeys.has(key)) {
    logSecurityEvent("revoked_key_attempt", { keyMasked: maskKey(key) });
    return null;
  }
  const tier = mergedApiKeys()[key] ?? getKeyTier(key);
  if (!tier) return null;
  return { apiKey: key, tier };
}
