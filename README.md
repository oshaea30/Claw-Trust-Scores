# Agent Trust Registry

Small service that returns a 0-100 trust score and short history for any AI agent/tool ID.
It now also returns a separate 0-100 behavior score (reliability/execution quality).

## Why it exists

Before sending money, sharing API keys, hiring humans, or executing risky actions, callers need a fast trust check on the counterparty agent.

This service is designed as a lightweight "Know Your Agent" gate.

## Core API

Base URL: `http://localhost:8080`

Auth: `x-api-key` header

Demo keys:
- `demo_free_key`
- `demo_starter_key`
- `demo_pro_key`

### 1) Log event

`POST /v1/events`

```json
{
  "agentId": "agent:rentahuman:abc123",
  "kind": "negative",
  "eventType": "abuse_report",
  "details": "Sent spam to users"
}
```

Supported `kind` values:
- `positive`
- `neutral`
- `negative`

### 2) Get score

`GET /v1/score?agentId=agent:rentahuman:abc123`

Response includes:
- `score` (0-100)
- `level` (`Very High` to `Very Low`)
- `explanation`
- `behavior` (separate behavior score + explanation)
- `breakdown` (30-day and lifetime counts)
- `history` (latest 10 events)

### 2b) ClawCredit preflight decision

Use this before initiating payment-like actions.

`POST /v1/integrations/clawcredit/preflight`

```json
{
  "agentId": "agent:openclaw:wallet:0xabc",
  "amountUsd": 2500,
  "newPayee": true,
  "firstTimeCounterparty": true,
  "highPrivilegeAction": false,
  "exposesApiKeys": false
}
```

Decision response uses a policy layer:
- `allow`
- `review`
- `block`

Trust and behavior remain separate base scores; the policy layer combines both with hard trust floors.

Example response:

```json
{
  "integration": "clawcredit",
  "decision": "review",
  "reason": "Manual review required: adjusted score 48 is in caution band.",
  "trust": {
    "agentId": "agent:openclaw:wallet:0xabc",
    "score": 63,
    "level": "Medium",
    "explanation": "Medium: 3 positive vs 1 negative events in 30 days."
  },
  "policy": {
    "adjustedScore": 48,
    "riskPenalty": 15,
    "thresholds": {
      "blockBelow": 35,
      "reviewBelow": 55
    }
  }
}
```

### 2c) Issue portable attestation (signed credential)

Use this to create a verifiable credential tied to an `agentId`, such as:
- `connector.stripe.verified`
- `connector.auth.verified`
- `operator.kya.completed`

`POST /v1/attestations`

```json
{
  "agentId": "agent:openclaw:wallet:0xabc",
  "type": "connector.stripe.verified",
  "ttlDays": 90,
  "claims": {
    "provider": "stripe",
    "mode": "live"
  }
}
```

Other attestation endpoints:
- `GET /v1/attestations?agentId=...`
- `POST /v1/attestations/verify` with `{ "token": "..." }`
- `POST /v1/attestations/{attestationId}/revoke` with `{ "reason": "..." }`

### 3) Webhooks (Starter/Pro)

Register score-drop alerts (fires when score crosses down below threshold).

`POST /v1/webhooks`

```json
{
  "url": "https://yourapp.com/trust-webhook",
  "threshold": 50,
  "secret": "replace-with-strong-secret"
}
```

`GET /v1/webhooks`

`DELETE /v1/webhooks/{webhookId}`

Webhook payload:

```json
{
  "event": "trust.score_below_threshold",
  "sentAt": "2026-02-14T14:00:00.000Z",
  "webhookId": "...",
  "threshold": 50,
  "agentId": "agent:rentahuman:abc123",
  "score": 47,
  "previousScore": 58
}
```

Headers:
- `x-trust-signature`: HMAC-SHA256 hex of raw JSON body using webhook `secret`
- `x-trust-webhook-id`: webhook id

### 4) Get plan limits

`GET /v1/plans`

### 5) Connector readiness + signed ingest (recommended)

Use this flow so teams do not manually submit events:

- `GET /v1/integrations/readiness?source=stripe|auth|marketplace`
- `POST /v1/integrations/ingest/secret`
- `POST /v1/integrations/map-event`
- `POST /v1/integrations/ingest/events`

This gives you verified integration signals with replay protection and source-aware mapping.

Additional live connector sources:
- `wallet`
- `prediction_market`
- `runtime`

## Persistence

State is persisted to JSON on disk and reloaded on startup.

Default path:
- `./data/state.json`

Override with:
- `DATA_DIR=/custom/path`

## Scoring model

- Baseline starts at `50`
- Event weights add/subtract points
- Time decay uses a 30-day half-life (recent behavior matters more)
- Score is clamped to `0-100`

Explanation text is generated automatically, for example:
- `High: 23 successful/positive events, no negative events in 30 days.`

## Abuse controls included

- API-key auth
- Per-minute rate limits by tier
- Monthly plan quotas
- Duplicate event rejection window (same event submitted repeatedly)
- Basic payload validation
- Revoked-key blocking and logging
- Admin-only key lifecycle controls (issue/rotate/revoke)
- Encrypted webhook secrets at rest
- Structured security event logging + threshold alerts

