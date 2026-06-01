// In-memory repository adapter.
//
// Mirrors the relational schema (users → accounts → executions/trades) and
// enforces user-isolation (RLS) on every access: a userId must own the chain
// before any account/trade/execution is returned or mutated. Swapping this for
// a Postgres-backed implementation only requires preserving this interface.

import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.js';

function uuid() {
  return crypto.randomUUID();
}

export class Repository {
  constructor() {
    this.users = new Map(); // id → user
    this.usersByEmail = new Map(); // email → id
    this.accounts = new Map(); // id → account
    this.executions = new Map(); // id → execution
    this.trades = new Map(); // id → trade
    this.dailyNotes = new Map(); // `${accountId}::${date}` → { note, updatedAt }
    this.tradeTags = new Map(); // `${accountId}::${signature}` → tags[] (durable)
  }

  /**
   * Stable identity for a closed trade, independent of its (regenerated) row id,
   * so annotations like tags survive a re-import.
   */
  tradeSignature(trade) {
    return [
      trade.symbol,
      trade.side,
      trade.openedAt,
      trade.closedAt,
      trade.quantity,
      trade.entryPrice,
      trade.exitPrice,
    ].join('|');
  }

  // --- users -------------------------------------------------------------
  createUser(email, password) {
    const normEmail = String(email || '').trim().toLowerCase();
    if (!normEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail)) {
      throw new RepoError('invalid email', 400);
    }
    if (!password || String(password).length < 6) {
      throw new RepoError('password must be at least 6 characters', 400);
    }
    if (this.usersByEmail.has(normEmail)) {
      throw new RepoError('email already registered', 409);
    }
    const user = {
      id: uuid(),
      email: normEmail,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(normEmail, user.id);
    return this.publicUser(user);
  }

