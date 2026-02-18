# Self-Serve Signup — Setup Guide

Everything you need to go from dev → live with self-serve API key signup, Stripe billing, and email delivery.

---

## 1. Stripe Setup (Dashboard)

### Create Products

Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products) and create two products:

| Product | Price | Billing |
|---------|-------|---------|
| **ClawTrustScores Starter** | $19/month | Recurring, monthly |
| **ClawTrustScores Pro** | $79/month | Recurring, monthly |

For each product:
1. Click **Add product**
2. Name: `ClawTrustScores Starter` (or Pro)
3. Price: `$19.00` (or `$79.00`), **Recurring**, **Monthly**
4. Click **Save product**
5. Copy the **Price ID** (starts with `price_...`) — you'll need it below

### Configure Webhook Endpoint

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Endpoint URL: `https://claw-trust-scores-production.up.railway.app/v1/stripe/webhook`
4. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated` (optional, for future use)
5. Click **Add endpoint**
6. Click **Reveal** to copy the **Signing secret** (starts with `whsec_...`)

### Get API Keys

1. Go to [Stripe Dashboard → Developers → API Keys](https://dashboard.stripe.com/apikeys)
2. Copy the **Secret key** (starts with `sk_test_...` for test mode, `sk_live_...` for prod)

> **Tip:** Test everything with `sk_test_` keys first. Switch to `sk_live_` when ready.

---

## 2. Resend Email Setup

1. Sign up at [resend.com](https://resend.com) (free tier: 3,000 emails/month)
2. Go to **API Keys** → Create a new key → Copy it (starts with `re_...`)
3. Go to **Domains** → Add `clawtrustscores.com` → Add the DNS records they give you
4. Until DNS is verified, emails send from `onboarding@resend.dev` (fine for testing)

---

## 3. Railway Environment Variables

In your [Railway dashboard](https://railway.app), go to your `agent-trust-registry` service → **Variables** and add:

```
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
STRIPE_STARTER_PRICE_ID=price_xxxxxxxxxxxxx
STRIPE_PRO_PRICE_ID=price_xxxxxxxxxxxxx
RESEND_API_KEY=re_xxxxxxxxxxxxx
FROM_EMAIL=ClawTrustScores <keys@clawtrustscores.com>
BASE_URL=https://claw-trust-scores-production.up.railway.app
```

Your existing vars (`PORT`, `DATA_DIR`, `TRUST_API_KEYS`) stay as-is. The demo keys still work — dynamic keys are additive.

Click **Deploy** to redeploy with the new env vars.

---

## 4. Test the Flow

### Create a free key
```bash
curl -X POST https://claw-trust-scores-production.up.railway.app/v1/users \
  -H "Content-Type: application/json" \
  -d '{"email": "test@youremail.com"}'
```

Expected response:
```json
{
  "message": "API key created and sent to your email.",
  "apiKey": "claw_a1b2c3d4e5f6...",
  "tier": "free"
}
```

### Use the key
```bash
curl https://claw-trust-scores-production.up.railway.app/v1/score?agentId=test-agent \
  -H "x-api-key: claw_a1b2c3d4e5f6..."
```

### Test upgrade (Stripe test mode)
Open in browser:
```
https://claw-trust-scores-production.up.railway.app/v1/upgrade/claw_a1b2c3d4e5f6...?tier=starter
```
This redirects to Stripe Checkout. Use card `4242 4242 4242 4242` with any future expiry.

### Verify webhook
After completing test checkout, check Railway logs for:
```
[selfserve] Upgraded claw_a1b2c3d4e5f6... to starter
```

---

## 5. Landing Page Deployment

The landing page (`landing-page.html`) is a standalone file. Options:

### Option A: Wix (if you want a CMS)
1. Create a new Wix site from a blank SaaS template
2. Add an **HTML embed** element to the page
3. Paste the landing page code into the embed
4. The signup form in the page POSTs to your Railway API
5. Publish the site

### Option B: Direct hosting (simpler)
The HTML file can be hosted anywhere static:
- **Railway**: Add a `public/` folder, serve with a small static handler
- **Vercel/Netlify**: Drop the file in, deploy
- **GitHub Pages**: Push to a repo, enable Pages

### Option C: Custom domain on Railway
1. In Railway → service → **Settings** → **Custom Domain**
2. Add `clawtrustscores.com` and `www.clawtrustscores.com`
3. Add these DNS records at your registrar:
   - `CNAME` → `www` → `claw-trust-scores-production.up.railway.app`
   - `A` record (Railway provides the IP when you add the domain)

---

## 6. Go-Live Checklist

- [ ] Stripe products created with correct prices
- [ ] Stripe webhook endpoint added and listening for correct events
- [ ] All 7 Railway env vars set (see section 3)
- [ ] Redeploy on Railway after adding env vars
- [ ] `POST /v1/users` returns 201 with a key
- [ ] Email arrives with correct API key
- [ ] Key works for `/v1/events` and `/v1/score`
- [ ] `/v1/upgrade/:key` redirects to Stripe Checkout
- [ ] Stripe test card completes checkout
- [ ] Webhook fires and upgrades the key tier
- [ ] Upgrade confirmation email arrives
- [ ] Switch `STRIPE_SECRET_KEY` to `sk_live_...` for production
- [ ] Update `STRIPE_WEBHOOK_SECRET` to the live endpoint's secret
- [ ] Resend domain verified (emails come from your domain, not `resend.dev`)
- [ ] Delete the `undefined/` directory from repo root (leftover bug)
- [ ] Landing page deployed and signup form works

---

## Architecture Notes

### How keys work now (v0.2)

```
┌──────────────────────┐     ┌──────────────────────┐
│  TRUST_API_KEYS env  │     │  state.json → users  │
│  (demo / admin keys) │     │  (self-serve signups) │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           └──────────┬─────────────────┘
                      │
               ┌──────▼──────┐
               │  key-store  │  ← single source of truth
               └──────┬──────┘
                      │
           ┌──────────┼──────────┐
           │          │          │
      ┌────▼───┐ ┌───▼────┐ ┌──▼───────┐
      │ auth.js│ │selfserve│ │service.js│
      └────────┘ └────────┘ └──────────┘
```

- **Static keys** (env var) take priority — you can always override a dynamic key
- **Dynamic keys** are created via `POST /v1/users` and stored in `state.json`
- Stripe webhook upgrades/downgrades update the dynamic key's tier
- No external database needed — everything persists to disk

### Zero dependencies maintained

The self-serve layer uses only `node:` built-ins + `fetch()` (Node 20+). Stripe and Resend are called via their HTTP APIs directly. No `stripe` npm package, no `resend` npm package.
