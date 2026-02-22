import fs from "node:fs";
import path from "node:path";

import { store } from "./store.js";

let flushTimer = null;
let loaded = false;

function currentDataDir() {
  return process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
}

function currentStatePath() {
  return path.join(currentDataDir(), "state.json");
}

function toObjectMap(map) {
  return Object.fromEntries(map.entries());
}

function loadObjectMap(input) {
  if (!input || typeof input !== "object") return new Map();
  return new Map(Object.entries(input));
}

export function resetPersistenceStateForTest() {
  loaded = false;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function loadStoreFromDisk() {
  if (loaded) return;
  loaded = true;

  try {
    const statePath = currentStatePath();
    if (!fs.existsSync(statePath)) return;
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));

    store.eventsByAgentId = loadObjectMap(parsed.eventsByAgentId);

    const usageMap = loadObjectMap(parsed.usageByMonthAndApiKey);
    store.usageByMonthAndApiKey = new Map(
      [...usageMap.entries()].map(([key, value]) => [
        key,
        {
          trackedAgents: new Set(Array.isArray(value?.trackedAgents) ? value.trackedAgents : []),
          eventsLogged: Number(value?.eventsLogged ?? 0),
          scoreChecks: Number(value?.scoreChecks ?? 0)
        }
      ])
    );

    store.webhooksByApiKey = loadObjectMap(parsed.webhooksByApiKey);
    store.webhookDeliveries = loadObjectMap(parsed.webhookDeliveries);
    store.webhookSuppression = loadObjectMap(parsed.webhookSuppression);
    store.managedApiKeys = loadObjectMap(parsed.managedApiKeys);
    store.revokedApiKeys = new Set(Array.isArray(parsed.revokedApiKeys) ? parsed.revokedApiKeys : []);
  } catch {
    // Ignore broken state and start fresh.
  }
}

export function flushStoreToDisk() {
  try {
    const dataDir = currentDataDir();
    const statePath = currentStatePath();
    fs.mkdirSync(dataDir, { recursive: true });
    const usage = Object.fromEntries(
      [...store.usageByMonthAndApiKey.entries()].map(([key, value]) => [
        key,
        {
          trackedAgents: [...value.trackedAgents],
          eventsLogged: value.eventsLogged,
          scoreChecks: value.scoreChecks
        }
      ])
    );

    const payload = {
      eventsByAgentId: toObjectMap(store.eventsByAgentId),
      usageByMonthAndApiKey: usage,
      webhooksByApiKey: toObjectMap(store.webhooksByApiKey),
      webhookDeliveries: toObjectMap(store.webhookDeliveries),
      webhookSuppression: toObjectMap(store.webhookSuppression),
      managedApiKeys: toObjectMap(store.managedApiKeys),
      revokedApiKeys: [...store.revokedApiKeys]
    };

    fs.writeFileSync(statePath, JSON.stringify(payload), "utf8");
  } catch {
    // Keep serving even if persistence fails.
  }
}

export function scheduleFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
  }

  flushTimer = setTimeout(() => {
    flushStoreToDisk();
    flushTimer = null;
  }, 150);
}

export function getPersistenceStatePath() {
  return currentStatePath();
}
