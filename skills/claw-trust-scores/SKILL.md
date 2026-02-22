# Claw Trust Scores Skill

Official skill wrapper for integrating Claw Trust Scores into agent workflows.

## Purpose

Use this skill to add a trust gate before risky actions:
- payment execution
- API key sharing
- delegated tool execution
- task acceptance in marketplaces

## Required environment variables

```env
CLAWTRUST_API_KEY=INSERT_YOUR_API_KEY_HERE
CLAWTRUST_BASE_URL=https://clawtrustscores.com
```

## Tools

### `get_score`
Reads trust score and signal quality for an agent.

Request:
```json
{
  "agentId": "agent:vendor:example-1",
  "includeTrace": false
}
```

Calls:
- `GET /v1/score?agentId=...`

### `log_event`
Logs a trust event for an agent.

Request:
```json
{
  "agentId": "agent:vendor:example-1",
  "kind": "positive",
  "eventType": "completed_task_on_time",
  "source": "marketplace",
  "sourceType": "verified_integration",
  "confidence": 0.95
}
```

Calls:
- `POST /v1/events`

### `preflight_payment`
Runs ClawCredit-compatible allow/review/block decision.

Request:
```json
{
  "agentId": "agent:vendor:example-1",
  "amountUsd": 2500,
  "newPayee": true,
  "firstTimeCounterparty": true
}
```

Calls:
- `POST /v1/integrations/clawcredit/preflight`

### `connector_readiness`
Checks if connector setup is hardened for a source.

Request:
```json
{
  "source": "stripe"
}
```

Calls:
- `GET /v1/integrations/readiness?source=...`

## Suggested usage pattern

1. Call `connector_readiness` and complete all failed checklist items.
2. Before risky actions, call `preflight_payment`.
3. If result is `review` or `block`, require manual approval.
4. Call `get_score` for visibility and auditing.

## Safety notes

- Keep `CLAWTRUST_API_KEY` server-side only.
- Never expose this key in frontend code or chat messages.
- Enable strict policy controls in production:
  - `requireVerifiedSensitive: true`
  - `minSignalQuality >= 40` (or higher for high-risk flows)
