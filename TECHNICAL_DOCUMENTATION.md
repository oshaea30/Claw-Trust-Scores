# Agent Trust Registry - Technical Documentation

## 1. Overview

Agent Trust Registry is a lightweight HTTP service that computes and serves trust scores (0-100) for AI agents/tools.

Primary capabilities:
- Accept trust events (`positive`, `neutral`, `negative`) per agent ID
- Compute decayed trust scores from event history
- Return score, explanation, and short history
- Enforce plan quotas and rate limits by API key tier
- Send webhook alerts when trust drops below configured thresholds (Starter/Pro)
- Provide a ClawCredit preflight decision endpoint (`allow | review | block`)

Service location:
- `/Users/oshaealexis/Documents/New project/agent-trust-registry`

Runtime:
- Node.js >= 20
- No external DB dependency (current persistence: JSON on disk)

---

## 2. Project Structure

- `src/server.js`: HTTP server, route registration, auth entrypoint, request parsing
- `src/auth.js`: API key parsing + account tier resolution
- `src/config.js`: plans, event weights, rate limits, score constants
- `src/store.js`: in-memory state store and helper accessors
- `src/scoring.js`: trust scoring algorithm + explanation builder
- `src/service.js`: business logic for event ingestion and score reads
- `src/webhooks.js`: webhook CRUD + signed delivery + threshold crossing logic
- `src/persistence.js`: state load/save scheduler for disk persistence
- `src/clawcredit.js`: preflight policy engine for payment-style workflows
- `test/*.test.js`: unit tests
- `.env.example`: runtime env template
- `.gitignore`: excludes runtime files (`data/`, `node_modules`, etc.)

---

## 3. Data Model

### 3.1 Account
Resolved from `x-api-key` and `TRUST_API_KEYS`:
- `apiKey: string`
- `tier: "free" | "starter" | "pro"`

### 3.2 Trust Event
Stored per `agentId`:
- `id: string` (UUID)
- `agentId: string` (normalized lowercase)
- `kind: "positive" | "neutral" | "negative"`
- `eventType: string` (normalized lowercase)
- `details?: string` (trimmed; max 300 chars)
- `sourceApiKey: string`
- `createdAt: ISO-8601 string`

### 3.3 Usage Counters (per month + API key)
- `trackedAgents: Set<string>`
- `eventsLogged: number`
- `scoreChecks: number`

Month key format: `YYYY-MM` (UTC).

### 3.4 Webhook
- `id: string` (UUID)
- `url: string`
- `threshold: integer 0-100`
- `secret: string` (stored server-side; not returned in API responses)
- `createdAt: ISO-8601 string`
- `enabled: boolean`

### 3.5 Webhook Delivery Record
- `sentAt: ISO-8601 string`
- `agentId: string`
- `score: number`
- `status: number` (HTTP status or 0 on transport failure)
- `ok: boolean`
- `error?: string`

---

## 4. Scoring Algorithm

Implementation: `src/scoring.js`

### 4.1 Baseline and Clamp
- Start baseline: `50`
- Final score clamped to `[0, 100]`
- Rounded to nearest integer

### 4.2 Weights
Mapped event weights (`src/config.js`):
- Positive examples: `completed_task_on_time +8`, `payment_success +10`, `verification_passed +6`
- Negative examples: `failed_payment -12`, `security_flag -20`, `abuse_report -25`, `api_key_leak -35`

Fallback weight when event type not mapped:
- `positive`: +5
- `negative`: -8
- `neutral`: 0

### 4.3 Time Decay
Half-life: `30 days`

Formula:
- `decay(daysAgo) = exp(-(ln(2) * daysAgo) / 30)`
- Contribution per event: `weight * decay(daysAgo)`

Newer behavior dominates; older behavior fades.

### 4.4 Output
Score response includes:
- `score` and level (`Very High` / `High` / `Medium` / `Low` / `Very Low`)
- explanation sentence
- 30-day breakdown (`positive30d`, `neutral30d`, `negative30d`)
- lifetime event count
- latest 10 events history

---

## 5. Quotas, Rate Limits, and Plans

Config source: `src/config.js`

### 5.1 Monthly Plan Quotas
- Free: `5 agents`, `100 events`, `200 checks`
- Starter: `100 agents`, `5,000 events`, `10,000 checks`
- Pro: `1,000 agents`, `100,000 events`, `200,000 checks`

### 5.2 Per-minute Rate Limits
- Free: `eventWrites 30`, `scoreReads 120`
- Starter: `eventWrites 300`, `scoreReads 1200`
- Pro: `eventWrites 1200`, `scoreReads 5000`

