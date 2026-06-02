import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteRepository } from '../core/sqlite-repository.js';

let repo;
beforeEach(() => {
  repo = new SqliteRepository(':memory:');
});

// A minimal closed-trade object carrying the fields tradeSignature() keys on.
const trade = (over = {}) => ({
  symbol: 'AAPL', side: 'LONG', openedAt: '2024-03-04T09:31:00.000Z',
  closedAt: '2024-03-04T14:00:00.000Z', quantity: 100, entryPrice: 170,
  exitPrice: 173, netPnl: 300, tags: [], riskAmount: 0, note: '', ...over,
});

describe('SqliteRepository — users & auth', () => {
  it('creates a user, hides the hash, and authenticates', () => {
    const u = repo.createUser('a@b.com', 'secret123');
    expect(u).toMatchObject({ email: 'a@b.com' });
    expect(u.passwordHash).toBeUndefined();
    expect(repo.authenticate('a@b.com', 'secret123').id).toBe(u.id);
    expect(() => repo.authenticate('a@b.com', 'wrong')).toThrow(/invalid credentials/);
  });

  it('rejects duplicates and bad input', () => {
    repo.createUser('dupe@b.com', 'secret123');
    expect(() => repo.createUser('dupe@b.com', 'secret123')).toThrow(/already registered/);
    expect(() => repo.createUser('bad', 'secret123')).toThrow(/invalid email/);
    expect(() => repo.createUser('x@b.com', '123')).toThrow(/at least 6/);
  });
});

describe('SqliteRepository — accounts & RLS', () => {
  it('creates, lists, updates, and deletes with cascade', () => {
    const u = repo.createUser('o@b.com', 'secret123');
    const a = repo.createAccount(u.id, { name: 'Main', startingBalance: 5000 });
    expect(repo.listAccounts(u.id)).toHaveLength(1);

    repo.updateAccount(u.id, a.id, { name: 'Renamed', startingBalance: 8000 });
    expect(repo.getAccount(u.id, a.id)).toMatchObject({ name: 'Renamed', startingBalance: 8000 });

    repo.saveImport(u.id, a.id, [{ symbol: 'AAPL' }], [trade()]);
    expect(repo.listTrades(u.id, a.id)).toHaveLength(1);
    repo.deleteAccount(u.id, a.id);
    expect(repo.listAccounts(u.id)).toHaveLength(0);
  });

  it('enforces RLS across users', () => {
    const alice = repo.createUser('alice@b.com', 'secret123');
    const bob = repo.createUser('bob@b.com', 'secret123');
    const a = repo.createAccount(alice.id, { name: 'A' });
    expect(() => repo.getAccount(bob.id, a.id)).toThrow(/not found/);
    expect(repo.listAccounts(bob.id)).toHaveLength(0);
    expect(() => repo.assertUser('nope')).toThrow(/unauthorized/);
  });
});

describe('SqliteRepository — import, durability, aggregation', () => {
  it('replaces on re-import but preserves durable tags/risk/notes by signature', () => {
    const u = repo.createUser('imp@b.com', 'secret123');
    const a = repo.createAccount(u.id, { name: 'A' });
    repo.saveImport(u.id, a.id, [], [trade()]);

    const [t] = repo.listTrades(u.id, a.id);
    repo.updateTradeTags(u.id, t.id, ['breakout', 'breakout']); // de-dupes
    repo.updateTradeRisk(u.id, t.id, 50);
    repo.updateTradeNote(u.id, t.id, 'clean A+');

    repo.updateTradeSetup(u.id, t.id, 'Opening Range Breakout');

    // Re-import the same trade (regenerates rows) — annotations must carry over.
    repo.saveImport(u.id, a.id, [], [trade()]);
    const [after] = repo.listTrades(u.id, a.id);
    expect(after.tags).toEqual(['breakout']);
    expect(after.riskAmount).toBe(50);
    expect(after.note).toBe('clean A+');
    expect(after.setup).toBe('Opening Range Breakout');
  });

  it('clears a setup and the cleared state survives re-import', () => {
    const u = repo.createUser('clearsetup@b.com', 'secret123');
    const a = repo.createAccount(u.id, { name: 'A' });
    repo.saveImport(u.id, a.id, [], [trade()]);
    let [t] = repo.listTrades(u.id, a.id);
    repo.updateTradeSetup(u.id, t.id, 'ORB');
    repo.updateTradeSetup(u.id, t.id, '   '); // clear
    repo.saveImport(u.id, a.id, [], [trade()]);
    [t] = repo.listTrades(u.id, a.id);
    expect(t.setup).toBe('');
  });

  it('lists trades sorted by closedAt and aggregates across accounts', () => {
    const u = repo.createUser('agg@b.com', 'secret123');
    const a1 = repo.createAccount(u.id, { name: 'A1' });
    const a2 = repo.createAccount(u.id, { name: 'A2' });
    repo.saveImport(u.id, a1.id, [], [trade({ symbol: 'AAPL', closedAt: '2024-03-04T14:00:00.000Z' })]);
    repo.saveImport(u.id, a2.id, [], [trade({ symbol: 'NVDA', closedAt: '2024-03-02T14:00:00.000Z' })]);
    const all = repo.listAllTrades(u.id);
    expect(all.map((t) => t.symbol)).toEqual(['NVDA', 'AAPL']); // oldest first
  });

  it('renames and removes tags across the account', () => {
    const u = repo.createUser('tags@b.com', 'secret123');
    const a = repo.createAccount(u.id, { name: 'A' });
    repo.saveImport(u.id, a.id, [], [trade()]);
    const [t] = repo.listTrades(u.id, a.id);
    repo.updateTradeTags(u.id, t.id, ['scalp']);
    repo.renameTag(u.id, a.id, 'scalp', 'momentum');
    expect(repo.listTrades(u.id, a.id)[0].tags).toEqual(['momentum']);
    repo.removeTag(u.id, a.id, 'momentum');
    expect(repo.listTrades(u.id, a.id)[0].tags).toEqual([]);
  });
});

