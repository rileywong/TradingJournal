import { describe, it, expect } from 'vitest';
import { filterTrades, distinctSymbols, distinctTags } from '../core/filters.js';

const trades = [
  { symbol: 'AAPL', side: 'LONG', netPnl: 100, tags: ['Breakout'], closedAt: '2024-03-04T10:00:00' },
  { symbol: 'AAPL', side: 'SHORT', netPnl: -50, tags: [], closedAt: '2024-03-05T10:00:00' },
  { symbol: 'TSLA', side: 'LONG', netPnl: 0, tags: ['News'], closedAt: '2024-03-06T10:00:00' },
  { symbol: 'NVDA', side: 'LONG', netPnl: 200, tags: ['Breakout', 'News'], closedAt: '2024-03-10T10:00:00' },
];

describe('filterTrades', () => {
  it('returns everything with no criteria', () => {
    expect(filterTrades(trades)).toHaveLength(4);
  });

  it('filters by symbol (case-insensitive)', () => {
    expect(filterTrades(trades, { symbol: 'aapl' }).map((t) => t.symbol)).toEqual(['AAPL', 'AAPL']);
  });

  it('filters by side', () => {
    expect(filterTrades(trades, { side: 'short' })).toHaveLength(1);
  });

  it('filters by tag', () => {
    expect(filterTrades(trades, { tag: 'Breakout' }).map((t) => t.symbol)).toEqual(['AAPL', 'NVDA']);
  });

  it('filters by outcome', () => {
    expect(filterTrades(trades, { outcome: 'win' })).toHaveLength(2);
    expect(filterTrades(trades, { outcome: 'loss' })).toHaveLength(1);
    expect(filterTrades(trades, { outcome: 'breakeven' })).toHaveLength(1);
  });

  it('filters by an inclusive date range (by close day)', () => {
    const r = filterTrades(trades, { from: '2024-03-05', to: '2024-03-06' });
    expect(r.map((t) => t.symbol)).toEqual(['AAPL', 'TSLA']);
  });

  it('combines criteria with AND semantics', () => {
    const r = filterTrades(trades, { symbol: 'AAPL', outcome: 'win' });
    expect(r).toHaveLength(1);
    expect(r[0].netPnl).toBe(100);
  });
});

describe('distinctSymbols / distinctTags', () => {
  it('lists sorted distinct symbols', () => {
    expect(distinctSymbols(trades)).toEqual(['AAPL', 'NVDA', 'TSLA']);
  });
  it('lists sorted distinct tags', () => {
    expect(distinctTags(trades)).toEqual(['Breakout', 'News']);
  });
});
