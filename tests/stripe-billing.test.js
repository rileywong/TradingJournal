import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { stripeBilling, verifyStripeSignature, mapStatus } from '../core/stripe-billing.js';

const SECRET = 'whsec_test';

// Build a Stripe-Signature header for a raw payload (mirrors how Stripe signs).
function sign(raw, { ts = Math.floor(Date.now() / 1000), secret = SECRET } = {}) {
  const v1 = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

describe('verifyStripeSignature', () => {
  const raw = JSON.stringify({ id: 'evt_1', type: 'ping' });

  it('accepts a correctly signed payload and returns the parsed event', () => {
    const event = verifyStripeSignature(raw, sign(raw), SECRET);
    expect(event).toMatchObject({ id: 'evt_1', type: 'ping' });
  });

  it('rejects a tampered payload', () => {
    const header = sign(raw);
    expect(() => verifyStripeSignature(raw + ' ', header, SECRET)).toThrow(/signature mismatch/);
  });

  it('rejects a wrong secret', () => {
    expect(() => verifyStripeSignature(raw, sign(raw), 'whsec_other')).toThrow(/signature mismatch/);
  });

  it('rejects a stale timestamp outside tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 10_000;
    expect(() => verifyStripeSignature(raw, sign(raw, { ts: old }), SECRET)).toThrow(/tolerance/);
  });

  it('rejects malformed headers / missing material', () => {
    expect(() => verifyStripeSignature(raw, 'nope', SECRET)).toThrow(/malformed/);
    expect(() => verifyStripeSignature('', sign(raw), SECRET)).toThrow(/missing/);
  });
});

describe('mapStatus', () => {
  it('maps Stripe statuses to our coarse states', () => {
    expect(mapStatus('active')).toBe('active');
    expect(mapStatus('trialing')).toBe('active');
    expect(mapStatus('canceled')).toBe('canceled');
    expect(mapStatus('past_due')).toBe('canceled');
  });
});

describe('stripeBilling.createCheckout', () => {
  it('POSTs a subscription checkout session and returns its URL', async () => {
    let captured;
    const fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }) };
    };
    const billing = stripeBilling({ secretKey: 'sk_test', priceId: 'price_123', webhookSecret: SECRET, fetchImpl });
    const out = await billing.createCheckout('user-1', { email: 'a@b.com', origin: 'https://app.example' });

    expect(out.url).toBe('https://checkout.stripe.com/c/cs_1');
    expect(captured.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(captured.opts.headers.Authorization).toBe('Bearer sk_test');
    const body = captured.opts.body;
    expect(body).toContain('mode=subscription');
    expect(body).toContain('line_items%5B0%5D%5Bprice%5D=price_123');
    expect(body).toContain('client_reference_id=user-1');
    expect(body).toContain('subscription_data%5Bmetadata%5D%5BuserId%5D=user-1');
    expect(body).toContain('success_url=https%3A%2F%2Fapp.example%2F%3Fcheckout%3Dsuccess');
  });

  it('throws a useful error when Stripe returns an error', async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad price' } }) });
    const billing = stripeBilling({ secretKey: 'sk', priceId: 'price', webhookSecret: SECRET, fetchImpl });
    await expect(billing.createCheckout('u')).rejects.toThrow(/bad price/);
  });
});

describe('stripeBilling.handleWebhook', () => {
  const provider = (fetchImpl) => stripeBilling({ secretKey: 'sk', priceId: 'price', webhookSecret: SECRET, fetchImpl });
  const reqFor = (event) => {
    const raw = JSON.stringify(event);
    return { rawBody: Buffer.from(raw), headers: { 'stripe-signature': sign(raw) } };
  };

  it('activates on checkout.session.completed (fetching the period end)', async () => {
    const periodEnd = Math.floor(Date.parse('2024-07-01T00:00:00Z') / 1000);
    const fetchImpl = async (url) => {
      expect(url).toContain('/subscriptions/sub_9');
      return { ok: true, json: async () => ({ id: 'sub_9', current_period_end: periodEnd }) };
    };
    const update = await provider(fetchImpl).handleWebhook(reqFor({
      id: 'evt', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user-7', customer: 'cus_1', subscription: 'sub_9' } },
    }));
    expect(update).toMatchObject({ userId: 'user-7', subscriptionStatus: 'active', stripeCustomerId: 'cus_1' });
    expect(update.currentPeriodEnd).toBe('2024-07-01T00:00:00.000Z');
  });

  it('cancels on customer.subscription.deleted (no fetch needed)', async () => {
    const update = await provider(async () => { throw new Error('should not fetch'); }).handleWebhook(reqFor({
      id: 'evt', type: 'customer.subscription.deleted',
      data: { object: { metadata: { userId: 'user-7' }, status: 'canceled', customer: 'cus_1' } },
    }));
    expect(update).toMatchObject({ userId: 'user-7', subscriptionStatus: 'canceled' });
  });

  it('ignores unrelated events', async () => {
    const update = await provider(async () => ({})).handleWebhook(reqFor({ id: 'e', type: 'invoice.paid', data: { object: {} } }));
    expect(update).toBeNull();
  });

  it('rejects an unsigned/forged webhook', async () => {
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    const req = { rawBody: Buffer.from(raw), headers: { 'stripe-signature': 't=1,v1=deadbeef' } };
    await expect(provider(async () => ({})).handleWebhook(req)).rejects.toThrow(/signature/);
  });
});
