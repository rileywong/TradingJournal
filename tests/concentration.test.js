import { describe, it, expect } from 'vitest';
import { profitConcentration } from '../core/analytics.js';

const t = (netPnl, closedAt) => ({ netPnl, closedAt });

describe('profitConcentration', () => {
  it('returns nulls when there is no gross profit', () => {
    expect(profitConcentration([t(-10, '2024-01-01')])).toEqual({ topTradePct: null, topDayPct: null });
    expect(profitConcentration([])).toEqual({ topTradePct: null, topDayPct: null });
  });

  it('computes the best trade and best day share of gross profit', () => {
    const trades = [
      t(100, '2024-01-01T10:00:00'),
      t(300, '2024-01-02T10:00:00'), // best trade
      t(100, '2024-01-02T14:00:00'), // same day as best trade → best day = 400
      t(-50, '2024-01-03T10:00:00'),
    ];
    const c = profitConcentration(trades);
    // gross profit = 100+300+100 = 500; best trade 300 → 0.6; best day (Jan 2) 400 → 0.8
    expect(c.topTradePct).toBeCloseTo(0.6, 5);
    expect(c.topDayPct).toBeCloseTo(0.8, 5);
  });
});

import { topTrades } from '../core/analytics.js';

describe('topTrades', () => {
  const mk = (sym, pnl, day) => ({ symbol: sym, netPnl: pnl, closedAt: `2024-01-${day}T15:00:00` });
  it('returns biggest winners and losers by net P&L', () => {
    const trades = [mk('A', 500, '01'), mk('B', -300, '02'), mk('C', 120, '03'), mk('D', -50, '04'), mk('E', 900, '05')];
    const { best, worst } = topTrades(trades, 2);
    expect(best.map((t) => t.symbol)).toEqual(['E', 'A']);    // 900, 500
    expect(worst.map((t) => t.symbol)).toEqual(['B', 'D']);   // -300, -50
  });
  it('does not show the same trade in both lists when trades are few', () => {
    const trades = [mk('A', 100, '01'), mk('B', -100, '02')];
    const { best, worst } = topTrades(trades, 5);
    const overlap = best.filter((t) => worst.includes(t));
    expect(overlap).toHaveLength(0);
  });
});
