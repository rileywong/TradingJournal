import { describe, it, expect } from 'vitest';
import {
  tradesForDay,
  dailyStats,
  dailyCumulativePnl,
  isValidDateKey,
} from '../core/day.js';

function trade(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    symbol: over.symbol || 'AAPL',
    side: over.side || 'LONG',
    quantity: over.quantity ?? 100,
    entryPrice: over.entryPrice ?? 10,
    exitPrice: over.exitPrice ?? 11,
    netPnl: over.netPnl ?? 0,
    commission: over.commission ?? 0,
    closedAt: over.closedAt,
  };
}

describe('isValidDateKey', () => {
  it('accepts YYYY-MM-DD and rejects everything else', () => {
    expect(isValidDateKey('2024-03-04')).toBe(true);
    expect(isValidDateKey('2024-3-4')).toBe(false);
    expect(isValidDateKey('03/04/2024')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey(undefined)).toBe(false);
    expect(isValidDateKey(20240304)).toBe(false);
  });
});

describe('tradesForDay', () => {
  const trades = [
    trade({ id: 'a', netPnl: 100, closedAt: '2024-03-04T15:00:00' }),
    trade({ id: 'b', netPnl: -40, closedAt: '2024-03-04T10:00:00' }),
    trade({ id: 'c', netPnl: 200, closedAt: '2024-03-05T11:00:00' }),
  ];

  it('returns only the requested day, oldest-first', () => {
    const day = tradesForDay(trades, '2024-03-04');
    expect(day.map((t) => t.id)).toEqual(['b', 'a']); // sorted by close time
  });

  it('returns an empty array for a day with no trades', () => {
    expect(tradesForDay(trades, '2024-03-06')).toEqual([]);
  });
});

describe('dailyStats', () => {
  const trades = [
    trade({ symbol: 'AAPL', netPnl: 100, commission: 1, quantity: 100, closedAt: '2024-03-04T10:00:00' }),
    trade({ symbol: 'TSLA', netPnl: -40, commission: 2, quantity: 50, closedAt: '2024-03-04T15:00:00' }),
    trade({ symbol: 'NVDA', netPnl: 200, commission: 1, quantity: 10, closedAt: '2024-03-05T11:00:00' }),
  ];

  it('computes the TradeZella-style snapshot for one day', () => {
    const s = dailyStats(trades, '2024-03-04');
    expect(s.date).toBe('2024-03-04');
    expect(s.netPnl).toBe(60);
    expect(s.totalTrades).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(0.5);
    expect(s.commissions).toBe(3);
    expect(s.volume).toBe(150);
  });

  it('identifies the best and worst symbol of the day', () => {
    const s = dailyStats(trades, '2024-03-04');
    expect(s.bestSymbol).toEqual({ symbol: 'AAPL', netPnl: 100 });
    expect(s.worstSymbol).toEqual({ symbol: 'TSLA', netPnl: -40 });
  });

  it('is total (defined) for a day with no trades', () => {
    const s = dailyStats(trades, '2024-03-09');
    expect(s.netPnl).toBe(0);
    expect(s.totalTrades).toBe(0);
    expect(s.commissions).toBe(0);
    expect(s.volume).toBe(0);
    expect(s.bestSymbol).toBeNull();
    expect(s.worstSymbol).toBeNull();
  });
});

describe('dailyCumulativePnl', () => {
  it('produces a running total in chart-series form (unix-seconds time)', () => {
    const trades = [
      trade({ id: 'a', symbol: 'AAPL', netPnl: 100, closedAt: '2024-03-04T10:00:00Z' }),
      trade({ id: 'b', symbol: 'TSLA', netPnl: -30, closedAt: '2024-03-04T11:00:00Z' }),
      trade({ id: 'c', symbol: 'NVDA', netPnl: 50, closedAt: '2024-03-04T12:00:00Z' }),
    ];
    const series = dailyCumulativePnl(trades, '2024-03-04');
    expect(series.map((p) => p.value)).toEqual([100, 70, 120]);
    expect(series[0].time).toBe(Math.floor(Date.UTC(2024, 2, 4, 10) / 1000));
    expect(series[0]).toMatchObject({ tradeId: 'a', symbol: 'AAPL' });
    // Strictly ascending time keeps the chart library happy.
    for (let i = 1; i < series.length; i++) {
      expect(series[i].time).toBeGreaterThan(series[i - 1].time);
    }
  });

  it('returns an empty series for an empty day', () => {
    expect(dailyCumulativePnl([], '2024-03-04')).toEqual([]);
  });
});
