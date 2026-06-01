// Express API: auth + accounts + CSV import + analytics.
// Exports createApp() for tests (supertest) and self-starts when run directly.

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Repository, RepoError } from '../core/repository.js';
import { signToken, verifyToken } from '../core/auth.js';
import { parseExecutions, dedupeExecutions } from '../core/parser.js';
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
import { computeScore } from '../core/score.js';
import { filterTrades } from '../core/filters.js';
import { projectBasis, normalizeBasis } from '../core/basis.js';

export function createApp(repo = new Repository()) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

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

  app.get('/api/me', auth, wrap((req, res) => {
    const user = repo.getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  }));

  // --- accounts ----------------------------------------------------------
  app.get('/api/accounts', auth, wrap((req, res) => {
    res.json({ accounts: repo.listAccounts(req.userId) });
  }));

  app.post('/api/accounts', auth, wrap((req, res) => {
    const { name, startingBalance, commissionPerTrade } = req.body || {};
    const account = repo.createAccount(req.userId, {
      name,
      startingBalance,
      commissionPerTrade,
    });
    res.status(201).json({ account });
  }));

  app.patch('/api/accounts/:id', auth, wrap((req, res) => {
    const account = repo.updateAccount(req.userId, req.params.id, req.body || {});
    res.json({ account });
  }));

  app.delete('/api/accounts/:id', auth, wrap((req, res) => {
    repo.deleteAccount(req.userId, req.params.id);
    res.json({ ok: true });
  }));

  // Tag management across an account's trades.
  app.post('/api/accounts/:id/tags/rename', auth, wrap((req, res) => {
    const { from, to } = req.body || {};
    res.json({ result: repo.renameTag(req.userId, req.params.id, from, to) });
  }));

  app.post('/api/accounts/:id/tags/delete', auth, wrap((req, res) => {
    const { tag } = req.body || {};
    res.json({ result: repo.removeTag(req.userId, req.params.id, tag) });
  }));

  // --- import ------------------------------------------------------------
  app.post('/api/import', auth, wrap((req, res) => {
    const { accountId, csv, broker } = req.body || {};
    const mode = req.body && req.body.mode === 'append' ? 'append' : 'replace';
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    if (typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'csv content required' });
    }
    const account = repo.getAccount(req.userId, accountId); // RLS gate

    const { broker: detected, executions: parsed, errors } = parseExecutions(csv, { broker });

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

    res.json({
      broker: detected,
      mode,
      addedExecutions: addedCount,
      imported: saved,
      errors,
      openPositions: open,
      metrics: computeMetrics(trades, { startingBalance: account.startingBalance }),
    });
  }));

  // --- analytics ---------------------------------------------------------
  app.get('/api/trades', auth, wrap((req, res) => {
    const { accountId, symbol, side, tag, outcome, from, to } = req.query;
    // Date-range bounds are compared lexically, so reject non-canonical keys
    // rather than silently mis-filtering.
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const trades = repo.listTrades(req.userId, accountId);
    res.json({ trades: filterTrades(trades, { symbol, side, tag, outcome, from, to }) });
  }));

  app.patch('/api/trades/:id', auth, wrap((req, res) => {
    const { tags, riskAmount, note } = req.body || {};
    let trade;
    if (tags !== undefined) trade = repo.updateTradeTags(req.userId, req.params.id, tags);
    if (riskAmount !== undefined) trade = repo.updateTradeRisk(req.userId, req.params.id, riskAmount);
    if (note !== undefined) trade = repo.updateTradeNote(req.userId, req.params.id, note);
    if (!trade) trade = repo.getTrade(req.userId, req.params.id);
    res.json({ trade });
  }));

  app.get('/api/metrics', auth, wrap((req, res) => {
    const { accountId, from, to } = req.query;
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const account = repo.getAccount(req.userId, accountId);
    const basis = normalizeBasis(req.query.basis);
    const trades = projectBasis(
      filterTrades(repo.listTrades(req.userId, accountId), { from, to }),
      basis
    );
    res.json({
      metrics: computeMetrics(trades, { startingBalance: account.startingBalance }),
      equityCurve: equityCurve(trades, account.startingBalance),
      drawdownCurve: drawdownSeries(trades, account.startingBalance),
      score: computeScore(trades, { startingBalance: account.startingBalance }),
    });
  }));

  app.get('/api/calendar', auth, wrap((req, res) => {
    const { accountId } = req.query;
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
    const trades = projectBasis(repo.listTrades(req.userId, accountId), normalizeBasis(req.query.basis));
    res.json({
      calendar: buildMonthlyCalendar(trades, year, month),
      notedDays: repo.listNotedDays(req.userId, accountId),
    });
  }));

  // GitHub-style yearly P&L heatmap (respects net/gross basis).
  app.get('/api/year', auth, wrap((req, res) => {
    const { accountId } = req.query;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const trades = projectBasis(repo.listTrades(req.userId, accountId), normalizeBasis(req.query.basis));
    res.json({ heatmap: buildYearHeatmap(trades, year) });
  }));

  // Day drill-down: TradeZella-style daily stats, the day's trades, and an
  // intraday cumulative-P&L series for the chart.
  app.get('/api/day', auth, wrap((req, res) => {
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
  app.put('/api/day/note', auth, wrap((req, res) => {
    const { accountId, date, note } = req.body || {};
    if (!isValidDateKey(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const saved = repo.setDailyNote(req.userId, accountId, date, note);
    res.json({ date, note: saved });
  }));

  // Reports: performance breakdowns by symbol / side / weekday / hour / tag,
  // plus hold-time and streak summaries.
  app.get('/api/analytics', auth, wrap((req, res) => {
    const { accountId, from, to } = req.query;
    if ((from && !isValidDateKey(from)) || (to && !isValidDateKey(to))) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const trades = projectBasis(
      filterTrades(repo.listTrades(req.userId, accountId), { from, to }), // RLS gate
      normalizeBasis(req.query.basis)
    );
    res.json({ analytics: buildAnalytics(trades) });
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
  createApp().listen(PORT, () => {
    console.log(`TradeJournalSimplified API listening on http://localhost:${PORT}`);
  });
}