## Admin security endpoints

Set `ADMIN_TOKEN` and pass it as `x-admin-token`.

- `GET /v1/admin/keys` list masked keys + status
- `POST /v1/admin/keys` create a managed key
  - body: `{ "tier": "free|starter|pro" }`
- `POST /v1/admin/keys/rotate`
  - body: `{ "apiKey": "claw_live_..." }`
- `POST /v1/admin/keys/revoke`
  - body: `{ "apiKey": "claw_live_..." }`

## Pricing and usage tiers

### Free (test/hobby)
- 5 agents tracked/month
- 100 events/month
- 200 score checks/month
- no webhooks
- no bulk exports
- basic support

### Starter (~$19/mo)
- 100 agents tracked/month
- 5,000 events/month
- 10,000 score checks/month
- simple webhooks
- email support

### Pro (~$79/mo)
- 1,000 agents tracked/month
- 100,000 events/month
- 200,000 score checks/month
- advanced filtering/exports path
- priority support

## Quick start

```bash
cd /Users/oshaealexis/Documents/New\ project/agent-trust-registry
npm run start
```

### Log a positive event

```bash
curl -X POST http://localhost:8080/v1/events \
  -H "Content-Type: application/json" \
  -H "x-api-key: demo_starter_key" \
  -d '{
    "agentId":"agent:openclaw:wallet:0xabc",
    "kind":"positive",
    "eventType":"completed_task_on_time",
    "details":"Completed task #349 in SLA"
  }'
```

### Check trust score

```bash
curl "http://localhost:8080/v1/score?agentId=agent:openclaw:wallet:0xabc" \
  -H "x-api-key: demo_starter_key"
```

### ClawCredit-style preflight check

```bash
curl -X POST http://localhost:8080/v1/integrations/clawcredit/preflight \
  -H "Content-Type: application/json" \
  -H "x-api-key: demo_starter_key" \
  -d '{
    "agentId":"agent:openclaw:wallet:0xabc",
    "amountUsd":2500,
    "newPayee":true,
    "firstTimeCounterparty":true,
    "highPrivilegeAction":false,
    "exposesApiKeys":false
  }'
```

### Verified connector quickstart (Stripe example)

```bash
# 1) Readiness check
curl "http://localhost:8080/v1/integrations/readiness?source=stripe" \
  -H "x-api-key: demo_starter_key"

# 2) Rotate/create ingest secret (store securely)
curl -X POST "http://localhost:8080/v1/integrations/ingest/secret" \
  -H "x-api-key: demo_starter_key"

# 3) Preview mapping
curl -X POST "http://localhost:8080/v1/integrations/map-event" \
  -H "Content-Type: application/json" \
  -H "x-api-key: demo_starter_key" \
  -d '{"source":"stripe","providerEventType":"payment_intent.payment_failed"}'

# 4) Issue a portable connector attestation for this agent
curl -X POST "http://localhost:8080/v1/attestations" \
  -H "Content-Type: application/json" \
  -H "x-api-key: demo_starter_key" \
  -d '{
    "agentId":"agent:openclaw:wallet:0xabc",
    "type":"connector.stripe.verified",
    "ttlDays":90,
    "claims":{"provider":"stripe","mode":"live"}
  }'

# 5) Apply money movement safety preset
curl -X POST "http://localhost:8080/v1/policy/presets/money_movement_strict" \
  -H "x-api-key: demo_starter_key"
```

## OpenClaw wrapper install (10 lines)

```bash
npx clawhub@latest install claw-trust-scores

# .env
CLAWTRUST_API_KEY=claw_paste_your_real_key_here
CLAWTRUST_BASE_URL=https://clawtrustscores.com

# Use tool calls in your flow:
# get_score(agentId)
# preflight_payment(agentId, amountUsd, newPayee)
# log_event(agentId, kind, eventType)
```

## 5-minute integration snippet (Node)

```js
const trust = await fetch(
  "http://localhost:8080/v1/score?agentId=" + encodeURIComponent(targetAgentId),
  { headers: { "x-api-key": process.env.TRUST_API_KEY } }
).then((r) => r.json());

if (trust.score < 50) {
  throw new Error(`Blocked by Trust Registry: ${trust.score} (${trust.explanation})`);
}
```

## Suggested launch positioning

- Message: "Fastest way to avoid getting burned by unknown agents."
- Placement: run one trust-check call before funds movement, key sharing, or risky tool execution.
- Conversion: keep free limits tight so production workloads upgrade quickly.

## Env

Copy `.env.example` and set:

- `PORT` (default: `8080`)
- `DATA_DIR` (default: `./data`)
- `TRUST_API_KEYS` format: `api_key:tier,api_key:tier`
- `DATA_ENCRYPTION_KEY` (required in production; use a long random secret)
- `ATTESTATION_SIGNING_KEY` (recommended in all environments; use a long random secret)
- `NODE_ENV=production` in production deployments

Production hard-fail behavior:
- Service will not start in production unless `TRUST_API_KEYS` has at least one valid `api_key:tier` entry.
- Service will not start in production unless `DATA_ENCRYPTION_KEY` is set.
