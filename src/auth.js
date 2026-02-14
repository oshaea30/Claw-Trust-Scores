function parseKeys(raw) {
  if (!raw) {
    return {
      demo_free_key: "free",
      demo_starter_key: "starter",
      demo_pro_key: "pro"
    };
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

  return Object.keys(parsed).length > 0
    ? parsed
    : {
        demo_free_key: "free",
        demo_starter_key: "starter",
        demo_pro_key: "pro"
      };
}

const API_KEYS = parseKeys(process.env.TRUST_API_KEYS);

export function authenticate(request) {
  const key = request.headers["x-api-key"]?.trim();
  if (!key) return null;
  const tier = API_KEYS[key];
  if (!tier) return null;
  return { apiKey: key, tier };
}
