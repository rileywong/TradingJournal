import { describe, it, expect } from 'vitest';
import { buildInsights } from '../core/insights.js';

const bucket = (key, over) => ({ key, trades: 10, wins: 6, losses: 4, netPnl: 0, winRate: 0.6, profitFactor: 1.5, avgWin: 0, avgLoss: 0, ...over });

describe('buildInsights', () => {
  it('returns nothing without data', () => {
    expect(buildInsights(null)).toEqual([]);
    expect(buildInsights({})).toEqual([]);
  });

  it('skips buckets below the minimum trade count', () => {
    const analytics = {
      byDayOfWeek: [bucket('Monday', { trades: 3, netPnl: 999 }), bucket('Tuesday', { trades: 2, netPnl: -999 })],
    };
    expect(buildInsights(analytics)).toEqual([]);
  });

  it('flags the best and worst weekday', () => {
    const analytics = {
      byDayOfWeek: [
        bucket('Tuesday', { netPnl: 1200, winRate: 0.7 }),
        bucket('Friday', { netPnl: -800 }),
      ],
    };
    const ids = buildInsights(analytics).map((i) => i.id);
    expect(ids).toContain('best-day');
    expect(ids).toContain('worst-day');
    const best = buildInsights(analytics).find((i) => i.id === 'best-day');
    expect(best.tone).toBe('positive');
    expect(best.text).toMatch(/Tuesday/);
  });

  it('warns when average loss exceeds average win', () => {
    const analytics = {
      winLoss: { winners: { count: 5, avg: 100 }, losers: { count: 5, avg: -180 }, payoffRatio: 0.56 },
    };
    const ins = buildInsights(analytics);
    expect(ins.find((i) => i.id === 'payoff-low')).toBeTruthy();
    expect(ins.find((i) => i.id === 'payoff-low').tone).toBe('negative');
  });

  it('labels the best hour from byHourOfDay buckets (key is "HH:00")', () => {
    const analytics = {
      byHourOfDay: [
        { ...bucket('14:00', { netPnl: 900 }), hour: 14 },
        { ...bucket('09:00', { netPnl: 100 }), hour: 9 },
      ],
    };
    const hour = buildInsights(analytics).find((i) => i.id === 'best-hour');
    expect(hour).toBeTruthy();
    expect(hour.text).toContain('2pm');     // 14:00 → 2pm
    expect(hour.text).not.toMatch(/NaN/);
  });

  it('detects a losing streak and disposition bias', () => {
    const analytics = {
      streaks: { current: -4 },
      holdTime: { avgWinMinutes: 10, avgLossMinutes: 40, avgMinutes: 25 },
    };
    const ids = buildInsights(analytics).map((i) => i.id);
    expect(ids).toContain('streak-loss');
    expect(ids).toContain('hold-bias');
  });
});
