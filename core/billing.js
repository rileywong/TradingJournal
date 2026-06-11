// Subscription / paywall model.
//
// Every new user gets a free trial; after it ends they need an active
// subscription to access their data. Entitlement is a pure function of the
// user's subscription record and the current time, so it's trivially testable
// and identical on server (gating) and client (paywall banner).

export const TRIAL_DAYS = 14;
// Dunning grace: after a renewal payment fails (Stripe → past_due) we keep
// access for this long so the user can fix their card before being locked out.
export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

/** The subscription a brand-new user starts with: a trial ending in TRIAL_DAYS. */
export function newTrial(now = Date.now()) {
  return {
    subscriptionStatus: 'trialing',
    trialEndsAt: new Date(now + TRIAL_DAYS * DAY_MS).toISOString(),
    currentPeriodEnd: null,
  };
}

/**
 * Decide whether a subscription record grants access right now.
 * @param {{subscriptionStatus, trialEndsAt, currentPeriodEnd}} sub
 * @param {number} [now] epoch ms
 * @returns {{ entitled, status, trialEndsAt, currentPeriodEnd, daysLeft }}
 *   status ∈ active | trialing | past_due | trial_expired | expired | none
 *   `past_due` is entitled (grace window) with daysLeft = grace days remaining.
 */
export function computeEntitlement(sub, now = Date.now()) {
  const s = sub || {};
  const trialEnd = s.trialEndsAt ? Date.parse(s.trialEndsAt) : 0;
  const periodEnd = s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : 0;

  // A paid, active subscription (optionally bounded by the paid period end).
  if (s.subscriptionStatus === 'active' && (!periodEnd || now <= periodEnd)) {
    return base(true, 'active', s, null);
  }

  // Dunning grace: a failed renewal keeps soft access for GRACE_DAYS past the
  // (now-lapsed) paid period so the user can update their card before lockout.
  if (s.subscriptionStatus === 'past_due') {
    const graceEnd = periodEnd ? periodEnd + GRACE_DAYS * DAY_MS : 0;
    if (!graceEnd || now <= graceEnd) {
      const daysLeft = graceEnd ? Math.max(1, Math.ceil((graceEnd - now) / DAY_MS)) : null;
      return base(true, 'past_due', s, daysLeft);
    }
    // grace exhausted → fall through to the hard paywall below.
  }

  // Within the free trial window.
  if (trialEnd && now < trialEnd) {
    const daysLeft = Math.max(1, Math.ceil((trialEnd - now) / DAY_MS));
    return base(true, 'trialing', s, daysLeft);
  }

  // Lapsed: distinguish an expired paid sub from an expired/absent trial so the
  // paywall can word itself appropriately.
  let status;
  if (['active', 'canceled', 'past_due'].includes(s.subscriptionStatus)) status = 'expired';
  else if (trialEnd) status = 'trial_expired';
  else status = 'none';
  return base(false, status, s, 0);
}

function base(entitled, status, s, daysLeft) {
  return {
    entitled,
    status,
    trialEndsAt: s.trialEndsAt || null,
    currentPeriodEnd: s.currentPeriodEnd || null,
    cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
    daysLeft,
  };
}
