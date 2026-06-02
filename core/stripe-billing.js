// Stripe billing provider (dependency-free: REST API via fetch + HMAC webhook
// verification via node:crypto). Implements the billing provider interface that
// createApp() expects: { mode, createCheckout, handleWebhook }.
//
// Wire it up by setting STRIPE_SECRET_KEY, STRIPE_PRICE_ID, and
// STRIPE_WEBHOOK_SECRET. `fetchImpl` is injectable for testing.

import crypto from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

// Flatten a nested object into Stripe's bracketed form encoding, e.g.
// { line_items: [{ price: 'p', quantity: 1 }] } → line_items[0][price]=p&...
function toForm(obj, prefix, params = new URLSearchParams()) {
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (typeof val === 'object') toForm(val, k, params);
    else params.append(k, String(val));
  }
  return params;
}

function toIso(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header) over the
 * raw request body, returning the parsed event. Throws on any mismatch.
 * @param {Buffer|string} payload  the raw (unparsed) request body
 * @param {string} header          the Stripe-Signature header value
 * @param {string} secret          the webhook signing secret (whsec_…)
 * @param {{ toleranceSec?: number, now?: () => number }} [opts]
 */
export function verifyStripeSignature(payload, header, secret, { toleranceSec = 300, now = Date.now } = {}) {
  if (!payload || !header || !secret) throw new Error('missing webhook signature material');
  const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
  const parts = {};
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  if (!parts.t || !parts.v1) throw new Error('malformed signature header');

  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('signature mismatch');
  if (Math.abs(now() / 1000 - Number(parts.t)) > toleranceSec) throw new Error('timestamp outside tolerance');

  return JSON.parse(raw);
}

/** Map a Stripe subscription status to our coarse status. */
export function mapStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due') return 'past_due'; // dunning → soft grace window
  return 'canceled'; // canceled / unpaid / incomplete(_expired) → not entitled
}

export function stripeBilling({
  secretKey,
  priceId,
  webhookSecret,
  appUrl = '',
  fetchImpl = globalThis.fetch,
}) {
  if (!secretKey || !priceId) throw new Error('stripeBilling requires secretKey and priceId');

  async function api(method, path, body) {
    const res = await fetchImpl(`${STRIPE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body ? toForm(body).toString() : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`stripe ${path}: ${(json.error && json.error.message) || res.status}`);
    return json;
  }

  return {
    mode: 'stripe',

    // Create a hosted Checkout Session for a subscription and return its URL.
    async createCheckout(userId, { email, stripeCustomerId, origin } = {}) {
      const base = origin || appUrl || '';
      const session = await api('POST', '/checkout/sessions', {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}/?checkout=success`,
        cancel_url: `${base}/?checkout=cancel`,
        client_reference_id: userId,
        subscription_data: { metadata: { userId } },
        ...(stripeCustomerId ? { customer: stripeCustomerId } : email ? { customer_email: email } : {}),
      });
      return { url: session.url, id: session.id };
    },

    // Create a Billing Portal session so an active subscriber can update payment
    // details, switch plans, or cancel. Requires the Stripe customer id we stored
    // from checkout.
    async createPortal(userId, { stripeCustomerId, origin } = {}) {
      if (!stripeCustomerId) throw new Error('no Stripe customer for this account');
      const base = origin || appUrl || '';
      const session = await api('POST', '/billing_portal/sessions', {
        customer: stripeCustomerId,
        return_url: `${base}/`,
      });
      return { url: session.url };
    },

    // Verify + interpret a webhook event into a subscription update (or null to
    // ignore). The server persists the result via repo.setSubscription().
    async handleWebhook(req) {
      const event = verifyStripeSignature(req.rawBody, req.headers['stripe-signature'], webhookSecret);
      const obj = (event.data && event.data.object) || {};

      if (event.type === 'checkout.session.completed') {
        let currentPeriodEnd = null;
        if (obj.subscription) {
          try {
            const sub = await api('GET', `/subscriptions/${obj.subscription}`);
            currentPeriodEnd = toIso(sub.current_period_end);
          } catch {
            // best-effort; a later subscription.updated event corrects the period
          }
        }
        return {
          userId: obj.client_reference_id,
          subscriptionStatus: 'active',
          currentPeriodEnd,
          stripeCustomerId: obj.customer || null,
          cancelAtPeriodEnd: false, // a fresh subscription isn't pending cancellation
        };
      }

      if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const userId = obj.metadata && obj.metadata.userId;
        const status = event.type.endsWith('deleted') ? 'canceled' : mapStatus(obj.status);
        return {
          userId,
          subscriptionStatus: status,
          currentPeriodEnd: toIso(obj.current_period_end),
          stripeCustomerId: obj.customer || null,
          // Set when the user cancels via the portal: stays active until the
          // period end, then Stripe fires subscription.deleted.
          cancelAtPeriodEnd: !!obj.cancel_at_period_end,
        };
      }

      return null; // unhandled event type
    },
  };
}
