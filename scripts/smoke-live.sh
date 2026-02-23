#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-https://clawtrustscores.com}"
KEY="${KEY:-demo_starter_key}"
AGENT="agent:smoke:$(date +%s)"
EMAIL="smoke+$(date +%s)@example.com"

echo "[1] GET /health"
curl -sS "$BASE/health"; echo

echo "[2] GET /v1/plans"
curl -sS "$BASE/v1/plans"; echo

echo "[3] POST /v1/users"
curl -sS -X POST "$BASE/v1/users" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}"; echo

echo "[4] GET /v1/usage"
curl -sS "$BASE/v1/usage" -H "x-api-key: $KEY"; echo

echo "[5] GET /v1/score (before)"
curl -sS "$BASE/v1/score?agentId=$AGENT&includeTrace=true" -H "x-api-key: $KEY"; echo

echo "[6] POST /v1/events"
curl -sS -X POST "$BASE/v1/events" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" \
  -d "{\"agentId\":\"$AGENT\",\"kind\":\"positive\",\"eventType\":\"completed_task_on_time\",\"source\":\"manual\",\"confidence\":0.95,\"details\":\"live smoke\"}"; echo

echo "[7] GET /v1/score (after)"
curl -sS "$BASE/v1/score?agentId=$AGENT" -H "x-api-key: $KEY"; echo

echo "[8] POST /v1/integrations/clawcredit/preflight"
curl -sS -X POST "$BASE/v1/integrations/clawcredit/preflight" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" \
  -d "{\"agentId\":\"$AGENT\",\"amountUsd\":850,\"newPayee\":false,\"firstTimeCounterparty\":false}"; echo

echo "[9] GET /v1/integrations/templates"
curl -sS "$BASE/v1/integrations/templates"; echo

echo "[10] GET /v1/policy/presets"
curl -sS "$BASE/v1/policy/presets" -H "x-api-key: $KEY"; echo

echo "[11] GET /v1/integrations/readiness?source=stripe"
curl -sS "$BASE/v1/integrations/readiness?source=stripe" -H "x-api-key: $KEY"; echo

echo "[12] GET /v1/audit/decisions?limit=5"
curl -sS "$BASE/v1/audit/decisions?limit=5" -H "x-api-key: $KEY"; echo

echo "Done. If any call returns an error JSON, fix that endpoint before launch."