  authenticate(email, password) {
    const normEmail = String(email || '').trim().toLowerCase();
    const id = this.usersByEmail.get(normEmail);
    const user = id && this.users.get(id);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new RepoError('invalid credentials', 401);
    }
    return this.publicUser(user);
  }

  getUser(userId) {
    const user = this.users.get(userId);
    return user ? this.publicUser(user) : null;
  }

  publicUser(user) {
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  // --- accounts ----------------------------------------------------------
  createAccount(userId, { name, startingBalance = 10000, commissionPerTrade = 0 }) {
    this.assertUser(userId);
    const account = {
      id: uuid(),
      userId,
      name: String(name || 'Default Account').trim(),
      startingBalance: Number(startingBalance) || 0,
      commissionPerTrade: Number(commissionPerTrade) || 0,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(account.id, account);
    return account;
  }

  listAccounts(userId) {
    this.assertUser(userId);
    return [...this.accounts.values()]
      .filter((a) => a.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** RLS gate: returns the account only if owned by userId, else throws. */
  getAccount(userId, accountId) {
    this.assertUser(userId);
    const account = this.accounts.get(accountId);
    if (!account || account.userId !== userId) {
      throw new RepoError('account not found', 404);
    }
    return account;
  }

  /** Update mutable account fields (RLS-gated). Unspecified fields are kept. */
  updateAccount(userId, accountId, { name, startingBalance, commissionPerTrade } = {}) {
    const account = this.getAccount(userId, accountId); // RLS gate
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed) account.name = trimmed;
    }
    if (startingBalance !== undefined) account.startingBalance = Number(startingBalance) || 0;
    if (commissionPerTrade !== undefined) account.commissionPerTrade = Number(commissionPerTrade) || 0;
    return account;
  }

  /** Delete an account and cascade to its executions, trades, notes, and tags. */
  deleteAccount(userId, accountId) {
    this.getAccount(userId, accountId); // RLS gate
    for (const [id, e] of this.executions) {
      if (e.accountId === accountId) this.executions.delete(id);
    }
    for (const [id, t] of this.trades) {
      if (t.accountId === accountId) this.trades.delete(id);
    }
    const prefix = `${accountId}::`;
    for (const key of this.dailyNotes.keys()) {
      if (key.startsWith(prefix)) this.dailyNotes.delete(key);
    }
    for (const key of this.tradeTags.keys()) {
      if (key.startsWith(prefix)) this.tradeTags.delete(key);
    }
    this.accounts.delete(accountId);
    return { deleted: true };
  }

  // --- executions & trades ----------------------------------------------
  /**
   * Replace the executions+trades for an account (idempotent re-import).
   * Returns counts. Ownership is enforced via getAccount().
   */
  saveImport(userId, accountId, executions, trades) {
    const account = this.getAccount(userId, accountId);

    // wipe existing rows for this account (full re-import semantics)
    for (const [id, e] of this.executions) {
      if (e.accountId === accountId) this.executions.delete(id);
    }
    for (const [id, t] of this.trades) {
      if (t.accountId === accountId) this.trades.delete(id);
    }

    for (const exec of executions) {
      const id = uuid();
      this.executions.set(id, { ...exec, id, accountId: account.id });
    }
    for (const trade of trades) {
      const id = trade.id || uuid();
      // Re-apply any tags previously attached to this trade signature so a
      // re-import doesn't wipe the user's annotations.
      const stored = this.tradeTags.get(`${account.id}::${this.tradeSignature(trade)}`);
      const tags = stored ? [...stored] : trade.tags || [];
      this.trades.set(id, { ...trade, id, accountId: account.id, tags });
    }
    return { executions: executions.length, trades: trades.length };
  }

  listTrades(userId, accountId) {
    this.getAccount(userId, accountId); // RLS gate
    return [...this.trades.values()]
      .filter((t) => t.accountId === accountId)
      .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  }

  getTrade(userId, tradeId) {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new RepoError('trade not found', 404);
    this.getAccount(userId, trade.accountId); // RLS gate via account chain
    return trade;
  }

  updateTradeTags(userId, tradeId, tags) {
    const trade = this.getTrade(userId, tradeId);
    const clean = Array.isArray(tags)
      ? [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))]
      : [];
    trade.tags = clean;
    // Persist by stable signature so the tags outlive a re-import.
    const key = `${trade.accountId}::${this.tradeSignature(trade)}`;
    if (clean.length === 0) this.tradeTags.delete(key);
    else this.tradeTags.set(key, [...clean]);
    return trade;
  }

  listExecutions(userId, accountId) {
    this.getAccount(userId, accountId); // RLS gate
    return [...this.executions.values()].filter((e) => e.accountId === accountId);
  }

  // --- daily journal notes ----------------------------------------------
  // Keyed by (account, date) rather than trade id, so notes survive a
  // re-import (which regenerates trade rows). RLS via the account chain.
  dailyNoteKey(accountId, date) {
    return `${accountId}::${date}`;
  }

  /** The saved journal note for a day, or '' when none exists. */
  getDailyNote(userId, accountId, date) {
    this.getAccount(userId, accountId); // RLS gate
    const entry = this.dailyNotes.get(this.dailyNoteKey(accountId, date));
    return entry ? entry.note : '';
  }

  /** Upsert (empty/whitespace clears) the journal note for a day. */
  setDailyNote(userId, accountId, date, note) {
    this.getAccount(userId, accountId); // RLS gate
    const text = String(note ?? '');
    const key = this.dailyNoteKey(accountId, date);
    if (text.trim() === '') {
      this.dailyNotes.delete(key);
      return '';
    }
    this.dailyNotes.set(key, { note: text, updatedAt: new Date().toISOString() });
    return text;
  }

  /** Set of YYYY-MM-DD keys that have a saved note (for calendar indicators). */
  listNotedDays(userId, accountId) {
    this.getAccount(userId, accountId); // RLS gate
    const prefix = `${accountId}::`;
    const dates = [];
    for (const key of this.dailyNotes.keys()) {
      if (key.startsWith(prefix)) dates.push(key.slice(prefix.length));
    }
    return dates;
  }

  // --- internals ---------------------------------------------------------
  assertUser(userId) {
    if (!userId || !this.users.has(userId)) {
      throw new RepoError('unauthorized', 401);
    }
  }
}

export class RepoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RepoError';
    this.status = status;
  }
}
