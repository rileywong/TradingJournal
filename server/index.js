// Express API: auth + accounts + CSV import + analytics.
// Exports createApp() for tests (supertest) and self-starts when run directly.

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Repository, RepoError } from '../core/repository.js';
import { signToken, verifyToken } from '../core/auth.js';
import { parseExecutions, dedupeExecutions, inspectCsv } from '../core/parser.js';
import { matchTrades } from '../core/matcher.js';
import { computeMetrics, equityCurve, drawdownSeries } from '../core/metrics.js';
import { buildMonthlyCalendar, buildYearHeatmap } from '../core/calendar.js';
import {
  dailyStats,
  tradesForDay,
  dailyCumulativePnl,
  isValidDateKey,
} from '../core/day.js';
import { buildAnalytics, summarize } from '../core/analytics.js';
import { buildStatistics } from '../core/statistics.js';
import { demoCsv } from '../core/demo-data.js';
import { buildPlaybook, listSetups } from '../core/playbook.js';
import { computeEntitlement } from '../core/billing.js';
import { computeScore } from '../core/score.js';
import { filterTrades } from '../core/filters.js';
import { projectBasis, normalizeBasis } from '../core/basis.js';
import { devEmailProvider, renderWelcomeEmail, renderPasswordResetEmail, renderWeeklyDigestEmail } from '../core/email.js';
import { buildWeeklyDigest } from '../core/digest.js';

// Public base URL for provider redirects (Stripe checkout/portal return links).
// Render injects RENDER_EXTERNAL_URL automatically, so APP_URL is optional there.
const appUrl = () => process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '';

// Tiny in-memory fixed-window rate limiter (per client IP). Single-instance
// deployment (SQLite on a disk) makes in-memory state sufficient.
function rateLimit({ windowMs = 15 * 60_000, max = 50 } = {}) {
  const hits = new Map(); // ip → { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'global';
    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) { rec = { count: 0, resetAt: now + windowMs }; hits.set(key, rec); }
    rec.count += 1;
    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((rec.resetAt - now) / 1000));
      return res.status(429).json({ error: 'too many attempts — please try again shortly' });
    }
    next();
  };
}

