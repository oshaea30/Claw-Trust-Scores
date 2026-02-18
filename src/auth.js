/**
 * Authentication middleware.
 *
 * Delegates to key-store.js which merges static (env var) and dynamic
 * (self-serve signup) keys. No per-request env parsing.
 */

import { getKeyTier } from "./key-store.js";

export function authenticate(request) {
  const key = request.headers["x-api-key"]?.trim();
  if (!key) return null;

  const tier = getKeyTier(key);
  if (!tier) return null;

  return { apiKey: key, tier };
}
