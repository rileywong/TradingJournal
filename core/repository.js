// In-memory repository adapter.
//
// Mirrors the relational schema (users → accounts → executions/trades) and
// enforces user-isolation (RLS) on every access: a userId must own the chain
// before any account/trade/execution is returned or mutated. Swapping this for
// a Postgres-backed implementation only requires preserving this interface.

import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.js';
import { newTrial } from './billing.js';

function uuid() {
  return crypto.randomUUID();
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/** Normalize a marketing source/referral tag; defaults to 'direct'. */
export function sanitizeSource(s) {
  const v = String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return v || 'direct';
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
    this.tradeRisk = new Map(); // `${accountId}::${signature}` → riskAmount (durable)
    this.tradeNotes = new Map(); // `${accountId}::${signature}` → note (durable)
    this.tradeSetups = new Map(); // `${accountId}::${signature}` → setup (durable)
    this.oauthIdentities = new Map(); // `${provider}:${sub}` → userId
    this.webhookEvents = new Set(); // processed billing webhook event ids (idempotency)
    this.waitlist = new Map(); // email → { email, createdAt } (marketing list)
    this.passwordResets = new Map(); // tokenHash → { userId, expiresAt }
  }

  /**
   * Find-or-create a user from a verified OAuth identity. Links to an existing
   * account with the same email (account takeover by a verified provider email
   * is the standard SSO merge), else creates a password-less user.
   * @param {{ provider, sub, email, emailVerified }} identity
   */
  upsertOAuthUser({ provider, sub, email, emailVerified = true }) {
    if (!provider || !sub) throw new RepoError('invalid oauth identity', 400);
    const normEmail = String(email || '').trim().toLowerCase();
    if (!normEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail)) {
      throw new RepoError('invalid email', 400);
    }
    if (!emailVerified) throw new RepoError('email not verified by provider', 400);

    const idKey = `${provider}:${sub}`;
    const linkedId = this.oauthIdentities.get(idKey);
    if (linkedId && this.users.has(linkedId)) return this.publicUser(this.users.get(linkedId));

    let userId = this.usersByEmail.get(normEmail);
    if (!userId) {
      const user = {
        id: uuid(),
        email: normEmail,
        passwordHash: null, // password-less; sign-in is via the provider
        createdAt: new Date().toISOString(),
        ...newTrial(),
      };
      this.users.set(user.id, user);
      this.usersByEmail.set(normEmail, user.id);
      userId = user.id;
    }
    this.oauthIdentities.set(idKey, userId);
    return this.publicUser(this.users.get(userId));
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
  createUser(email, password, source) {
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
      source: sanitizeSource(source),
      ...newTrial(),
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

  // --- email preferences -------------------------------------------------
  getEmailPrefs(userId) {
    const u = this.users.get(userId);
    if (!u) throw new RepoError('unauthorized', 401);
    return { digest: !u.emailOptOut };
  }

  /** Set marketing-email opt-out (transactional email always sends). */
  setEmailOptOut(userId, optOut) {
    const u = this.users.get(userId);
    if (!u) throw new RepoError('unauthorized', 401);
    u.emailOptOut = !!optOut;
    return { digest: !u.emailOptOut };
  }

  // --- goals (monthly targets) -------------------------------------------
  getGoals(userId) {
    const u = this.users.get(userId);
    if (!u) throw new RepoError('unauthorized', 401);
    return { goalMonthlyPnl: u.goalMonthlyPnl ?? null, goalWinRate: u.goalWinRate ?? null };
  }

  setGoals(userId, { goalMonthlyPnl, goalWinRate } = {}) {
    const u = this.users.get(userId);
    if (!u) throw new RepoError('unauthorized', 401);
    if (goalMonthlyPnl !== undefined) u.goalMonthlyPnl = goalMonthlyPnl == null || goalMonthlyPnl === '' ? null : Number(goalMonthlyPnl);
    if (goalWinRate !== undefined) u.goalWinRate = goalWinRate == null || goalWinRate === '' ? null : Number(goalWinRate);
    return this.getGoals(userId);
  }

  /** Delete a user and ALL their data (accounts cascade to trades/notes/tags). */
  deleteUser(userId) {
    const user = this.users.get(userId);
    if (!user) throw new RepoError('unauthorized', 401);
    for (const a of this.listAccounts(userId)) this.deleteAccount(userId, a.id);
    this.users.delete(userId);
    this.usersByEmail.delete(user.email);
    for (const [k, uid] of this.oauthIdentities) if (uid === userId) this.oauthIdentities.delete(k);
    for (const [k, rec] of this.passwordResets) if (rec.userId === userId) this.passwordResets.delete(k);
  }

  /** Change a logged-in user's password after verifying the current one. */
  changePassword(userId, currentPassword, newPassword) {
    const user = this.users.get(userId);
    if (!user) throw new RepoError('unauthorized', 401);
    if (!user.passwordHash) throw new RepoError('this account signs in with Google/Apple', 400);
    if (!verifyPassword(currentPassword, user.passwordHash)) throw new RepoError('current password is incorrect', 400);
    if (!newPassword || String(newPassword).length < 6) throw new RepoError('password must be at least 6 characters', 400);
    user.passwordHash = hashPassword(newPassword);
    return this.publicUser(user);
  }

  // --- password reset ----------------------------------------------------
  /** Issue a reset token for `email`. Returns the (plaintext) token, or null if
   *  no such user — the caller still responds 200 to avoid leaking existence. */
  createPasswordReset(email, ttlMs = 3600_000) {
    const normEmail = String(email || '').trim().toLowerCase();
    const userId = this.usersByEmail.get(normEmail);
    if (!userId) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(token);
    this.passwordResets.set(tokenHash, { userId, expiresAt: Date.now() + ttlMs });
    return token;
  }

  /** Validate the token, set the new password, and invalidate the token. */
  consumePasswordReset(token, newPassword) {
    const rec = this.passwordResets.get(sha256(String(token || '')));
    if (!rec || rec.expiresAt < Date.now()) throw new RepoError('invalid or expired reset token', 400);
    if (!newPassword || String(newPassword).length < 6) {
      throw new RepoError('password must be at least 6 characters', 400);
    }
    const user = this.users.get(rec.userId);
    if (!user) throw new RepoError('invalid or expired reset token', 400);
    user.passwordHash = hashPassword(newPassword);
    this.passwordResets.delete(sha256(String(token)));
    return this.publicUser(user);
  }

  publicUser(user) {
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  // --- admin (site-wide aggregates; the CALLER must enforce admin access) ---
  /**
   * One row per user with subscription fields and account/trade counts, for the
   * admin stats dashboard. Never includes password hashes. Not RLS-scoped — only
   * call from an admin-gated route.
   */
  adminListUsers() {
    const acctOwner = new Map(); // accountId → userId
    const acctCount = new Map(); // userId → #accounts
    for (const a of this.accounts.values()) {
      acctOwner.set(a.id, a.userId);
      acctCount.set(a.userId, (acctCount.get(a.userId) || 0) + 1);
    }
    const tradeCount = new Map(); // userId → #trades
    for (const t of this.trades.values()) {
      const uid = acctOwner.get(t.accountId);
      if (uid) tradeCount.set(uid, (tradeCount.get(uid) || 0) + 1);
    }
    return [...this.users.values()].map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      oauth: !u.passwordHash,
      source: u.source || 'direct',
      emailOptOut: !!u.emailOptOut,
      subscriptionStatus: u.subscriptionStatus || 'trialing',
      trialEndsAt: u.trialEndsAt || null,
      currentPeriodEnd: u.currentPeriodEnd || null,
      cancelAtPeriodEnd: !!u.cancelAtPeriodEnd,
      accountCount: acctCount.get(u.id) || 0,
      tradeCount: tradeCount.get(u.id) || 0,
    }));
  }

  // --- waitlist (marketing list; public add, admin read) -------------------
  addToWaitlist(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new RepoError('invalid email', 400);
    if (!this.waitlist.has(e)) this.waitlist.set(e, { email: e, createdAt: new Date().toISOString() });
    return { email: e };
  }

  countWaitlist() { return this.waitlist.size; }

  listWaitlist() {
    return [...this.waitlist.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The user's subscription record (status + trial/period bounds). */
  getSubscription(userId) {
    const user = this.users.get(userId);
    if (!user) throw new RepoError('unauthorized', 401);
    return {
      subscriptionStatus: user.subscriptionStatus || 'trialing',
      trialEndsAt: user.trialEndsAt || null,
      currentPeriodEnd: user.currentPeriodEnd || null,
      stripeCustomerId: user.stripeCustomerId || null,
      cancelAtPeriodEnd: !!user.cancelAtPeriodEnd,
    };
  }

  /** Update subscription fields (unspecified fields are preserved). */
  setSubscription(userId, { subscriptionStatus, currentPeriodEnd, trialEndsAt, stripeCustomerId, cancelAtPeriodEnd } = {}) {
    const user = this.users.get(userId);
    if (!user) throw new RepoError('unauthorized', 401);
    if (subscriptionStatus !== undefined) user.subscriptionStatus = subscriptionStatus;
    if (currentPeriodEnd !== undefined) user.currentPeriodEnd = currentPeriodEnd;
    if (trialEndsAt !== undefined) user.trialEndsAt = trialEndsAt;
    if (stripeCustomerId !== undefined) user.stripeCustomerId = stripeCustomerId;
    if (cancelAtPeriodEnd !== undefined) user.cancelAtPeriodEnd = !!cancelAtPeriodEnd;
    return this.getSubscription(userId);
  }

  /** Has this billing webhook event id already been applied? (idempotency) */
  hasWebhookEvent(eventId) {
    return this.webhookEvents.has(eventId);
  }

  /** Record a billing webhook event id as applied. */
  recordWebhookEvent(eventId) {
    if (eventId) this.webhookEvents.add(eventId);
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
    for (const key of this.tradeSetups.keys()) {
      if (key.startsWith(prefix)) this.tradeSetups.delete(key);
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
      const sigKey = `${account.id}::${this.tradeSignature(trade)}`;
      const storedTags = this.tradeTags.get(sigKey);
      const tags = storedTags ? [...storedTags] : trade.tags || [];
      const storedRisk = this.tradeRisk.get(sigKey);
      const riskAmount = storedRisk !== undefined ? storedRisk : trade.riskAmount || 0;
      const storedNote = this.tradeNotes.get(sigKey);
      const note = storedNote !== undefined ? storedNote : trade.note || '';
      const storedSetup = this.tradeSetups.get(sigKey);
      const setup = storedSetup !== undefined ? storedSetup : trade.setup || '';
      this.trades.set(id, { ...trade, id, accountId: account.id, tags, riskAmount, note, setup });
    }
    return { executions: executions.length, trades: trades.length };
  }

  listTrades(userId, accountId) {
    this.getAccount(userId, accountId); // RLS gate
    return [...this.trades.values()]
      .filter((t) => t.accountId === accountId)
      .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  }

  /** All closed trades across every account the user owns, oldest-first. */
  listAllTrades(userId) {
    this.assertUser(userId);
    const owned = new Set(
      [...this.accounts.values()].filter((a) => a.userId === userId).map((a) => a.id)
    );
    return [...this.trades.values()]
      .filter((t) => owned.has(t.accountId))
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

  /**
   * Set a trade's planned risk (initial $ at risk), persisted durably by
   * signature so it survives a re-import. A non-positive value clears it.
   */
  updateTradeRisk(userId, tradeId, riskAmount) {
    const trade = this.getTrade(userId, tradeId);
    const risk = Number(riskAmount);
    const clean = Number.isFinite(risk) && risk > 0 ? Math.round(risk * 100) / 100 : 0;
    trade.riskAmount = clean;
    const key = `${trade.accountId}::${this.tradeSignature(trade)}`;
    if (clean === 0) this.tradeRisk.delete(key);
    else this.tradeRisk.set(key, clean);
    return trade;
  }

  /** Set a trade's journal note, persisted durably by signature (empty clears). */
  updateTradeNote(userId, tradeId, note) {
    const trade = this.getTrade(userId, tradeId);
    const text = String(note ?? '');
    const key = `${trade.accountId}::${this.tradeSignature(trade)}`;
    if (text.trim() === '') {
      this.tradeNotes.delete(key);
      trade.note = '';
    } else {
      this.tradeNotes.set(key, text);
      trade.note = text;
    }
    return trade;
  }

  /** Assign a trade's setup/strategy, persisted durably by signature (empty clears). */
  updateTradeSetup(userId, tradeId, setup) {
    const trade = this.getTrade(userId, tradeId);
    const text = String(setup ?? '').trim();
    const key = `${trade.accountId}::${this.tradeSignature(trade)}`;
    if (text === '') {
      this.tradeSetups.delete(key);
      trade.setup = '';
    } else {
      this.tradeSetups.set(key, text);
      trade.setup = text;
    }
    return trade;
  }

  /** Rename a tag across every trade in the account (durable store included). */
  renameTag(userId, accountId, from, to) {
    this.getAccount(userId, accountId); // RLS gate
    const oldTag = String(from || '').trim();
    const newTag = String(to || '').trim();
    if (!oldTag || !newTag) throw new RepoError('from and to tags required', 400);
    let affected = 0;
    if (oldTag === newTag) return { affected, from: oldTag, to: newTag };
    for (const t of this.trades.values()) {
      if (t.accountId !== accountId || !t.tags.includes(oldTag)) continue;
      const next = [...new Set(t.tags.map((x) => (x === oldTag ? newTag : x)))];
      t.tags = next;
      this.tradeTags.set(`${accountId}::${this.tradeSignature(t)}`, [...next]);
      affected += 1;
    }
    return { affected, from: oldTag, to: newTag };
  }

  /** Remove a tag from every trade in the account (durable store included). */
  removeTag(userId, accountId, tag) {
    this.getAccount(userId, accountId); // RLS gate
    const target = String(tag || '').trim();
    if (!target) throw new RepoError('tag required', 400);
    let affected = 0;
    for (const t of this.trades.values()) {
      if (t.accountId !== accountId || !t.tags.includes(target)) continue;
      const next = t.tags.filter((x) => x !== target);
      t.tags = next;
      const key = `${accountId}::${this.tradeSignature(t)}`;
      if (next.length === 0) this.tradeTags.delete(key);
      else this.tradeTags.set(key, [...next]);
      affected += 1;
    }
    return { affected, tag: target };
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
