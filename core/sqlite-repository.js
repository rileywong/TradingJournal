// SQLite-backed repository (node:sqlite, synchronous — mirrors Repository's API).
//
// Same contract and RLS guarantees as the in-memory Repository, so it's a
// drop-in for createApp(repo). Executions and trades are stored as JSON blobs
// with indexed columns (accountId, closedAt, signature) for querying/sorting;
// durable per-trade annotations (tags/risk/note) live in trade_attrs keyed by
// (accountId, signature) so they survive a re-import.

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { hashPassword, verifyPassword } from './auth.js';
import { RepoError } from './repository.js';

// Load the built-in native module via require so bundlers (Vite/Vitest) don't
// try to transform/resolve `node:sqlite` themselves.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const uuid = () => crypto.randomUUID();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function tradeSignature(t) {
  return [t.symbol, t.side, t.openedAt, t.closedAt, t.quantity, t.entryPrice, t.exitPrice].join('|');
}

export class SqliteRepository {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.#migrate();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
        passwordHash TEXT, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL,
        startingBalance REAL NOT NULL, commissionPerTrade REAL NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(userId);
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY, accountId TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_exec_account ON executions(accountId);
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY, accountId TEXT NOT NULL, closedAt TEXT,
        signature TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(accountId);
      CREATE TABLE IF NOT EXISTS daily_notes (
        accountId TEXT NOT NULL, date TEXT NOT NULL, note TEXT NOT NULL,
        updatedAt TEXT NOT NULL, PRIMARY KEY (accountId, date)
      );
      CREATE TABLE IF NOT EXISTS trade_attrs (
        accountId TEXT NOT NULL, signature TEXT NOT NULL,
        tags TEXT, risk REAL, note TEXT, PRIMARY KEY (accountId, signature)
      );
    `);
  }

  tradeSignature(trade) {
    return tradeSignature(trade);
  }

  // --- users -------------------------------------------------------------
  createUser(email, password) {
    const normEmail = String(email || '').trim().toLowerCase();
    if (!normEmail || !EMAIL_RE.test(normEmail)) throw new RepoError('invalid email', 400);
    if (!password || String(password).length < 6) {
      throw new RepoError('password must be at least 6 characters', 400);
    }
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(normEmail)) {
      throw new RepoError('email already registered', 409);
    }
    const user = { id: uuid(), email: normEmail, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO users (id, email, passwordHash, createdAt) VALUES (?, ?, ?, ?)')
      .run(user.id, user.email, user.passwordHash, user.createdAt);
    return this.publicUser(user);
  }

  authenticate(email, password) {
    const normEmail = String(email || '').trim().toLowerCase();
    const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new RepoError('invalid credentials', 401);
    }
    return this.publicUser(user);
  }

  getUser(userId) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return user ? this.publicUser(user) : null;
  }

  publicUser(user) {
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  // --- accounts ----------------------------------------------------------
  createAccount(userId, { name, startingBalance = 10000, commissionPerTrade = 0 }) {
    this.assertUser(userId);
    const account = {
      id: uuid(), userId,
      name: String(name || 'Default Account').trim(),
      startingBalance: Number(startingBalance) || 0,
      commissionPerTrade: Number(commissionPerTrade) || 0,
      createdAt: new Date().toISOString(),
    };
    this.db.prepare('INSERT INTO accounts (id, userId, name, startingBalance, commissionPerTrade, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(account.id, account.userId, account.name, account.startingBalance, account.commissionPerTrade, account.createdAt);
    return account;
  }

  listAccounts(userId) {
    this.assertUser(userId);
    return this.db.prepare('SELECT * FROM accounts WHERE userId = ? ORDER BY createdAt ASC').all(userId);
  }

  getAccount(userId, accountId) {
    this.assertUser(userId);
    const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!account || account.userId !== userId) throw new RepoError('account not found', 404);
    return account;
  }

  updateAccount(userId, accountId, { name, startingBalance, commissionPerTrade } = {}) {
    const account = this.getAccount(userId, accountId);
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed) account.name = trimmed;
    }
    if (startingBalance !== undefined) account.startingBalance = Number(startingBalance) || 0;
    if (commissionPerTrade !== undefined) account.commissionPerTrade = Number(commissionPerTrade) || 0;
    this.db.prepare('UPDATE accounts SET name = ?, startingBalance = ?, commissionPerTrade = ? WHERE id = ?')
      .run(account.name, account.startingBalance, account.commissionPerTrade, accountId);
    return account;
  }

  deleteAccount(userId, accountId) {
    this.getAccount(userId, accountId);
    for (const table of ['executions', 'trades', 'daily_notes', 'trade_attrs']) {
      this.db.prepare(`DELETE FROM ${table} WHERE accountId = ?`).run(accountId);
    }
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    return { deleted: true };
  }

  // --- executions & trades ----------------------------------------------
  saveImport(userId, accountId, executions, trades) {
    const account = this.getAccount(userId, accountId);
    const tx = this.db;
    tx.exec('BEGIN');
    try {
      tx.prepare('DELETE FROM executions WHERE accountId = ?').run(accountId);
      tx.prepare('DELETE FROM trades WHERE accountId = ?').run(accountId);

      const insExec = tx.prepare('INSERT INTO executions (id, accountId, data) VALUES (?, ?, ?)');
      for (const exec of executions) {
        const id = uuid();
        insExec.run(id, account.id, JSON.stringify({ ...exec, id, accountId: account.id }));
      }

      const insTrade = tx.prepare('INSERT INTO trades (id, accountId, closedAt, signature, data) VALUES (?, ?, ?, ?, ?)');
      const getAttr = tx.prepare('SELECT * FROM trade_attrs WHERE accountId = ? AND signature = ?');
      for (const trade of trades) {
        const id = trade.id || uuid();
        const sig = tradeSignature(trade);
        const attr = getAttr.get(account.id, sig);
        const tags = attr && attr.tags != null ? JSON.parse(attr.tags) : trade.tags || [];
        const riskAmount = attr && attr.risk != null ? attr.risk : trade.riskAmount || 0;
        const note = attr && attr.note != null ? attr.note : trade.note || '';
        const stored = { ...trade, id, accountId: account.id, tags, riskAmount, note };
        insTrade.run(id, account.id, trade.closedAt || null, sig, JSON.stringify(stored));
      }
      tx.exec('COMMIT');
    } catch (err) {
      tx.exec('ROLLBACK');
      throw err;
    }
    return { executions: executions.length, trades: trades.length };
  }

  listTrades(userId, accountId) {
    this.getAccount(userId, accountId);
    return this.#tradeRows('SELECT data FROM trades WHERE accountId = ?', [accountId]);
  }

  listAllTrades(userId) {
    this.assertUser(userId);
    return this.#tradeRows(
      'SELECT t.data FROM trades t JOIN accounts a ON a.id = t.accountId WHERE a.userId = ?',
      [userId]
    );
  }

  #tradeRows(sql, params) {
    const rows = this.db.prepare(sql).all(...params).map((r) => JSON.parse(r.data));
    return rows.sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  }

  #getTradeRow(tradeId) {
    return this.db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  }

  getTrade(userId, tradeId) {
    const row = this.#getTradeRow(tradeId);
    if (!row) throw new RepoError('trade not found', 404);
    this.getAccount(userId, row.accountId);
    return JSON.parse(row.data);
  }

  #saveTrade(trade) {
    this.db.prepare('UPDATE trades SET data = ? WHERE id = ?').run(JSON.stringify(trade), trade.id);
  }

  #upsertAttr(accountId, signature, { tags, risk, note }) {
    this.db.prepare(`
      INSERT INTO trade_attrs (accountId, signature, tags, risk, note) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(accountId, signature) DO UPDATE SET
        tags = COALESCE(excluded.tags, trade_attrs.tags),
        risk = COALESCE(excluded.risk, trade_attrs.risk),
        note = COALESCE(excluded.note, trade_attrs.note)
    `).run(accountId, signature, tags ?? null, risk ?? null, note ?? null);
  }

  updateTradeTags(userId, tradeId, tags) {
    const trade = this.getTrade(userId, tradeId);
    const clean = Array.isArray(tags) ? [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))] : [];
    trade.tags = clean;
    this.#saveTrade(trade);
    const sig = tradeSignature(trade);
    this.#upsertAttr(trade.accountId, sig, { tags: JSON.stringify(clean) });
    return trade;
  }

  updateTradeRisk(userId, tradeId, riskAmount) {
    const trade = this.getTrade(userId, tradeId);
    const risk = Number(riskAmount);
    const clean = Number.isFinite(risk) && risk > 0 ? Math.round(risk * 100) / 100 : 0;
    trade.riskAmount = clean;
    this.#saveTrade(trade);
    this.#upsertAttr(trade.accountId, tradeSignature(trade), { risk: clean });
    return trade;
  }

  updateTradeNote(userId, tradeId, note) {
    const trade = this.getTrade(userId, tradeId);
    const text = String(note ?? '');
    trade.note = text.trim() === '' ? '' : text;
    this.#saveTrade(trade);
    this.#upsertAttr(trade.accountId, tradeSignature(trade), { note: trade.note });
    return trade;
  }

  renameTag(userId, accountId, from, to) {
    this.getAccount(userId, accountId);
    const oldTag = String(from || '').trim();
    const newTag = String(to || '').trim();
    if (!oldTag || !newTag) throw new RepoError('from and to tags required', 400);
    let affected = 0;
    if (oldTag === newTag) return { affected, from: oldTag, to: newTag };
    for (const trade of this.listTrades(userId, accountId)) {
      if (!trade.tags || !trade.tags.includes(oldTag)) continue;
      trade.tags = [...new Set(trade.tags.map((x) => (x === oldTag ? newTag : x)))];
      this.#saveTrade(trade);
      this.#upsertAttr(accountId, tradeSignature(trade), { tags: JSON.stringify(trade.tags) });
      affected += 1;
    }
    return { affected, from: oldTag, to: newTag };
  }

  removeTag(userId, accountId, tag) {
    this.getAccount(userId, accountId);
    const target = String(tag || '').trim();
    if (!target) throw new RepoError('tag required', 400);
    let affected = 0;
    for (const trade of this.listTrades(userId, accountId)) {
      if (!trade.tags || !trade.tags.includes(target)) continue;
      trade.tags = trade.tags.filter((x) => x !== target);
      this.#saveTrade(trade);
      this.#upsertAttr(accountId, tradeSignature(trade), { tags: JSON.stringify(trade.tags) });
      affected += 1;
    }
    return { affected, tag: target };
  }

  listExecutions(userId, accountId) {
    this.getAccount(userId, accountId);
    return this.db.prepare('SELECT data FROM executions WHERE accountId = ?').all(accountId).map((r) => JSON.parse(r.data));
  }

  // --- daily journal notes ----------------------------------------------
  getDailyNote(userId, accountId, date) {
    this.getAccount(userId, accountId);
    const row = this.db.prepare('SELECT note FROM daily_notes WHERE accountId = ? AND date = ?').get(accountId, date);
    return row ? row.note : '';
  }

  setDailyNote(userId, accountId, date, note) {
    this.getAccount(userId, accountId);
    const text = String(note ?? '');
    if (text.trim() === '') {
      this.db.prepare('DELETE FROM daily_notes WHERE accountId = ? AND date = ?').run(accountId, date);
      return '';
    }
    this.db.prepare(`
      INSERT INTO daily_notes (accountId, date, note, updatedAt) VALUES (?, ?, ?, ?)
      ON CONFLICT(accountId, date) DO UPDATE SET note = excluded.note, updatedAt = excluded.updatedAt
    `).run(accountId, date, text, new Date().toISOString());
    return text;
  }

  listNotedDays(userId, accountId) {
    this.getAccount(userId, accountId);
    return this.db.prepare('SELECT date FROM daily_notes WHERE accountId = ?').all(accountId).map((r) => r.date);
  }

  // --- internals ---------------------------------------------------------
  assertUser(userId) {
    if (!userId || !this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
      throw new RepoError('unauthorized', 401);
    }
  }

  close() {
    this.db.close();
  }
}
