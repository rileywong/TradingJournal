import { describe, it, expect, beforeEach } from 'vitest';
import { Repository, RepoError } from '../core/repository.js';

let repo;
let userId;
let accountId;

beforeEach(() => {
  repo = new Repository();
  userId = repo.createUser('acct@example.com', 'secret123').id;
  accountId = repo.createAccount(userId, { name: 'Main', startingBalance: 10000 }).id;
});

describe('updateAccount', () => {
  it('updates name, starting balance, and commission', () => {
    const a = repo.updateAccount(userId, accountId, {
      name: 'Renamed', startingBalance: 25000, commissionPerTrade: 1.5,
    });
    expect(a.name).toBe('Renamed');
    expect(a.startingBalance).toBe(25000);
    expect(a.commissionPerTrade).toBe(1.5);
  });

  it('keeps unspecified fields and ignores a blank name', () => {
    repo.updateAccount(userId, accountId, { startingBalance: 5000 });
    let a = repo.getAccount(userId, accountId);
    expect(a.name).toBe('Main'); // unchanged
    expect(a.startingBalance).toBe(5000);
    repo.updateAccount(userId, accountId, { name: '   ' });
    a = repo.getAccount(userId, accountId);
    expect(a.name).toBe('Main'); // blank ignored
  });

  it('enforces RLS', () => {
    const other = repo.createUser('other@example.com', 'secret123');
    expect(() => repo.updateAccount(other.id, accountId, { name: 'X' })).toThrow(RepoError);
  });
});

describe('tag management', () => {
  beforeEach(() => {
    // two distinct trades, tagged
    repo.saveImport(userId, accountId, [], [
      { symbol: 'AAPL', side: 'LONG', quantity: 100, entryPrice: 1, exitPrice: 2, openedAt: '2024-03-04T10:00:00Z', closedAt: '2024-03-04T11:00:00Z', netPnl: 10, grossPnl: 10, tags: [] },
      { symbol: 'TSLA', side: 'LONG', quantity: 50, entryPrice: 1, exitPrice: 2, openedAt: '2024-03-05T10:00:00Z', closedAt: '2024-03-05T11:00:00Z', netPnl: 20, grossPnl: 20, tags: [] },
    ]);
    const trades = repo.listTrades(userId, accountId);
    repo.updateTradeTags(userId, trades[0].id, ['Breakout', 'News']);
    repo.updateTradeTags(userId, trades[1].id, ['Breakout']);
  });

  it('renames a tag across all trades and de-dupes', () => {
    const r = repo.renameTag(userId, accountId, 'Breakout', 'News'); // News already on trade 0
    expect(r.affected).toBe(2);
    const trades = repo.listTrades(userId, accountId);
    expect(trades[0].tags).toEqual(['News']); // Breakout→News merged with existing News
    expect(trades[1].tags).toEqual(['News']);
  });

  it('removes a tag from all trades', () => {
    const r = repo.removeTag(userId, accountId, 'Breakout');
    expect(r.affected).toBe(2);
    const trades = repo.listTrades(userId, accountId);
    expect(trades[0].tags).toEqual(['News']);
    expect(trades[1].tags).toEqual([]);
  });

  it('persists a rename across a re-import (durable store updated)', () => {
    repo.renameTag(userId, accountId, 'Breakout', 'Momentum');
    // re-import the same two trades
    repo.saveImport(userId, accountId, [], [
      { symbol: 'AAPL', side: 'LONG', quantity: 100, entryPrice: 1, exitPrice: 2, openedAt: '2024-03-04T10:00:00Z', closedAt: '2024-03-04T11:00:00Z', netPnl: 10, grossPnl: 10, tags: [] },
      { symbol: 'TSLA', side: 'LONG', quantity: 50, entryPrice: 1, exitPrice: 2, openedAt: '2024-03-05T10:00:00Z', closedAt: '2024-03-05T11:00:00Z', netPnl: 20, grossPnl: 20, tags: [] },
    ]);
    const trades = repo.listTrades(userId, accountId);
    expect(trades.find((t) => t.symbol === 'TSLA').tags).toContain('Momentum');
  });

  it('validates inputs and enforces RLS', () => {
    expect(() => repo.renameTag(userId, accountId, '', 'X')).toThrow(RepoError);
    expect(() => repo.removeTag(userId, accountId, '  ')).toThrow(RepoError);
    const other = repo.createUser('tagintruder@example.com', 'secret123');
    expect(() => repo.renameTag(other.id, accountId, 'Breakout', 'X')).toThrow(RepoError);
  });
});

describe('deleteAccount', () => {
  it('removes the account and cascades to its data', () => {
    // seed trades, a note, and a tag
    const trades = [
      { symbol: 'AAPL', side: 'LONG', quantity: 100, entryPrice: 1, exitPrice: 2,
        openedAt: '2024-03-04T10:00:00Z', closedAt: '2024-03-04T11:00:00Z', netPnl: 100, tags: [] },
    ];
    repo.saveImport(userId, accountId, [{ symbol: 'AAPL', action: 'BUY', quantity: 100, price: 1, executedAt: '2024-03-04T10:00:00Z' }], trades);
    const tradeId = repo.listTrades(userId, accountId)[0].id;
    repo.updateTradeTags(userId, tradeId, ['Breakout']);
    repo.setDailyNote(userId, accountId, '2024-03-04', 'note');

    repo.deleteAccount(userId, accountId);

    expect(() => repo.getAccount(userId, accountId)).toThrow(RepoError);
    expect(repo.listAccounts(userId)).toHaveLength(0);
    expect([...repo.trades.values()].filter((t) => t.accountId === accountId)).toHaveLength(0);
    expect([...repo.executions.values()].filter((e) => e.accountId === accountId)).toHaveLength(0);
    expect([...repo.dailyNotes.keys()].some((k) => k.startsWith(`${accountId}::`))).toBe(false);
    expect([...repo.tradeTags.keys()].some((k) => k.startsWith(`${accountId}::`))).toBe(false);
  });

  it('only deletes the targeted account, not siblings', () => {
    const other = repo.createAccount(userId, { name: 'Other' }).id;
    repo.deleteAccount(userId, accountId);
    expect(repo.listAccounts(userId).map((a) => a.id)).toEqual([other]);
  });

  it('enforces RLS', () => {
    const intruder = repo.createUser('intruder@example.com', 'secret123');
    expect(() => repo.deleteAccount(intruder.id, accountId)).toThrow(RepoError);
    expect(repo.getAccount(userId, accountId)).toBeTruthy(); // still there
  });
});