export function createApp(repo = new Repository(), options = {}) {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy → real client IP in req.ip
  app.use(cors());
  // Throttle credential / enumeration endpoints per IP.
  const authLimit = rateLimit(options.authRateLimit || { windowMs: 15 * 60_000, max: 50 });
  // Capture the raw body so Stripe webhook signatures can be verified over the
  // exact bytes (express.json() otherwise discards them after parsing).
  app.use(express.json({ limit: '15mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

  // OAuth verifiers (idToken → verified identity), injected for testability.
  // A provider is "enabled" only when a verifier is configured.
  const oauth = options.oauth || {};

  // Billing provider (Stripe-pluggable). Without one, a dev provider lets the
  // paywall flow complete locally so the trial/subscription gating is usable
  // and testable end-to-end.
  const SUB_DAYS = 30;
  const devBilling = {
    mode: 'dev',
    createCheckout: async (userId) => ({ url: `/?checkout=mock&u=${userId}`, mock: true }),
  };
  const billing = options.billing || devBilling;
  // Whether the paywall is enforced. When false (launch/early-access mode), the
  // trial/subscription gate is bypassed so everyone has full access — the
  // billing code, trial bookkeeping, and Stripe wiring all stay intact and can
  // be switched on later by flipping this flag (PAYWALL_ENABLED).
  const billingEnforced = options.billingEnforced !== false;

  // Site admins (full-site stats dashboard). Designated by email via the
  // ADMIN_EMAILS env (comma-separated) or options.adminEmails (for tests).
  const adminEmails = new Set(
    (options.adminEmails || (process.env.ADMIN_EMAILS || '').split(','))
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean),
  );
  const isAdminEmail = (email) => adminEmails.has(String(email || '').toLowerCase());
  // Tag the user payload the client stores so it can show the Admin entry.
  const withAdmin = (user) => (user ? { ...user, isAdmin: isAdminEmail(user.email) } : user);
  // The shared public-demo user; excluded from admin stats (not a real signup).
  const DEMO_EMAIL = 'demo@greenstreak.app';

  // Transactional email (pluggable). Defaults to a dev provider that records +
  // logs. Fire-and-forget: a send failure must never break the user action.
  const email = options.email || devEmailProvider();
  const sendEmail = (msg) => {
    Promise.resolve()
      .then(() => email.send(msg))
      .catch((err) => console.warn(`✉  email send failed (${msg && msg.to}):`, err.message));
  };

  // --- auth middleware ---------------------------------------------------
  function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token && verifyToken(token);
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.userId = payload.sub;
    req.isDemo = payload.demo === true;
    next();
  }

  // The public demo is read-only: reject mutations made with a demo token so the
  // shared sample data stays pristine. Reads (GET) flow through normally.
  function blockDemoWrites(req, res, next) {
    if (req.isDemo) return res.status(403).json({ error: 'demo is read-only — sign up to make changes', code: 'demo_readonly' });
    next();
  }

  const wrap = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof RepoError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'internal error' });
    }
  };

  // Async variant of wrap() for handlers that await (e.g. OAuth verification).
  const wrapAsync = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof RepoError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'internal error' });
    }
  };

  // Paywall gate: an authenticated user must have an active subscription or a
  // live trial. Returns 402 with the billing state so the client shows the
  // paywall. Applied to data routes (not to /api/me or /api/billing/*).
  const requireEntitlement = (req, res, next) => {
    if (!billingEnforced || req.isDemo) return next(); // paywall off / demo → unrestricted
    const ent = computeEntitlement(repo.getSubscription(req.userId));
    if (!ent.entitled) {
      return res.status(402).json({ error: 'subscription required', code: 'subscription_required', billing: ent });
    }
    next();
  };
  const gate = [auth, requireEntitlement];
  const writeGate = [auth, requireEntitlement, blockDemoWrites]; // mutating routes

  // Resolve a read scope: a single account (RLS-gated) or the special 'all'
  // pseudo-account that aggregates every account the user owns. Returns the
  // trade set plus the starting balance to baseline equity/score against.
  function scopeTrades(userId, accountId) {
    if (accountId === 'all') {
      const accounts = repo.listAccounts(userId);
      const startingBalance = accounts.reduce((s, a) => s + (a.startingBalance || 0), 0);
      return { trades: repo.listAllTrades(userId), startingBalance, aggregate: true };
    }
    const account = repo.getAccount(userId, accountId); // RLS gate
    return { trades: repo.listTrades(userId, accountId), startingBalance: account.startingBalance, aggregate: false };
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // --- auth routes -------------------------------------------------------
  app.post('/api/auth/register', wrap((req, res) => {
    const { email, password } = req.body || {};
    const user = repo.createUser(email, password);
    sendEmail(renderWelcomeEmail({ email: user.email, appUrl: appUrl() }));
    const token = signToken({ sub: user.id, email: user.email });
    res.status(201).json({ token, user: withAdmin(user) });
  }));

  app.post('/api/auth/login', authLimit, wrap((req, res) => {
    const { email, password } = req.body || {};
    const user = repo.authenticate(email, password);
    const token = signToken({ sub: user.id, email: user.email });
    res.json({ token, user: withAdmin(user) });
  }));

  // Public marketing waitlist (product updates for visitors not ready to sign
  // up). Idempotent: re-adding the same email is a no-op. Never reveals whether
  // the email was already present.
  app.post('/api/waitlist', wrap((req, res) => {
    repo.addToWaitlist((req.body || {}).email);
    res.status(201).json({ ok: true });
  }));

  // Request a password reset. Always 200 (never reveal whether the email exists);
  // if it does, email a one-time reset link.
  app.post('/api/auth/forgot', authLimit, wrap((req, res) => {
    const reqEmail = String((req.body || {}).email || '').trim().toLowerCase();
    const token = repo.createPasswordReset(reqEmail);
    if (token) {
      const base = appUrl() || '';
      sendEmail(renderPasswordResetEmail({ email: reqEmail, resetUrl: `${base}/?reset=${token}` }));
    }
    res.json({ ok: true });
  }));

  // Complete a password reset and sign the user in with a fresh token.
  app.post('/api/auth/reset', authLimit, wrap((req, res) => {
    const { token, password } = req.body || {};
    const user = repo.consumePasswordReset(token, password);
    const t = signToken({ sub: user.id, email: user.email });
    res.json({ token: t, user: withAdmin(user) });
  }));

  // Change password (logged in). Verifies the current password first.
  app.post('/api/auth/change-password', auth, blockDemoWrites, wrap((req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    repo.changePassword(req.userId, currentPassword, newPassword);
    res.json({ ok: true });
  }));

  // Export all of the user's own data (portability). Gated on auth only — even a
  // lapsed/locked-out user can take their data with them.
  app.get('/api/me/export', auth, blockDemoWrites, wrap((req, res) => {
    const accounts = repo.listAccounts(req.userId).map((a) => ({
      ...a,
      trades: repo.listTrades(req.userId, a.id),
    }));
    res.setHeader('Content-Disposition', 'attachment; filename="greenstreak-export.json"');
    res.json({ exportedAt: new Date().toISOString(), user: repo.getUser(req.userId), accounts });
  }));

  // Delete the account and all data (irreversible). Auth only (a locked-out user
  // can still leave).
  app.delete('/api/me', auth, blockDemoWrites, wrap((req, res) => {
    repo.deleteUser(req.userId);
    res.json({ ok: true });
  }));

  // One-click "try it with sample data": seed the user's OWN account with the
  // demo dataset (through the real parse→match→store path) so a new user can
  // explore immediately, then delete it when ready for real imports.
  app.post('/api/me/sample-data', writeGate, wrap((req, res) => {
    const account = repo.createAccount(req.userId, { name: 'Sample — ThinkOrSwim', startingBalance: 25000 });
    const { executions } = parseExecutions(demoCsv(), {});
    const { trades } = matchTrades(executions, { accountId: account.id, commissionPerTrade: 0 });
    repo.saveImport(req.userId, account.id, executions, trades);
    res.status(201).json({ account, trades: trades.length });
  }));

  // Monthly goals + month-to-date progress + last-month comparison (all accounts).
  app.get('/api/me/goals', gate, wrap((req, res) => {
    const goals = repo.getGoals(req.userId);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const all = repo.listAllTrades(req.userId);
    const inWindow = (lo, hi) => all.filter((t) => {
      const x = new Date(t.closedAt).getTime();
      return x >= lo && (hi == null || x < hi);
    });
    const slim = (s) => ({ netPnl: s.netPnl, winRate: s.winRate, trades: s.trades });
    const mtd = slim(summarize(inWindow(monthStart, null)));
    const lastMonth = slim(summarize(inWindow(lastMonthStart, monthStart)));
    res.json({ ...goals, mtd, lastMonth });
  }));

  app.put('/api/me/goals', writeGate, wrap((req, res) => {
    const { goalMonthlyPnl, goalWinRate } = req.body || {};
    res.json(repo.setGoals(req.userId, { goalMonthlyPnl, goalWinRate }));
  }));

  // Idempotently ensure a read-only demo user seeded with realistic sample
  // trades (via the same parse→match→store path as a real import). Reused across
  // visitors; only seeds the first time (when the demo account has no data).
  function ensureDemoUser() {
    const user = repo.upsertOAuthUser({
      provider: 'demo', sub: 'demo', email: DEMO_EMAIL, emailVerified: true,
    });
    if (repo.listAccounts(user.id).length === 0) {
      const account = repo.createAccount(user.id, { name: 'Demo — ThinkOrSwim', startingBalance: 25000 });
      const { executions, trades } = (() => {
        const { executions: ex } = parseExecutions(demoCsv(), {});
        const { trades: tr } = matchTrades(ex, { accountId: account.id, commissionPerTrade: 0 });
        return { executions: ex, trades: tr };
      })();
      repo.saveImport(user.id, account.id, executions, trades);
    }
    return user;
  }

  // Start a no-signup demo session: returns a token for the shared demo user.
  app.post('/api/demo', wrap((_req, res) => {
    const user = ensureDemoUser();
    const token = signToken({ sub: user.id, email: user.email, demo: true });
    res.json({ token, user: { ...withAdmin(user), demo: true } });
  }));

  // Which third-party sign-in providers are configured (for the login screen).
  app.get('/api/auth/config', (_req, res) => {
    res.json({
      providers: {
        google: { enabled: Boolean(oauth.google), clientId: options.googleClientId || null },
        apple: { enabled: Boolean(oauth.apple), clientId: options.appleClientId || null },
      },
    });
  });

  // Sign in with Google / Apple: verify the provider ID token, find-or-create
  // the user (linking by verified email), and issue our own app token.
  const oauthLogin = (provider) =>
    wrapAsync(async (req, res) => {
      const verify = oauth[provider];
      if (!verify) return res.status(501).json({ error: `${provider} sign-in not configured` });
      const idToken = (req.body && (req.body.idToken || req.body.credential)) || '';
      if (!idToken) return res.status(400).json({ error: 'idToken required' });
      let identity;
      try {
        identity = await verify(idToken);
      } catch (err) {
        return res.status(401).json({ error: `invalid ${provider} token: ${err.message}` });
      }
      const user = repo.upsertOAuthUser(identity);
      const token = signToken({ sub: user.id, email: user.email });
      res.json({ token, user: withAdmin(user) });
    });

  app.post('/api/auth/google', oauthLogin('google'));
  app.post('/api/auth/apple', oauthLogin('apple'));

  app.get('/api/me', auth, wrap((req, res) => {
    const user = repo.getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user: withAdmin(user) });
  }));

  // --- admin: site-wide stats (gated to ADMIN_EMAILS) --------------------
  function requireAdmin(req, res, next) {
    const u = req.isDemo ? null : repo.getUser(req.userId);
    if (!u || !isAdminEmail(u.email)) return res.status(403).json({ error: 'admin access required' });
    next();
  }

  const PRICE_PER_MONTH = 10;

  // Admin: send the weekly performance digest to every user with trades in the
  // last 7 days. Idempotency/scheduling is the caller's job (wire to a weekly
  // cron / Render job hitting this endpoint). Returns how many were sent.
  app.post('/api/admin/send-digests', auth, requireAdmin, wrap((_req, res) => {
    const users = repo.adminListUsers().filter((u) => u.email !== DEMO_EMAIL && u.tradeCount > 0);
    let sent = 0;
    for (const u of users) {
      const digest = buildWeeklyDigest(repo.listAllTrades(u.id));
      if (!digest) continue;
      sendEmail(renderWeeklyDigestEmail({ email: u.email, appUrl: appUrl(), digest }));
      sent += 1;
    }
    res.json({ sent });
  }));

  // Admin: export the full user list as CSV (for outreach / analysis).
  app.get('/api/admin/users.csv', auth, requireAdmin, wrap((_req, res) => {
    const users = repo.adminListUsers().filter((u) => u.email !== DEMO_EMAIL);
    const rows = [['email', 'joinedAt', 'status', 'accounts', 'trades', 'auth'].join(',')];
    for (const u of users) {
      const status = computeEntitlement({
        subscriptionStatus: u.subscriptionStatus, trialEndsAt: u.trialEndsAt,
        currentPeriodEnd: u.currentPeriodEnd, cancelAtPeriodEnd: u.cancelAtPeriodEnd,
      }).status;
      rows.push([u.email, u.createdAt, status, u.accountCount, u.tradeCount, u.oauth ? 'sso' : 'email'].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="greenstreak-users.csv"');
    res.send(rows.join('\n'));
  }));

  app.get('/api/admin/stats', auth, requireAdmin, wrap((_req, res) => {
    const now = Date.now();
    const DAY = 86_400_000;
    const users = repo.adminListUsers().filter((u) => u.email !== DEMO_EMAIL);

    const entOf = (u) => computeEntitlement({
      subscriptionStatus: u.subscriptionStatus,
      trialEndsAt: u.trialEndsAt,
      currentPeriodEnd: u.currentPeriodEnd,
      cancelAtPeriodEnd: u.cancelAtPeriodEnd,
    }, now);

    const mondayUTC = (ms) => {
      const d = new Date(ms);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    };

    const funnel = { active: 0, trialing: 0, past_due: 0, trial_expired: 0, expired: 0, none: 0 };
    let usersWithData = 0, createdAccount = 0, totalAccounts = 0, totalTrades = 0;
    let today = 0, last7 = 0, last30 = 0;
    const dayBuckets = new Map(); // yyyy-mm-dd → signups
    // Mutually-exclusive segments explaining where non-converters stall.
    const dropOff = { subscribed: 0, no_account: 0, no_import: 0, in_trial: 0, lapsed: 0 };
    const cohortMap = new Map(); // week-start → { signups, activated, subscribed }

    for (const u of users) {
      const st = entOf(u).status;
      funnel[st] = (funnel[st] || 0) + 1;
      if (u.accountCount > 0) createdAccount += 1;
      if (u.tradeCount > 0) usersWithData += 1;
      totalAccounts += u.accountCount;
      totalTrades += u.tradeCount;

      if (st === 'active') dropOff.subscribed += 1;
      else if (u.accountCount === 0) dropOff.no_account += 1;
      else if (u.tradeCount === 0) dropOff.no_import += 1;
      else if (st === 'trialing' || st === 'past_due') dropOff.in_trial += 1;
      else dropOff.lapsed += 1;

      const wk = mondayUTC(Date.parse(u.createdAt));
      const c = cohortMap.get(wk) || { signups: 0, activated: 0, subscribed: 0 };
      c.signups += 1;
      if (u.tradeCount > 0) c.activated += 1;
      if (st === 'active') c.subscribed += 1;
      cohortMap.set(wk, c);

      const age = now - Date.parse(u.createdAt);
      if (age <= DAY) today += 1;
      if (age <= 7 * DAY) last7 += 1;
      if (age <= 30 * DAY) {
        last30 += 1;
        const key = new Date(Date.parse(u.createdAt)).toISOString().slice(0, 10);
        dayBuckets.set(key, (dayBuckets.get(key) || 0) + 1);
      }
    }

    // Weekly cohorts (last 8 weeks, oldest → newest): does conversion improve?
    const cohorts = [];
    for (let k = 7; k >= 0; k--) {
      const weekStart = mondayUTC(now - k * 7 * DAY);
      const c = cohortMap.get(weekStart) || { signups: 0, activated: 0, subscribed: 0 };
      cohorts.push({
        weekStart,
        signups: c.signups,
        activated: c.activated,
        subscribed: c.subscribed,
        activatedPct: c.signups ? c.activated / c.signups : null,
        subscribedPct: c.signups ? c.subscribed / c.signups : null,
      });
    }

    // 30-day signup series (oldest → newest), zero-filled for a sparkline.
    const signupSeries = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now - i * DAY).toISOString().slice(0, 10);
      signupSeries.push({ date, count: dayBuckets.get(date) || 0 });
    }

    const payingUsers = funnel.active;
    const lapsed = funnel.trial_expired + funnel.expired;

    // Acquisition funnel: each stage is a milestone a signed-up user reached, so
    // the admin can see where people drop off on the way to converting. `pctOfTop`
    // is share of all signups; `pctOfPrev` is the step-to-step conversion.
    const rawStages = [
      { key: 'signed_up', label: 'Signed up', count: users.length },
      { key: 'created_account', label: 'Created an account', count: createdAccount },
      { key: 'imported', label: 'Imported trades', count: usersWithData },
      { key: 'subscribed', label: 'Subscribed', count: payingUsers },
    ];
    const top = users.length || 1;
    const funnelStages = rawStages.map((s, i) => {
      const prev = i === 0 ? s.count : rawStages[i - 1].count;
      return {
        ...s,
        pctOfTop: users.length ? s.count / top : 0,
        pctOfPrev: prev ? s.count / prev : null,
        droppedFromPrev: i === 0 ? 0 : Math.max(0, rawStages[i - 1].count - s.count),
      };
    });

    const recentSignups = [...users]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12)
      .map((u) => ({
        email: u.email,
        createdAt: u.createdAt,
        status: entOf(u).status,
        oauth: u.oauth,
        tradeCount: u.tradeCount,
      }));

    res.json({
      totalUsers: users.length,
      signups: { today, last7, last30 },
      funnel,
      revenue: {
        payingUsers,
        mrr: payingUsers * PRICE_PER_MONTH,
        arr: payingUsers * PRICE_PER_MONTH * 12,
        pricePerMonth: PRICE_PER_MONTH,
      },
      // Trial→paid conversion among users who've reached a decision point.
      conversion: { paid: payingUsers, lapsed, rate: payingUsers + lapsed > 0 ? payingUsers / (payingUsers + lapsed) : null },
      engagement: { usersWithData, totalAccounts, totalTrades },
      funnelStages,
      dropOff,
      cohorts,
      waitlistCount: repo.countWaitlist(),
      signupSeries,
      recentSignups,
      generatedAt: new Date(now).toISOString(),
    });
  }));

  // --- billing (trial + subscription) ------------------------------------
  // Current entitlement: trial days left / active / expired. Drives the paywall.
  app.get('/api/billing/status', auth, wrap((req, res) => {
    res.json({
      billing: computeEntitlement(repo.getSubscription(req.userId)),
      mode: billing.mode || 'stripe',
      enforced: billingEnforced,
    });
  }));

  // Begin a subscription: returns a checkout URL to redirect the browser to.
  app.post('/api/billing/checkout', auth, wrapAsync(async (req, res) => {
    const sub = repo.getSubscription(req.userId);
    const session = await billing.createCheckout(req.userId, {
      email: (repo.getUser(req.userId) || {}).email,
      stripeCustomerId: sub.stripeCustomerId,
      // Prefer the server-configured app URL over the client-supplied Origin
      // header so redirect targets aren't attacker-influenced.
      origin: appUrl() || req.headers.origin || '',
    });
    res.json(session);
  }));

  // Open the provider's billing portal (manage payment method / cancel). Only
  // available with a provider that supports it (e.g. Stripe) and an existing
  // customer; 404 otherwise so the UI can hide the entry point.
  app.post('/api/billing/portal', auth, wrapAsync(async (req, res) => {
    if (!billing.createPortal) return res.status(404).json({ error: 'not found' });
    const sub = repo.getSubscription(req.userId);
    if (!sub.stripeCustomerId) return res.status(404).json({ error: 'no subscription to manage' });
    const session = await billing.createPortal(req.userId, {
      stripeCustomerId: sub.stripeCustomerId,
      origin: appUrl() || req.headers.origin || '',
    });
    res.json(session);
  }));

  // Dev-only: complete the mock checkout (no Stripe configured) by activating a
  // 30-day subscription. Disabled when a real billing provider is wired in.
  app.post('/api/billing/mock-complete', auth, wrap((req, res) => {
    if (billing.mode !== 'dev') return res.status(404).json({ error: 'not found' });
    const currentPeriodEnd = new Date(Date.now() + SUB_DAYS * 86_400_000).toISOString();
    repo.setSubscription(req.userId, { subscriptionStatus: 'active', currentPeriodEnd });
    res.json({ billing: computeEntitlement(repo.getSubscription(req.userId)) });
  }));

  // Stripe webhook (subscription lifecycle). The provider verifies the signature
  // and maps the event to { userId, subscriptionStatus, currentPeriodEnd }. A
  // bad signature is a 400 (Stripe will retry), not a 500.
  app.post('/api/billing/webhook', async (req, res) => {
    if (!billing.handleWebhook) return res.status(404).json({ error: 'not found' });
    let update;
    try {
      update = await billing.handleWebhook(req);
    } catch (err) {
      return res.status(400).json({ error: `webhook error: ${err.message}` });
    }
    try {
      if (update && update.userId) {
        // Idempotency: Stripe may deliver an event more than once (retries) or
        // out of order. Skip an event id we've already applied.
        if (update.eventId && repo.hasWebhookEvent && repo.hasWebhookEvent(update.eventId)) {
          return res.json({ received: true, duplicate: true });
        }
        repo.setSubscription(update.userId, update);
        if (update.eventId && repo.recordWebhookEvent) repo.recordWebhookEvent(update.eventId);
      }
    } catch (err) {
      console.error('failed to apply subscription update', err);
    }
    res.json({ received: true });
  });

  // --- accounts ----------------------------------------------------------
  app.get('/api/accounts', gate, wrap((req, res) => {
    res.json({ accounts: repo.listAccounts(req.userId) });
  }));

  app.post('/api/accounts', writeGate, wrap((req, res) => {
    const { name, startingBalance, commissionPerTrade } = req.body || {};
    const account = repo.createAccount(req.userId, {
      name,
      startingBalance,
      commissionPerTrade,
    });
    res.status(201).json({ account });
  }));

  app.patch('/api/accounts/:id', writeGate, wrap((req, res) => {
    const account = repo.updateAccount(req.userId, req.params.id, req.body || {});
    res.json({ account });
  }));

  app.delete('/api/accounts/:id', writeGate, wrap((req, res) => {
    repo.deleteAccount(req.userId, req.params.id);
    res.json({ ok: true });
  }));

  // Tag management across an account's trades.
  app.post('/api/accounts/:id/tags/rename', writeGate, wrap((req, res) => {
    const { from, to } = req.body || {};
    res.json({ result: repo.renameTag(req.userId, req.params.id, from, to) });
  }));

  app.post('/api/accounts/:id/tags/delete', writeGate, wrap((req, res) => {
    const { tag } = req.body || {};
    res.json({ result: repo.removeTag(req.userId, req.params.id, tag) });
  }));

  // --- import ------------------------------------------------------------
  // Inspect an unrecognized CSV so the UI can offer manual column mapping.
  app.post('/api/import/preview', writeGate, wrap((req, res) => {
    const { csv } = req.body || {};
    if (typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'csv content required' });
    }
    res.json(inspectCsv(csv));
  }));

  app.post('/api/import', writeGate, wrap((req, res) => {
    const { accountId, csv, broker, mapping } = req.body || {};
    const mode = req.body && req.body.mode === 'append' ? 'append' : 'replace';
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    if (typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'csv content required' });
    }
    const account = repo.getAccount(req.userId, accountId); // RLS gate

    const { broker: detected, executions: parsed, errors } = parseExecutions(csv, { broker, mapping });

    // Append mode merges this file's fills with the account's existing
    // executions (de-duping exact repeats), then re-derives ALL trades from the
    // union — so a position opened on one broker and closed on another matches.
    const addedCount = parsed.length;
    let executions = parsed;
    if (mode === 'append') {
      const existing = repo.listExecutions(req.userId, accountId);
      executions = dedupeExecutions([...existing, ...parsed]);
    }

    const { trades, open } = matchTrades(executions, {
      accountId,
      commissionPerTrade: account.commissionPerTrade,
    });
    const saved = repo.saveImport(req.userId, accountId, executions, trades);

    // Distinct brokers now present in the account (union for append) — lets the
    // UI confirm e.g. "merged 2 brokers: ThinkOrSwim, Webull".
    const accountBrokers = [...new Set(executions.map((e) => e.broker))];

    res.json({
      broker: detected,
      accountBrokers,
      mode,
      addedExecutions: addedCount,
      imported: saved,
      errors,
      openPositions: open,
      metrics: computeMetrics(trades, { startingBalance: account.startingBalance }),
    });
  }));

  // --- analytics ---------------------------------------------------------
  app.get('/api/trades', gate, wrap((req, res) => {
    const { accountId, symbol, side, tag, setup, outcome, from, to } = req.query;
    // Date-range bounds are compared lexically, so reject non-canonical keys
    // rather than silently mis-filtering.
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const { trades } = scopeTrades(req.userId, accountId);
    res.json({ trades: filterTrades(trades, { symbol, side, tag, setup, outcome, from, to }) });
  }));

  app.patch('/api/trades/:id', writeGate, wrap((req, res) => {
    const { tags, riskAmount, note, setup } = req.body || {};
    let trade;
    if (tags !== undefined) trade = repo.updateTradeTags(req.userId, req.params.id, tags);
    if (riskAmount !== undefined) trade = repo.updateTradeRisk(req.userId, req.params.id, riskAmount);
    if (note !== undefined) trade = repo.updateTradeNote(req.userId, req.params.id, note);
    if (setup !== undefined) trade = repo.updateTradeSetup(req.userId, req.params.id, setup);
    if (!trade) trade = repo.getTrade(req.userId, req.params.id);
    res.json({ trade });
  }));

  app.get('/api/metrics', gate, wrap((req, res) => {
    const { accountId, from, to } = req.query;
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const basis = normalizeBasis(req.query.basis);
    const { trades: all, startingBalance } = scopeTrades(req.userId, accountId);
    const trades = projectBasis(filterTrades(all, { from, to }), basis);
    res.json({
      metrics: computeMetrics(trades, { startingBalance }),
      equityCurve: equityCurve(trades, startingBalance),
      drawdownCurve: drawdownSeries(trades, startingBalance),
      score: computeScore(trades, { startingBalance }),
    });
  }));

  app.get('/api/calendar', gate, wrap((req, res) => {
    const { accountId } = req.query;
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
    const { trades: all, aggregate } = scopeTrades(req.userId, accountId);
    const trades = projectBasis(all, normalizeBasis(req.query.basis));
    res.json({
      calendar: buildMonthlyCalendar(trades, year, month),
      notedDays: aggregate ? [] : repo.listNotedDays(req.userId, accountId),
    });
  }));

  // GitHub-style yearly P&L heatmap (respects net/gross basis).
  app.get('/api/year', gate, wrap((req, res) => {
    const { accountId } = req.query;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const { trades: all } = scopeTrades(req.userId, accountId);
    const trades = projectBasis(all, normalizeBasis(req.query.basis));
    res.json({ heatmap: buildYearHeatmap(trades, year) });
  }));

  // Day drill-down: TradeZella-style daily stats, the day's trades, and an
  // intraday cumulative-P&L series for the chart.
  app.get('/api/day', gate, wrap((req, res) => {
    const { accountId, date } = req.query;
    if (!isValidDateKey(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const account = repo.getAccount(req.userId, accountId); // RLS gate
    const trades = repo.listTrades(req.userId, accountId);
    res.json({
      date,
      stats: dailyStats(trades, date, { startingBalance: account.startingBalance }),
      trades: tradesForDay(trades, date),
      cumulative: dailyCumulativePnl(trades, date),
      note: repo.getDailyNote(req.userId, accountId, date),
    });
  }));

  // Upsert the journal note for a day (empty body clears it).
  app.put('/api/day/note', writeGate, wrap((req, res) => {
    const { accountId, date, note } = req.body || {};
    if (!isValidDateKey(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const saved = repo.setDailyNote(req.userId, accountId, date, note);
    res.json({ date, note: saved });
  }));

  // Reports: performance breakdowns by symbol / side / weekday / hour / tag,
  // plus hold-time and streak summaries.
  app.get('/api/analytics', gate, wrap((req, res) => {
    const { accountId, from, to } = req.query;
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const { trades: all } = scopeTrades(req.userId, accountId);
    const trades = projectBasis(filterTrades(all, { from, to }), normalizeBasis(req.query.basis));
    res.json({ analytics: buildAnalytics(trades) });
  }));

  // Advanced statistics (daily consistency, Kelly, Sharpe, trade economics),
  // scope/period/basis aware like the other analytical endpoints.
  app.get('/api/statistics', gate, wrap((req, res) => {
    const { accountId, from, to } = req.query;
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const { trades: all } = scopeTrades(req.userId, accountId);
    const trades = projectBasis(filterTrades(all, { from, to }), normalizeBasis(req.query.basis));
    res.json({ statistics: buildStatistics(trades) });
  }));

  // Setup playbook: per-strategy performance breakdown (scope/period/basis aware).
  app.get('/api/playbook', gate, wrap((req, res) => {
    const { accountId, from, to } = req.query;
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const { trades: all } = scopeTrades(req.userId, accountId);
    const trades = projectBasis(filterTrades(all, { from, to }), normalizeBasis(req.query.basis));
    res.json({ playbook: buildPlaybook(trades), setups: listSetups(trades) });
  }));

  // Serve the built frontend (single-process production/preview mode) when a
  // Vite build exists. In dev, the Vite server handles the client and proxies
  // /api here instead, so this branch is simply skipped.
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, '..', 'dist');
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist));
    // SPA fallback: any non-API route returns index.html.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(join(dist, 'index.html'));
    });
  }

  return app;
}

