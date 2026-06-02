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
import { buildAnalytics } from '../core/analytics.js';
import { buildPlaybook, listSetups } from '../core/playbook.js';
import { computeEntitlement } from '../core/billing.js';
import { computeScore } from '../core/score.js';
import { filterTrades } from '../core/filters.js';
import { projectBasis, normalizeBasis } from '../core/basis.js';

export function createApp(repo = new Repository(), options = {}) {
  const app = express();
  app.use(cors());
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

  // --- auth middleware ---------------------------------------------------
  function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token && verifyToken(token);
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.userId = payload.sub;
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
    const ent = computeEntitlement(repo.getSubscription(req.userId));
    if (!ent.entitled) {
      return res.status(402).json({ error: 'subscription required', code: 'subscription_required', billing: ent });
    }
    next();
  };
  const gate = [auth, requireEntitlement];

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
    const token = signToken({ sub: user.id, email: user.email });
    res.status(201).json({ token, user });
  }));

  app.post('/api/auth/login', wrap((req, res) => {
    const { email, password } = req.body || {};
    const user = repo.authenticate(email, password);
    const token = signToken({ sub: user.id, email: user.email });
    res.json({ token, user });
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
      res.json({ token, user });
    });

  app.post('/api/auth/google', oauthLogin('google'));
  app.post('/api/auth/apple', oauthLogin('apple'));

  app.get('/api/me', auth, wrap((req, res) => {
    const user = repo.getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  }));

  // --- billing (trial + subscription) ------------------------------------
  // Current entitlement: trial days left / active / expired. Drives the paywall.
  app.get('/api/billing/status', auth, wrap((req, res) => {
    res.json({ billing: computeEntitlement(repo.getSubscription(req.userId)), mode: billing.mode || 'stripe' });
  }));

  // Begin a subscription: returns a checkout URL to redirect the browser to.
  app.post('/api/billing/checkout', auth, wrapAsync(async (req, res) => {
    const sub = repo.getSubscription(req.userId);
    const session = await billing.createCheckout(req.userId, {
      email: (repo.getUser(req.userId) || {}).email,
      stripeCustomerId: sub.stripeCustomerId,
      origin: req.headers.origin || process.env.APP_URL || '',
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
      origin: req.headers.origin || process.env.APP_URL || '',
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
      if (update && update.userId) repo.setSubscription(update.userId, update);
    } catch (err) {
      console.error('failed to apply subscription update', err);
    }
    res.json({ received: true });
  });

  // --- accounts ----------------------------------------------------------
  app.get('/api/accounts', gate, wrap((req, res) => {
    res.json({ accounts: repo.listAccounts(req.userId) });
  }));

  app.post('/api/accounts', gate, wrap((req, res) => {
    const { name, startingBalance, commissionPerTrade } = req.body || {};
    const account = repo.createAccount(req.userId, {
      name,
      startingBalance,
      commissionPerTrade,
    });
    res.status(201).json({ account });
  }));

  app.patch('/api/accounts/:id', gate, wrap((req, res) => {
    const account = repo.updateAccount(req.userId, req.params.id, req.body || {});
    res.json({ account });
  }));

  app.delete('/api/accounts/:id', gate, wrap((req, res) => {
    repo.deleteAccount(req.userId, req.params.id);
    res.json({ ok: true });
  }));

  // Tag management across an account's trades.
  app.post('/api/accounts/:id/tags/rename', gate, wrap((req, res) => {
    const { from, to } = req.body || {};
    res.json({ result: repo.renameTag(req.userId, req.params.id, from, to) });
  }));

  app.post('/api/accounts/:id/tags/delete', gate, wrap((req, res) => {
    const { tag } = req.body || {};
    res.json({ result: repo.removeTag(req.userId, req.params.id, tag) });
  }));

  // --- import ------------------------------------------------------------
  // Inspect an unrecognized CSV so the UI can offer manual column mapping.
  app.post('/api/import/preview', gate, wrap((req, res) => {
    const { csv } = req.body || {};
    if (typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'csv content required' });
    }
    res.json(inspectCsv(csv));
  }));

  app.post('/api/import', gate, wrap((req, res) => {
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

  app.patch('/api/trades/:id', gate, wrap((req, res) => {
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
  app.put('/api/day/note', gate, wrap((req, res) => {
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
      appUrl: process.env.APP_URL || '',
    });
  }

  createApp(repo, { oauth, googleClientId, appleClientId, billing }).listen(PORT, () => {
    const enabled = Object.keys(oauth).join(', ') || 'email/password only';
    console.log(`TradeJournalSimplified API on http://localhost:${PORT} (db: ${dbPath}; auth: ${enabled}; billing: ${billing ? 'stripe' : 'dev'})`);
  });
}
