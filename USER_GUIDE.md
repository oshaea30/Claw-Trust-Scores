# Claw Trust Scores - User Guide

This guide is for people using the API, not building the backend.

## 1) What this does

Claw Trust Scores helps you decide if an agent/tool is safe enough before risky actions.

You can:
- Log trust events about an `agentId`
- Read a trust score (`0-100`) and explanation
- Run a preflight policy decision (`allow`, `review`, `block`)
- Check usage/limits for your API key

## 2) Base URL and auth

Base URL (production):
- `https://claw-trust-scores-production.up.railway.app`

Every protected request needs:
- Header: `x-api-key: YOUR_KEY`

## 3) Get an API key

### Option A: Landing page (recommended)
1. Open the root URL:
   - `https://claw-trust-scores-production.up.railway.app/`
2. Enter your email.
3. Click `Get Free API Key`.
4. Copy the key from the response/email.

### Option B: API signup

```bash
curl -X POST "https://claw-trust-scores-production.up.railway.app/v1/users" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

Expected response:

```json
{
  "message": "API key created and sent to your email.",
  "apiKey": "claw_...",
  "tier": "free"
}
```

## 4) First 5-minute flow (copy/paste)

Set your key once:

```bash
export TRUST_KEY="claw_your_real_key_here"
```

### Step 1: Log a positive event

```bash
curl -X POST "https://claw-trust-scores-production.up.railway.app/v1/events" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $TRUST_KEY" \
  -d '{
    "agentId":"agent:demo:vendor-1",
    "kind":"positive",
    "eventType":"completed_task_on_time",
    "details":"Delivered on schedule"
  }'
```

### Step 2: Check trust score

```bash
curl "https://claw-trust-scores-production.up.railway.app/v1/score?agentId=agent:demo:vendor-1" \
  -H "x-api-key: $TRUST_KEY"
```

### Step 3: Run a preflight decision

```bash
curl -X POST "https://claw-trust-scores-production.up.railway.app/v1/integrations/clawcredit/preflight" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $TRUST_KEY" \
  -d '{
    "agentId":"agent:demo:vendor-1",
    "amountUsd":2500,
    "newPayee":true,
    "firstTimeCounterparty":true,
    "highPrivilegeAction":false,
    "exposesApiKeys":false
  }'
```

Expected `decision` values:
- `allow`: safe to proceed
- `review`: manual review first
- `block`: do not proceed

### Step 4: Check your usage and limits

```bash
curl "https://claw-trust-scores-production.up.railway.app/v1/usage" \
  -H "x-api-key: $TRUST_KEY"
```

## 5) Limits by plan

### Free
- 5 tracked agents / month
- 100 events / month
- 200 score checks / month

### Starter
- 100 tracked agents / month
- 5,000 events / month
- 10,000 score checks / month

### Pro
- 1,000 tracked agents / month
- 100,000 events / month
- 200,000 score checks / month

Get limits from API:

```bash
curl "https://claw-trust-scores-production.up.railway.app/v1/plans"
```

## 6) What happens when you hit limits

You get clear API errors.

Common status codes:
- `401` invalid or missing API key
- `402` monthly plan quota exceeded
- `429` temporary rate limit exceeded

Example (`402`):

```json
{
  "error": "Free plan limit hit: 200 score checks/month exceeded. Upgrade to Starter."
}
```

## 7) Upgrade flow

To start checkout for Starter:

```bash
open "https://claw-trust-scores-production.up.railway.app/v1/upgrade/$TRUST_KEY?tier=starter"
```

To start checkout for Pro:

```bash
open "https://claw-trust-scores-production.up.railway.app/v1/upgrade/$TRUST_KEY?tier=pro"
```

## 8) Audit export

JSON export:

```bash
curl "https://claw-trust-scores-production.up.railway.app/v1/audit/decisions?format=json&limit=200" \
  -H "x-api-key: $TRUST_KEY"
```

CSV export:

```bash
curl "https://claw-trust-scores-production.up.railway.app/v1/audit/decisions?format=csv&limit=200" \
  -H "x-api-key: $TRUST_KEY"
```

## 9) Troubleshooting

`{"error":"Not Found"}`
- You likely hit an endpoint that does not exist.
- Check exact path and method.

`401 Unauthorized`
- Missing or wrong `x-api-key`.
- Confirm you are using your real key, not placeholder text.

`Could not create key` on landing page
- Email provider or env vars may be missing on server side.
- Check service logs and `FROM_EMAIL`/`RESEND_API_KEY`.

Video/landing assets not loading
- Confirm server is on the latest deploy with static asset support.

## 10) Minimal Node example

```js
const BASE_URL = "https://claw-trust-scores-production.up.railway.app";
const apiKey = process.env.TRUST_KEY;
const agentId = "agent:demo:vendor-1";

const res = await fetch(`${BASE_URL}/v1/score?agentId=${encodeURIComponent(agentId)}`, {
  headers: { "x-api-key": apiKey }
});

if (!res.ok) {
  const err = await res.json();
  throw new Error(err.error || "Trust score request failed");
}

const trust = await res.json();
if (trust.score < 50) {
  throw new Error(`Blocked by policy: score=${trust.score}`);
}
```

