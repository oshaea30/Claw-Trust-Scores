# Claw Trust Scores API

Trust checks for AI agents and tools.

Use this API before risky actions (payments, key sharing, delegated execution) to get a trust score or policy decision.

## Start Here

- API docs page: `/api-docs`
- 5-minute quickstart page: `/getting-started`
- User guide: `USER_GUIDE.md`
- Launch checklist: `LAUNCH_CHECKLIST.md`
- Monitoring runbook: `MONITORING.md`
- Technical implementation details: `TECHNICAL_DOCUMENTATION.md`

## Base URL

Production:

`https://claw-trust-scores-production.up.railway.app`

Auth header (protected endpoints):

`x-api-key: YOUR_KEY`

## Get an API Key

```bash
curl -X POST "https://claw-trust-scores-production.up.railway.app/v1/users" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

## 5-Minute API Quickstart

```bash
BASE="https://claw-trust-scores-production.up.railway.app"
KEY="claw_your_key_here"

# 1) Log an event
curl -X POST "$BASE/v1/events" \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent:demo:1","kind":"positive","eventType":"completed_task_on_time"}'

# 2) Read trust score
curl "$BASE/v1/score?agentId=agent:demo:1" \
  -H "x-api-key: $KEY"

# 3) Run preflight decision
curl -X POST "$BASE/v1/integrations/clawcredit/preflight" \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent:demo:1","amountUsd":2500,"newPayee":true,"firstTimeCounterparty":true}'

# 4) Check usage/limits
curl "$BASE/v1/usage" \
  -H "x-api-key: $KEY"
```

## Endpoint Reference

Public:

- `GET /health`
- `GET /status`
- `GET /v1/plans`
- `GET /v1/integrations/templates`
- `POST /v1/users`
- `GET /v1/upgrade/:apiKey?tier=starter|pro`
- `POST /v1/stripe/webhook`
- `GET /v1/public/hero-snapshot`

Protected (`x-api-key` required):

- `POST /v1/events`
- `GET /v1/score?agentId=...`
- `GET /v1/score?agentId=...&includeTrace=1&traceLimit=5` (optional decision trace)
- `POST /v1/integrations/clawcredit/preflight`
- `GET /v1/usage`
- `GET /v1/policy`
- `GET /v1/policy/presets`
- `POST /v1/policy/presets/{open|balanced|strict}`
- `POST /v1/policy`
- `DELETE /v1/policy`
- `GET /v1/audit/decisions?format=json|csv&limit=...`
- `POST /v1/keys/rotate`
- `POST /v1/keys/revoke` with `{"confirm":"REVOKE"}`
- `POST /v1/integrations/ingest/secret` rotate inbound ingest secret
- `POST /v1/integrations/ingest/events` ingest signed verified events
- `POST /v1/webhooks`
- `GET /v1/webhooks`
- `DELETE /v1/webhooks/{webhookId}`

Ops/Admin (`x-admin-token` required):

- `GET /v1/admin/overview`

## Plans

- Free: 5 agents, 100 events/month, 200 score checks/month
- Starter: 100 agents, 5,000 events/month, 10,000 score checks/month
- Pro: 1,000 agents, 100,000 events/month, 200,000 score checks/month

## Common Errors

- `401` invalid/missing API key
- `402` plan quota exceeded
- `429` rate limit exceeded

## For Developers (Local)

```bash
cd /Users/oshaealexis/Projects/agent-trust-registry
npm run start
```

Environment vars are in `.env.example`.