describe('SqliteRepository — OAuth identities', () => {
  it('creates a password-less user and is idempotent per identity', () => {
    const u1 = repo.upsertOAuthUser({ provider: 'google', sub: 'g-1', email: 'New@B.com' });
    expect(u1.email).toBe('new@b.com');
    const u2 = repo.upsertOAuthUser({ provider: 'google', sub: 'g-1', email: 'new@b.com' });
    expect(u2.id).toBe(u1.id); // same identity → same user
    // The password-less user cannot be logged in with a password.
    expect(() => repo.authenticate('new@b.com', 'whatever')).toThrow(/invalid credentials/);
  });

  it('links a provider identity to an existing email account', () => {
    const pw = repo.createUser('linked@b.com', 'secret123');
    const oauthUser = repo.upsertOAuthUser({ provider: 'google', sub: 'g-2', email: 'linked@b.com' });
    expect(oauthUser.id).toBe(pw.id); // merged onto the existing account
  });

  it('rejects an unverified provider email', () => {
    expect(() => repo.upsertOAuthUser({ provider: 'apple', sub: 'a-1', email: 'x@b.com', emailVerified: false }))
      .toThrow(/not verified/);
  });
});

describe('SqliteRepository — daily notes', () => {
  it('upserts, clears, and lists noted days', () => {
    const u = repo.createUser('note@b.com', 'secret123');
    const a = repo.createAccount(u.id, { name: 'A' });
    repo.setDailyNote(u.id, a.id, '2024-03-04', 'held overnight');
    expect(repo.getDailyNote(u.id, a.id, '2024-03-04')).toBe('held overnight');
    expect(repo.listNotedDays(u.id, a.id)).toEqual(['2024-03-04']);
    repo.setDailyNote(u.id, a.id, '2024-03-04', '   ');
    expect(repo.listNotedDays(u.id, a.id)).toEqual([]);
  });
});

describe('SqliteRepository — subscription persistence', () => {
  it('round-trips subscription fields incl. cancelAtPeriodEnd, preserving unspecified ones', () => {
    const u = repo.createUser('sub@b.com', 'secret123');
    expect(repo.getSubscription(u.id)).toMatchObject({ subscriptionStatus: 'trialing', cancelAtPeriodEnd: false });

    repo.setSubscription(u.id, { subscriptionStatus: 'active', currentPeriodEnd: '2099-01-01T00:00:00.000Z', stripeCustomerId: 'cus_1' });
    repo.setSubscription(u.id, { cancelAtPeriodEnd: true }); // portal cancellation only touches this field
    const sub = repo.getSubscription(u.id);
    expect(sub).toMatchObject({
      subscriptionStatus: 'active',
      currentPeriodEnd: '2099-01-01T00:00:00.000Z',
      stripeCustomerId: 'cus_1',
      cancelAtPeriodEnd: true,
    });

    // Resuming clears the flag.
    repo.setSubscription(u.id, { cancelAtPeriodEnd: false });
    expect(repo.getSubscription(u.id).cancelAtPeriodEnd).toBe(false);
  });
});
