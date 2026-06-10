import { describe, it, expect } from 'vitest';
import { demoCsv } from '../core/demo-data.js';
import { parseExecutions } from '../core/parser.js';
import { matchTrades } from '../core/matcher.js';

const NOW = Date.parse('2024-06-01T00:00:00Z');

describe('demoCsv', () => {
  it('is deterministic for a fixed seed + now', () => {
    expect(demoCsv({ now: NOW, seed: 1 })).toBe(demoCsv({ now: NOW, seed: 1 }));
  });

  it('parses cleanly and matches into a realistic set of closed trades', () => {
    const csv = demoCsv({ now: NOW });
    const { executions, errors } = parseExecutions(csv, {});
    expect(errors).toHaveLength(0);
    expect(executions.length).toBeGreaterThan(40);

    const { trades, open } = matchTrades(executions, { accountId: 'a', commissionPerTrade: 0 });
    expect(open).toHaveLength(0); // every position is opened and closed same day
    expect(trades.length).toBeGreaterThan(20);

    // A believable mix: both winners and losers, both long and short.
    const wins = trades.filter((t) => t.netPnl > 0).length;
    const losses = trades.filter((t) => t.netPnl < 0).length;
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
    expect(new Set(trades.map((t) => t.side))).toEqual(new Set(['LONG', 'SHORT']));
    // Weekdays only.
    expect(trades.every((t) => ![0, 6].includes(new Date(t.closedAt).getDay()))).toBe(true);
  });

  it('spans the requested window ending at now', () => {
    const csv = demoCsv({ now: NOW, weeks: 4 });
    const { executions } = parseExecutions(csv, {});
    const times = executions.map((e) => new Date(e.executedAt).getTime());
    const earliest = Math.min(...times);
    expect(NOW - earliest).toBeLessThanOrEqual(4 * 7 * 86_400_000 + 86_400_000);
  });
});
