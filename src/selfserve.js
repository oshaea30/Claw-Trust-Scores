/**
 * Self-Serve Signup Routes
 *
 * POST /v1/users              — create free key (shown once in response)
 * GET  /v1/upgrade/:apiKey    — return Stripe Checkout URL for upgrade
 * POST /v1/stripe/webhook     — handle Stripe events (upgrade/downgrade)
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 *   STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID,
 *   RESEND_API_KEY, FROM_EMAIL, BASE_URL
 */

import crypto from "node:crypto";
import {
  createUser,
  getUserByKey,
  getUserByEmail,
  getUserByStripeCustomerId,
  upgradeTier,
  downgradeTier,
} from "./key-store.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function env(name) {
  return process.env[name] ?? "";
}

const TIER_FOR_PRICE = () => ({
  [env("STRIPE_STARTER_PRICE_ID")]: "starter",
  [env("STRIPE_PRO_PRICE_ID")]: "pro",
});

// ---------------------------------------------------------------------------
// Email (Resend HTTP API — zero deps)
// ---------------------------------------------------------------------------

async function sendEmail({ to, subject, html }) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("FROM_EMAIL") || "ClawTrustScores <noreply@clawtrustscores.com>";

  if (!apiKey) {
    console.warn("[selfserve] RESEND_API_KEY not set — skipping email to", to);
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[selfserve] Resend error:", res.status, body);
    }
  } catch (err) {
    console.error("[selfserve] Email send failed:", err.message);
  }
}

function welcomeEmail(email) {
  return sendEmail({
    to: email,
    subject: "ClawTrustScores key created",
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #e63946;">Welcome to ClawTrustScores</h2>
        <p>Your API key was created successfully.</p>
        <p>For security, keys are shown only once in the signup response and are <strong>not sent by email</strong>.</p>
        <p>If you saved your key, store it in your backend as <code>CLAWTRUST_API_KEY</code>.</p>
        <p><strong>Free tier:</strong> 5 agents, 100 events/mo, 200 score checks/mo.</p>
        <p>Need more? Upgrade anytime from your API key dashboard flow.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #888; font-size: 12px;">ClawTrustScores — Trust scoring for the agentic web.</p>
      </div>
    `,
  });
}

function upgradeConfirmationEmail(email, tier) {
  const tierLabel = tier === "pro" ? "Pro" : "Starter";
  return sendEmail({
    to: email,
    subject: `You're on ${tierLabel}! 🦀🎉`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #e63946;">Upgrade Confirmed</h2>
        <p>Your API key has been upgraded to <strong>${tierLabel}</strong>. The new limits are active immediately.</p>
        <p>Check <a href="${env("BASE_URL") || "https://claw-trust-scores-production.up.railway.app"}/v1/plans">/v1/plans</a> for your tier details.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #888; font-size: 12px;">ClawTrustScores — Trust scoring for the agentic web.</p>
      </div>
    `,
  });
}

// ---------------------------------------------------------------------------
// Stripe helpers (HTTP API — zero deps)
// ---------------------------------------------------------------------------

async function stripeRequest(method, path, body) {
  const secret = env("STRIPE_SECRET_KEY");
  if (!secret) throw new Error("STRIPE_SECRET_KEY not set");

  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message ?? `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function verifyStripeSignature(rawBody, sigHeader) {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret) return null;

  const parts = {};
  for (const item of sigHeader.split(",")) {
    const [k, v] = item.split("=");
    if (k === "t") parts.t = v;
    if (k === "v1") parts.v1 = v;
  }

  if (!parts.t || !parts.v1) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))) {
    return null;
  }

  // Reject timestamps older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - Number(parts.t);
  if (age > 300) return null;

  return JSON.parse(rawBody);
}

// ---------------------------------------------------------------------------
// Route handlers (called from server.js)
// ---------------------------------------------------------------------------

/**
 * POST /v1/users  { email }
 */
