const countersByMinuteAndType = new Map();

function thresholdValue(envName, fallback) {
  const raw = Number(process.env[envName]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

const ALERT_THRESHOLDS = {
  unauthorized_request: thresholdValue("SEC_ALERT_UNAUTH_PER_MINUTE", 25),
  unauthorized_rate_limited: thresholdValue("SEC_ALERT_UNAUTH_RATE_LIMIT_PER_MINUTE", 10),
  admin_auth_failed: thresholdValue("SEC_ALERT_ADMIN_AUTH_FAIL_PER_MINUTE", 10),
  payload_too_large: thresholdValue("SEC_ALERT_PAYLOAD_TOO_LARGE_PER_MINUTE", 5),
  revoked_key_attempt: thresholdValue("SEC_ALERT_REVOKED_KEY_ATTEMPT_PER_MINUTE", 5),
  webhook_target_blocked: thresholdValue("SEC_ALERT_WEBHOOK_BLOCK_PER_MINUTE", 3)
};

function currentMinuteKey() {
  return Math.floor(Date.now() / 60000);
}

function recordCounter(eventType) {
  const minute = currentMinuteKey();
  const key = `${minute}:${eventType}`;
  const count = (countersByMinuteAndType.get(key) ?? 0) + 1;
  countersByMinuteAndType.set(key, count);

  if (countersByMinuteAndType.size > 5000) {
    for (const existing of countersByMinuteAndType.keys()) {
      const [minuteRaw] = existing.split(":");
      if (Number(minuteRaw) < minute - 2) {
        countersByMinuteAndType.delete(existing);
      }
    }
  }

  return count;
}

export function logSecurityEvent(eventType, details = {}, severity = "warn") {
  const count = recordCounter(eventType);
  const threshold = ALERT_THRESHOLDS[eventType];

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      channel: "security",
      severity,
      eventType,
      countPerMinute: count,
      ...details
    })
  );

  if (threshold && count === threshold) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        channel: "security",
        severity: "alert",
        eventType: "security_threshold_reached",
        monitoredEventType: eventType,
        threshold,
        countPerMinute: count
      })
    );
  }
}