// Self-start when executed directly (not when imported by tests).
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = process.env.PORT || 4000;

  // Auth tokens are HMAC-signed with TJS_SECRET. The built-in default is only
  // safe for local dev — with it, anyone could forge a session token. Refuse to
  // boot in production (or with the paywall enforced) unless a real secret is set.
  const secretIsDefault = !process.env.TJS_SECRET || process.env.TJS_SECRET === 'dev-secret-change-me';
  const isProd = process.env.NODE_ENV === 'production';
  const paywallOn = String(process.env.PAYWALL_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (secretIsDefault && (isProd || paywallOn)) {
    const msg = 'TJS_SECRET is unset or the insecure default. Set TJS_SECRET to a long random string (e.g. `openssl rand -hex 32`) before serving real users — auth tokens are forgeable otherwise.';
    if (isProd) { console.error(`✖ ${msg}`); process.exit(1); }
    console.warn(`⚠  ${msg}`);
  }
  // Persist to SQLite by default so data survives restarts; DB_PATH=:memory:
  // gives an ephemeral store. Tests inject the in-memory Repository instead.
  const { SqliteRepository } = await import('../core/sqlite-repository.js');
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = process.env.DB_PATH || join(here, '..', 'data', 'trade.db');
  if (dbPath !== ':memory:') {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const repo = new SqliteRepository(dbPath);

  // Enable Google/Apple sign-in when their client IDs are configured.
  const { googleVerifier, appleVerifier } = await import('../core/oauth.js');
  const oauth = {};
  const googleClientId = process.env.GOOGLE_CLIENT_ID || null;
  const appleClientId = process.env.APPLE_CLIENT_ID || null;
  if (googleClientId) oauth.google = googleVerifier({ clientId: googleClientId });
  if (appleClientId) oauth.apple = appleVerifier({ clientId: appleClientId });

  // Use real Stripe billing when configured; otherwise the built-in dev provider.
  let billing;
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID) {
    const { stripeBilling } = await import('../core/stripe-billing.js');
    billing = stripeBilling({
      secretKey: process.env.STRIPE_SECRET_KEY,
      priceId: process.env.STRIPE_PRICE_ID,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      appUrl: appUrl(),
    });
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.warn('⚠  STRIPE_WEBHOOK_SECRET is not set — webhook signature checks will reject every event, so subscriptions will never activate. Set it to the signing secret of your Stripe webhook endpoint.');
    }
  }

  // Paywall enforcement: default ON, but set PAYWALL_ENABLED=false to launch in
  // open/early-access mode (everyone gets full access; billing stays wired up).
  const billingEnforced = String(process.env.PAYWALL_ENABLED ?? 'true').toLowerCase() !== 'false';

  createApp(repo, { oauth, googleClientId, appleClientId, billing, billingEnforced }).listen(PORT, () => {
    const enabled = Object.keys(oauth).join(', ') || 'email/password only';
    console.log(`Greenstreak API on http://localhost:${PORT} (db: ${dbPath}; auth: ${enabled}; billing: ${billing ? 'stripe' : 'dev'}; paywall: ${billingEnforced ? 'enforced' : 'OFF (open access)'})`);
  });
}