export async function handleCreateUser(payload) {
  const email = String(payload.email ?? "").trim().toLowerCase();

  if (!email || !email.includes("@") || email.length > 320) {
    return { status: 400, body: { error: "A valid email is required." } };
  }

  // Idempotent: if email already registered, re-send the key
  const result = createUser(email);

  if (result.exists) {
    return {
      status: 200,
      body: {
        message:
          "This email already has an API key. We can’t show it again. Use the key you saved, or create a new one.",
        tier: "free",
      },
    };
  }

  await welcomeEmail(email);

  return {
    status: 201,
    body: {
      message: "API key created. Copy and store it now; it is shown only once.",
      apiKey: result.apiKey,
      tier: "free",
    },
  };
}

/**
 * GET /v1/upgrade/:apiKey?tier=starter|pro
 *
 * Returns a Stripe Checkout URL. Defaults to starter if no tier specified.
 */
export async function handleUpgrade(apiKey, requestedTier) {
  const user = getUserByKey(apiKey);
  if (!user) {
    return { status: 404, body: { error: "API key not found." } };
  }

  const targetTier = requestedTier === "pro" ? "pro" : "starter";
  const priceId =
    targetTier === "pro"
      ? env("STRIPE_PRO_PRICE_ID")
      : env("STRIPE_STARTER_PRICE_ID");

  if (!priceId) {
    return {
      status: 503,
      body: { error: "Billing not configured yet. Contact support." },
    };
  }

  const currentTier = user.tier;
  if (
    (currentTier === "pro") ||
    (currentTier === "starter" && targetTier === "starter")
  ) {
    return {
      status: 400,
      body: { error: `Already on ${currentTier} tier.` },
    };
  }

  try {
    const baseUrl = env("BASE_URL") || "https://claw-trust-scores-production.up.railway.app";
    const session = await stripeRequest("POST", "/v1/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${baseUrl}/upgrade-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/upgrade-cancel`,
      customer_email: user.email,
      client_reference_id: apiKey,
      "metadata[api_key]": apiKey,
      "metadata[target_tier]": targetTier,
    });

    return {
      status: 200,
      body: {
        checkoutUrl: session.url,
        tier: targetTier,
      },
    };
  } catch (err) {
    console.error("[selfserve] Stripe checkout error:", err.message);
    return { status: 502, body: { error: "Failed to create checkout session." } };
  }
}

/**
 * POST /v1/stripe/webhook
 *
 * Handles checkout.session.completed and customer.subscription.deleted.
 */
export async function handleStripeWebhook(rawBody, sigHeader) {
  if (!sigHeader) {
    return { status: 400, body: { error: "Missing stripe-signature header." } };
  }

  const event = verifyStripeSignature(rawBody, sigHeader);
  if (!event) {
    return { status: 400, body: { error: "Invalid signature." } };
  }

  const type = event.type;

  if (type === "checkout.session.completed") {
    const session = event.data.object;
    const apiKey = session.metadata?.api_key ?? session.client_reference_id;
    const targetTier = session.metadata?.target_tier;
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    if (!apiKey || !targetTier) {
      console.warn("[selfserve] Checkout session missing metadata", session.id);
      return { status: 200, body: { received: true } };
    }

    const upgraded = upgradeTier(apiKey, targetTier, {
      customerId,
      subscriptionId,
    });

    if (upgraded) {
      const user = getUserByKey(apiKey);
      if (user?.email) {
        await upgradeConfirmationEmail(user.email, targetTier);
      }
      console.log(`[selfserve] Upgraded ${apiKey} to ${targetTier}`);
    }

    return { status: 200, body: { received: true, upgraded } };
  }

  if (type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    const user = getUserByStripeCustomerId(customerId);
    if (user) {
      downgradeTier(user.apiKey);
      console.log(`[selfserve] Downgraded ${user.apiKey} to free (subscription cancelled)`);
    }

    return { status: 200, body: { received: true } };
  }

  // Acknowledge any other event type we don't handle
  return { status: 200, body: { received: true, ignored: type } };
}