### 5.3 Enforcement Behavior
- Unauthorized key: `401`
- Bad input: `400`
- Rate limit exceeded: `429`
- Plan limits reached: `402`
- Duplicate event spam window hit: `409`

---

## 6. API Reference

Base URL:
- Local: `http://localhost:8080`

Auth header (all `/v1/*` except `/v1/plans`):
- `x-api-key: <key>`

Content-Type for POST:
- `application/json`

### 6.1 GET /health
Purpose:
- liveness + persistence path visibility

Response 200:
```json
{
  "ok": true,
  "service": "agent-trust-registry",
  "statePath": "/absolute/path/to/data/state.json"
}
```

### 6.2 GET /v1/plans
Purpose:
- fetch plan config and quotas

Response 200:
```json
{
  "plans": {
    "free": { "maxAgents": 5, "maxEventsPerMonth": 100, "maxChecksPerMonth": 200, "webhooks": false, "bulkExports": false, "support": "basic" },
    "starter": { "maxAgents": 100, "maxEventsPerMonth": 5000, "maxChecksPerMonth": 10000, "webhooks": true, "bulkExports": false, "support": "email" },
    "pro": { "maxAgents": 1000, "maxEventsPerMonth": 100000, "maxChecksPerMonth": 200000, "webhooks": true, "bulkExports": true, "support": "priority" }
  }
}
```

### 6.3 POST /v1/events
Purpose:
- append a trust event and return updated score summary

Request body:
```json
{
  "agentId": "agent:openclaw:wallet:0xabc",
  "kind": "positive",
  "eventType": "completed_task_on_time",
  "details": "Completed task #349",
  "occurredAt": "2026-02-15T12:00:00.000Z"
}
```

Response 201:
```json
{
  "event": {
    "id": "...",
    "agentId": "agent:openclaw:wallet:0xabc",
    "kind": "positive",
    "eventType": "completed_task_on_time",
    "details": "Completed task #349",
    "sourceApiKey": "...",
    "createdAt": "2026-02-15T12:00:00.000Z"
  },
  "score": {
    "value": 58,
    "level": "Medium",
    "explanation": "Medium: 1 successful/positive events, no negative events in 30 days."
  }
}
```

### 6.4 GET /v1/score?agentId=...
Purpose:
- fetch full trust profile for an agent

Response 200:
```json
{
  "agentId": "agent:openclaw:wallet:0xabc",
  "score": 58,
  "level": "Medium",
  "explanation": "Medium: 1 successful/positive events, no negative events in 30 days.",
  "breakdown": {
    "positive30d": 1,
    "neutral30d": 0,
    "negative30d": 0,
    "lifetimeEvents": 1
  },
  "history": [
    {
      "id": "...",
      "kind": "positive",
      "eventType": "completed_task_on_time",
      "details": "Completed task #349",
      "createdAt": "2026-02-15T12:00:00.000Z"
    }
  ]
}
```

### 6.5 POST /v1/webhooks (Starter/Pro)
Purpose:
- register a score-drop webhook alert rule

Request body:
```json
{
  "url": "https://example.com/trust-webhook",
  "threshold": 50,
  "secret": "super-strong-secret"
}
```

Response 201:
```json
{
  "webhook": {
    "id": "...",
    "url": "https://example.com/trust-webhook",
    "threshold": 50,
    "createdAt": "2026-02-15T12:00:00.000Z",
    "enabled": true
  }
}
```

### 6.6 GET /v1/webhooks
Purpose:
- list registered webhooks + recent deliveries

Response 200:
```json
{
  "webhooks": [
    {
      "id": "...",
      "url": "https://example.com/trust-webhook",
      "threshold": 50,
      "createdAt": "2026-02-15T12:00:00.000Z",
      "enabled": true,
      "deliveries": []
    }
  ]
}
```

### 6.7 DELETE /v1/webhooks/{webhookId}
Purpose:
- remove a webhook rule

Response 200:
```json
{ "deleted": true }
```

### 6.8 POST /v1/integrations/clawcredit/preflight
Purpose:
- evaluate a payment-like operation using trust score + risk modifiers

Request body:
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

Decision policy:
- Compute trust score
- Compute risk penalty (0-60)
- `adjustedScore = max(0, trustScore - riskPenalty)`
- `adjustedScore < 35` => `block`
- `35 <= adjustedScore < 55` => `review`
- `>= 55` => `allow`

