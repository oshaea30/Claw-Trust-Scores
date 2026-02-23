# Launch Smoke Report

Date: February 23, 2026  
Scope: Route wiring validation + automated tests + runnable live smoke script

## Executive result

- Backend routes now match published docs/site flows.
- Self-serve API keys from `POST /v1/users` are now accepted by protected endpoints.
- Full automated suite passes: `43/43`.

## Critical fixes completed in this pass

1. Restored missing API routes in `src/server.js`:
- `/v1/users`
- `/v1/public/hero-snapshot`
- `/v1/policy`, `/v1/policy/presets/*`
- `/v1/integrations/templates`
- `/v1/integrations/map-event`
- `/v1/integrations/readiness`
- `/v1/integrations/ingest/secret`
- `/v1/integrations/ingest/events`
- `/v1/audit/decisions`
- `/v1/keys/rotate`, `/v1/keys/revoke`
- clean page routing and legacy `.html` redirects

2. Fixed auth mismatch in `src/auth.js`:
- Authentication now recognizes self-serve keys from `key-store` (not just env/managed keys).
- Admin key list now includes `self_serve` source entries.

3. Added live smoke runner:
- `scripts/smoke-live.sh` (12-endpoint sequence, including signup + score + preflight + connectors + audit export).

## Automated verification

- Command run: `npm test --silent`
- Result: PASS
- Summary: `43 passed, 0 failed`

## Manual/live verification status

This execution environment cannot perform outbound DNS resolution for your public domains and cannot bind local ports for runtime curl checks.  
To close that gap, run:

```bash
cd "/Users/oshaealexis/Documents/New project/agent-trust-registry"
BASE="https://clawtrustscores.com" KEY="demo_starter_key" ./scripts/smoke-live.sh
```

Expected:
- health/plans return `ok` JSON
- signup returns `201` or idempotent `200`
- score endpoint returns trust + behavior payload
- preflight returns allow/review/block decision
- templates/presets/readiness/audit endpoints return valid JSON

## Launch-readiness checklist (non-Stripe)

- [x] Core APIs reachable via one consistent server router
- [x] Self-serve key generation and key auth path aligned
- [x] Connector ingestion endpoints exposed
- [x] Policy presets available for no-code setup
- [x] OpenClaw wrapper install snippets added to docs/site
- [x] Smoke script prepared for production validation
- [ ] Run `scripts/smoke-live.sh` from your machine/network and save output

