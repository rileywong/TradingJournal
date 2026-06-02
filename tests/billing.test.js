import { describe, it, expect } from 'vitest';
import { computeEntitlement, newTrial, TRIAL_DAYS, GRACE_DAYS } from '../core/billing.js';

const NOW = Date.parse('2024-06-01T00:00:00.000Z');
const days = (n) => new Date(NOW + n * 86_400_000).toISOString();

describe('newTrial', () => {
  it('starts a trial ending TRIAL_DAYS out', () => {
    const sub = newTrial(NOW);
    expect(sub.subscriptionStatus).toBe('trialing');
    expect(Date.parse(sub.trialEndsAt)).toBe(NOW + TRIAL_DAYS * 86_400_000);
  });
});

describe('computeEntitlement', () => {
  it('grants access during the trial and reports days left', () => {
    const e = computeEntitlement({ subscriptionStatus: 'trialing', trialEndsAt: days(3) }, NOW);
    expect(e).toMatchObject({ entitled: true, status: 'trialing', daysLeft: 3 });
  });

  it('blocks access once the trial has expired', () => {
    const e = computeEntitlement({ subscriptionStatus: 'trialing', trialEndsAt: days(-1) }, NOW);
    expect(e).toMatchObject({ entitled: false, status: 'trial_expired', daysLeft: 0 });
  });

  it('grants access for an active subscription within its period', () => {
    const e = computeEntitlement({ subscriptionStatus: 'active', currentPeriodEnd: days(20) }, NOW);
    expect(e).toMatchObject({ entitled: true, status: 'active' });
  });

  it('blocks an active subscription past its period end', () => {
    const e = computeEntitlement({ subscriptionStatus: 'active', currentPeriodEnd: days(-2) }, NOW);
    expect(e).toMatchObject({ entitled: false, status: 'expired' });
  });

  it('treats a canceled, lapsed subscription as expired', () => {
    const e = computeEntitlement({ subscriptionStatus: 'canceled', trialEndsAt: days(-30) }, NOW);
    expect(e.entitled).toBe(false);
    expect(e.status).toBe('expired');
  });

  it('handles a missing subscription record', () => {
    expect(computeEntitlement(null, NOW)).toMatchObject({ entitled: false, status: 'none' });
  });

  it('rounds partial trial days up (never shows 0 while still entitled)', () => {
    const e = computeEntitlement({ subscriptionStatus: 'trialing', trialEndsAt: new Date(NOW + 3600_000).toISOString() }, NOW);
    expect(e.entitled).toBe(true);
    expect(e.daysLeft).toBe(1);
  });

  describe('dunning grace (past_due)', () => {
    it('keeps soft access during the grace window after a failed renewal', () => {
      // Period lapsed 1 day ago; still within the GRACE_DAYS window.
      const e = computeEntitlement({ subscriptionStatus: 'past_due', currentPeriodEnd: days(-1) }, NOW);
      expect(e).toMatchObject({ entitled: true, status: 'past_due' });
      expect(e.daysLeft).toBe(GRACE_DAYS - 1);
    });

    it('locks out once the grace window is exhausted', () => {
      const e = computeEntitlement({ subscriptionStatus: 'past_due', currentPeriodEnd: days(-(GRACE_DAYS + 1)) }, NOW);
      expect(e).toMatchObject({ entitled: false, status: 'expired' });
    });

    it('grants grace even without a period end (Stripe drives the eventual cancel)', () => {
      const e = computeEntitlement({ subscriptionStatus: 'past_due', currentPeriodEnd: null }, NOW);
      expect(e).toMatchObject({ entitled: true, status: 'past_due', daysLeft: null });
    });

    it('recovers to active when payment succeeds', () => {
      const e = computeEntitlement({ subscriptionStatus: 'active', currentPeriodEnd: days(20) }, NOW);
      expect(e.status).toBe('active');
    });
  });
});