Response 200:
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
    "thresholds": { "blockBelow": 35, "reviewBelow": 55 }
  }
}
```

---

## 7. Webhook Delivery Semantics

Trigger condition:
- Webhook fires when score crosses **downward** through threshold:
  - `previousScore > threshold && newScore <= threshold`

Delivery behavior:
- HTTP `POST` to configured URL
- Timeout: 5s
- HMAC signature header:
  - `x-trust-signature = HMAC_SHA256(secret, raw_json_body)`
- Metadata header:
  - `x-trust-webhook-id`

Flood control:
- Suppression cooldown per `(webhookId, agentId)`: 1 hour

Retention:
- Last 20 delivery records per webhook retained in-memory and persisted

---

## 8. Persistence and State

Implementation: `src/persistence.js`

Default path:
- `DATA_DIR=./data`
- file: `./data/state.json`

Load:
- State loaded once on process startup

Save:
- Debounced flush (~150ms) after mutable operations
- Final flush on `SIGINT`/`SIGTERM`

Persisted entities:
- events
- usage counters
- webhook configs
- webhook deliveries
- webhook suppression map

Non-persisted (ephemeral):
- per-minute rate counter windows
- recent duplicate-event hash window timing (rebuilds naturally)

---

## 9. Security Model

Current protections:
- API key authentication (`x-api-key`)
- Input validation and payload size guard (1MB)
- Plan quotas and rate limits
- Duplicate event rejection window (10s same fingerprint)
- Webhook signature for receiver verification

Recommended production hardening:
- Run behind TLS (Railway domain/custom domain HTTPS)
- Rotate API keys periodically
- Add IP allowlist for admin-level operations (if added later)
- Add audit logs to immutable sink
- Add replay protection on webhook receiver side
- Add per-account secret storage policy and encryption-at-rest for persistent backend

---

## 10. Operations and Deployment

### 10.1 Local Run
```bash
cd "/Users/oshaealexis/Documents/New project/agent-trust-registry"
npm run start
```

### 10.2 Environment Variables
- `PORT` (default `8080`)
- `DATA_DIR` (default `./data`)
- `TRUST_API_KEYS` format:
  - `key1:free,key2:starter,key3:pro`

### 10.3 Railway Deployment Guidance
Recommended sequence:
1. Push project to GitHub repo
2. Create Railway project from repo
3. Configure env vars (`PORT`, `TRUST_API_KEYS`, optionally `DATA_DIR`)
4. Set health check path to `/health`
5. Deploy

Important note:
- Railway root filesystem is ephemeral by default
- For persistent JSON state, attach a Railway Volume and set `DATA_DIR` to the mount path
- Better long-term: migrate to Postgres/managed DB

---

## 11. Testing

Run:
```bash
npm test
```

Current tests cover:
- scoring increase/decrease behavior
- webhook tier gating
- ClawCredit preflight decisions
- free-plan quota error messaging with upgrade guidance
- persistence reload from disk (`flush` -> reset -> `load`)
- webhook downward-threshold crossing behavior
- webhook HMAC signature correctness

Suggested additions:
- route-level HTTP integration tests for all status-code branches
- quota rollover boundary tests at UTC month change
- delivery retry policy tests (if retries are added)

---

## 12. Integration Patterns

### 12.1 Generic Agent Gate
Before a risky action:
1. `GET /v1/score?agentId=<target>`
2. if score below policy threshold: block or require review
3. else continue operation

### 12.2 Payment Tool (ClawCredit-style)
Before payment transfer:
1. `POST /v1/integrations/clawcredit/preflight`
2. Use `decision`
   - `allow`: proceed
   - `review`: queue manual approval
   - `block`: reject action

### 12.3 Marketplace / Social Safety
- Log abuse/spam/security events using `POST /v1/events`
- Show score badge and explanation next to agent profile
- Subscribe to webhooks for low-score alerts

---

## 13. Known Limitations

- Single-process in-memory primary store (JSON persistence file)
- No multi-instance consistency guarantees
- No built-in key management UI
- No tenant admin API beyond API key tier mapping
- No OpenAPI spec file yet

---

## 14. Recommended Next Technical Milestones

1. Replace JSON persistence with SQLite (quick win), then Postgres
2. Add OpenAPI 3.1 spec + generated clients
3. Add structured logs and metrics (`p95 latency`, `429 rate`, webhook success rate)
4. Add billing integration (Stripe) for automated tier lifecycle
5. Add admin APIs for API key issuance/rotation/revocation
6. Add event source reputation weighting (future anti-abuse layer)
