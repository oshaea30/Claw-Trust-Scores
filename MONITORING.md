# Monitoring Runbook

## Uptime Targets

- Primary health endpoint: `GET /health`
- Human-friendly status page: `GET /status`

## Recommended External Monitors

Create two checks (UptimeRobot, Better Stack, or similar):

1. API health check
- URL: `https://claw-trust-scores-production.up.railway.app/health`
- Method: `GET`
- Expected status: `200`
- Expected body contains: `"ok":true`
- Interval: 1 minute

2. Landing/docs check
- URL: `https://claw-trust-scores-production.up.railway.app/`
- Method: `GET`
- Expected status: `200`
- Expected body contains: `Claw Trust Scores`
- Interval: 5 minutes

## Internal Ops Endpoint

- Endpoint: `GET /v1/admin/overview`
- Header: `x-admin-token: <ADMIN_TOKEN>`
- Requires `ADMIN_TOKEN` env var

Example:

```bash
curl -s "https://claw-trust-scores-production.up.railway.app/v1/admin/overview" \
  -H "x-admin-token: YOUR_ADMIN_TOKEN"
```

Use it to monitor:
- user count by tier
- total events, webhooks, decision logs
- recent signups
- top API key usage

## Railway Alerts

Set alerting on:
- service crash/restart events
- deployment failures
- sustained 5xx spikes (if available)

## Daily Smoke Script

```bash
BASE="https://claw-trust-scores-production.up.railway.app"
curl -s "$BASE/health"
curl -s "$BASE/status" >/dev/null
curl -s "$BASE/v1/plans"
```
