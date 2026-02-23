# Launch Checklist (MVP)

Use this as a pass/fail checklist before announcing launch.

## 1) Core Availability

- [ ] `GET /health` returns `{"ok":true}`
- [ ] `GET /status` shows `Operational`
- [ ] Landing page loads with hero video/logo/assets
- [ ] `GET /api-docs` and `GET /getting-started` load

## 2) Signup + Email Flow

- [ ] `POST /v1/users` returns 201 for a new email
- [ ] Welcome email arrives with API key
- [ ] Signup is idempotent (same email returns key re-send)

## 3) API Functionality

- [ ] `POST /v1/events` succeeds with new key
- [ ] `GET /v1/score` returns trust + behavior + explanation + history
- [ ] `POST /v1/integrations/clawcredit/preflight` returns allow/review/block
- [ ] `GET /v1/usage` returns monthly usage + limits
- [ ] `GET /v1/audit/decisions?format=json|csv` returns exportable decision logs

## 4) Security Lifecycle

- [ ] `POST /v1/keys/rotate` returns new key and old key stops working
- [ ] `POST /v1/keys/revoke` with `{"confirm":"REVOKE"}` revokes access
- [ ] API returns clear `401`, `402`, `429` errors with actionable messages

## 5) Billing + Upgrades

- [ ] Stripe live keys/prices/webhook are configured
- [ ] Upgrade URL redirects to checkout
- [ ] Completed checkout upgrades key tier
- [ ] Upgrade confirmation email arrives

## 6) Legal + Trust

- [ ] `GET /terms` loads
- [ ] `GET /privacy` loads
- [ ] Footer links point to real pages (no dead `#` links)

## 7) Ops + Monitoring

- [ ] Uptime monitor configured against `/health`
- [ ] Admin token set (`ADMIN_TOKEN`)
- [ ] `GET /v1/admin/overview` with `x-admin-token` returns metrics
- [ ] Railway log alerts configured for crashes/restarts

## 8) Connector Readiness (No manual event posting)

- [ ] `GET /v1/integrations/templates` returns sources (`stripe`, `auth`, `marketplace`)
- [ ] `GET /v1/integrations/readiness?source=stripe` returns checklist
- [ ] `POST /v1/integrations/ingest/secret` returns ingest secret
- [ ] `POST /v1/integrations/map-event` maps provider event type correctly
- [ ] `POST /v1/integrations/ingest/events` accepts signed events and dedupes duplicates

## 9) Final Smoke Test Commands

```bash
cd "/Users/oshaealexis/Documents/New project/agent-trust-registry"
BASE="https://clawtrustscores.com" KEY="demo_starter_key" ./scripts/smoke-live.sh
```
