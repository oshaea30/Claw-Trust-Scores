# Launch Checklist (MVP)

Use this as a pass/fail checklist before announcing launch.

## 1) Core Availability

- [ ] `GET /health` returns `{"ok":true}`
- [ ] `GET /status.html` shows `Operational`
- [ ] Landing page loads with hero video/logo/assets
- [ ] `GET /api-docs.html` and `GET /getting-started.html` load

## 2) Signup + Email Flow

- [ ] `POST /v1/users` returns 201 for a new email
- [ ] Welcome email arrives with API key
- [ ] Signup is idempotent (same email returns key re-send)

## 3) API Functionality

- [ ] `POST /v1/events` succeeds with new key
- [ ] `GET /v1/score` returns score + explanation + history
- [ ] `POST /v1/integrations/clawcredit/preflight` returns allow/review/block
- [ ] `GET /v1/usage` returns monthly usage + limits

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

- [ ] `GET /terms.html` loads
- [ ] `GET /privacy.html` loads
- [ ] Footer links point to real pages (no dead `#` links)

## 7) Ops + Monitoring

- [ ] Uptime monitor configured against `/health`
- [ ] Admin token set (`ADMIN_TOKEN`)
- [ ] `GET /v1/admin/overview` with `x-admin-token` returns metrics
- [ ] Railway log alerts configured for crashes/restarts

## 8) Final Smoke Test Commands

```bash
BASE="https://claw-trust-scores-production.up.railway.app"

curl -s "$BASE/health"
curl -s "$BASE/v1/plans"
curl -s -X POST "$BASE/v1/users" -H "Content-Type: application/json" -d '{"email":"you@example.com"}'

# After you get your key:
KEY="claw_..."
curl -s -X POST "$BASE/v1/events" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{"agentId":"agent:demo:1","kind":"positive","eventType":"completed_task_on_time"}'
curl -s "$BASE/v1/score?agentId=agent:demo:1" -H "x-api-key: $KEY"
curl -s "$BASE/v1/usage" -H "x-api-key: $KEY"
curl -s -X POST "$BASE/v1/keys/rotate" -H "x-api-key: $KEY"
```
