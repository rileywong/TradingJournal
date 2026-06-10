import { describe, it, expect } from 'vitest';
import { dailyStats, kelly, dailySharpe, buildStatistics } from '../core/statistics.js';

// Helper: a closed trade on a given local day with a given P&L.
const t = (date, netPnl, over = {}) => ({
  symbol: 'AAPL', side: 'LONG',
  openedAt: `${date}T09:30:00`, closedAt: `${date}T10:00:00`,
  quantity: 100, netPnl, commission: 1, ...over,
});

describe('dailyStats', () => {
  it('aggregates trades into days and reports green/red/best/worst', () => {
    const trades = [
      t('2024-03-04', 100), t('2024-03-04', -30), // day +70 (green)
      t('2024-03-05', -50),                        // day -50 (red)
      t('2024-03-06', 200),                        // day +200 (green, best)
      t('2024-03-07', 0),                          // day 0 (breakeven)
    ];
    const d = dailyStats(trades);
    expect(d.tradingDays).toBe(4);
    expect(d.greenDays).toBe(2);
    expect(d.redDays).toBe(1);
    expect(d.breakevenDays).toBe(1);
    expect(d.dayWinRate).toBe(0.5);
    expect(d.bestDay).toEqual({ date: '2024-03-06', pnl: 200 });
    expect(d.worstDay).toEqual({ date: '2024-03-05', pnl: -50 });
    expect(d.avgTradesPerDay).toBe(1.25); // 5 trades / 4 days
    expect(d.avgDailyPnl).toBe(55); // (70 - 50 + 200 + 0) / 4
  });

  it('tracks consecutive green / red day streaks chronologically', () => {
    const trades = [
      t('2024-03-04', 10), t('2024-03-05', 10), t('2024-03-06', 10), // 3 green
      t('2024-03-07', -10), t('2024-03-08', -10),                     // 2 red
      t('2024-03-11', 10),
    ];
    const d = dailyStats(trades);
    expect(d.maxGreenStreak).toBe(3);
    expect(d.maxRedStreak).toBe(2);
  });

  it('is total for an empty trade set', () => {
    expect(dailyStats([])).toMatchObject({ tradingDays: 0, greenDays: 0, bestDay: null, worstDay: null, dayWinRate: 0 });
  });
});

describe('kelly', () => {
  it('computes f* = W − (1 − W) / R', () => {
    // W=0.6, R=2 → 0.6 - 0.4/2 = 0.4
    expect(kelly(0.6, 2)).toEqual({ fraction: 0.4, clamped: 0.4 });
  });

  it('clamps a negative edge to 0 (do not bet) but reports the raw value', () => {
    // W=0.4, R=1 → 0.4 - 0.6 = -0.2
    const k = kelly(0.4, 1);
    expect(k.fraction).toBe(-0.2);
    expect(k.clamped).toBe(0);
  });

  it('returns zero when the payoff ratio is non-positive / infinite-not-finite', () => {
    expect(kelly(0.5, 0)).toEqual({ fraction: 0, clamped: 0 });
    expect(kelly(0.5, Infinity)).toEqual({ fraction: 0, clamped: 0 });
  });
});

describe('dailySharpe', () => {
  it('is mean(daily P&L) / std(daily P&L)', () => {
    // daily series: +100, +100, +100 → std 0 → 0 (no variance)
    expect(dailySharpe([t('2024-03-04', 100), t('2024-03-05', 100), t('2024-03-06', 100)])).toBe(0);
    // series: 0 and 200 → mean 100, std 100 → 1.0
    expect(dailySharpe([t('2024-03-04', 0), t('2024-03-05', 200)])).toBe(1);
  });

  it('needs at least two trading days', () => {
    expect(dailySharpe([t('2024-03-04', 100)])).toBe(0);
    expect(dailySharpe([])).toBe(0);
  });
});

describe('buildStatistics', () => {
  it('assembles payoff, expectancy, kelly, sharpe, and trade economics', () => {
    const trades = [
      t('2024-03-04', 200, { quantity: 100, commission: 2 }),
      t('2024-03-05', -100, { quantity: 50, commission: 1 }),
      t('2024-03-06', 100, { quantity: 100, commission: 2 }),
    ];
    const s = buildStatistics(trades);
    expect(s.avgWin).toBe(150);   // (200+100)/2
    expect(s.avgLoss).toBe(100);  // 100/1
    expect(s.payoffRatio).toBe(1.5); // 150/100
    // expectancy = (2/3)*150 - (1/3)*100 = 100 - 33.33 = 66.67
    expect(s.expectancy).toBeCloseTo(66.67, 1);
    expect(s.totalCommissions).toBe(5);
    expect(s.totalVolume).toBe(250);
    expect(s.avgPositionSize).toBeCloseTo(83.33, 1);
    expect(s.daily.tradingDays).toBe(3);
    expect(s.kelly).toHaveProperty('clamped');
  });

  it('reports null payoff ratio when there are no losses yet', () => {
    const s = buildStatistics([t('2024-03-04', 100), t('2024-03-05', 50)]);
    expect(s.payoffRatio).toBeNull();
  });

  it('is total for an empty set', () => {
    const s = buildStatistics([]);
    expect(s).toMatchObject({ expectancy: 0, avgWin: 0, avgLoss: 0, totalCommissions: 0, totalVolume: 0 });
    expect(s.daily.tradingDays).toBe(0);
  });
});
