import { describe, it, expect } from 'vitest';
import { computeMetrics, computeMaxDrawdown, equityCurve, drawdownSeries } from '../core/metrics.js';

function trade(netPnl, closedAt = '2024-03-04T14:00:00Z') {
  return { netPnl, closedAt };
}

describe('drawdownSeries', () => {
  it('returns an empty series for no trades', () => {
    expect(drawdownSeries([])).toEqual([]);
  });

  it('tracks the underwater distance below the running peak', () => {
    const s = drawdownSeries(
      [
        trade(100, '2024-03-01T10:00:00Z'), // equity 10100, peak 10100, dd 0
        trade(-300, '2024-03-02T10:00:00Z'), // equity 9800, peak 10100, dd -300
        trade(50, '2024-03-03T10:00:00Z'), // equity 9850, dd -250
        trade(400, '2024-03-04T10:00:00Z'), // equity 10250, new peak, dd 0
      ],
      10000
    );
    expect(s.map((p) => p.drawdown)).toEqual([0, -300, -250, 0]);
    // Drawdowns are never positive.
    expect(s.every((p) => p.drawdown <= 0)).toBe(true);
    // % matches abs against the peak at the trough.
    expect(s[1].drawdownPct).toBeCloseTo(-300 / 10100, 4);
  });
});

describe('computeMetrics', () => {
  it('returns zeroed metrics for no trades', () => {
    const m = computeMetrics([]);
    expect(m.totalTrades).toBe(0);
    expect(m.netPnl).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(m.expectancy).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
  });

  it('computes core stats for a mixed book', () => {
    const m = computeMetrics([
      trade(300, '2024-03-04T14:00:00Z'),
      trade(-100, '2024-03-05T14:00:00Z'),
      trade(200, '2024-03-06T14:00:00Z'),
      trade(-50, '2024-03-07T14:00:00Z'),
    ]);
    expect(m.totalTrades).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(2);
    expect(m.netPnl).toBe(350);
    expect(m.grossProfit).toBe(500);
    expect(m.grossLoss).toBe(150);
    expect(m.winRate).toBe(0.5);
    expect(m.avgWin).toBe(250);
    expect(m.avgLoss).toBe(75);
    expect(m.profitFactor).toBeCloseTo(500 / 150, 2);
    // expectancy = 0.5*250 - 0.5*75 = 125 - 37.5 = 87.5
    expect(m.expectancy).toBe(87.5);
  });

  it('returns Infinity profit factor when there are zero losses', () => {
    const m = computeMetrics([trade(100), trade(50)]);
    expect(m.profitFactor).toBe(Infinity);
    expect(m.winRate).toBe(1);
    expect(m.avgLoss).toBe(0);
  });

  it('returns 0 profit factor when there are zero wins', () => {
    const m = computeMetrics([trade(-100), trade(-50)]);
    expect(m.profitFactor).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.grossProfit).toBe(0);
  });

  it('counts breakeven trades separately (not win/loss)', () => {
    const m = computeMetrics([trade(0), trade(100), trade(-100)]);
    expect(m.breakeven).toBe(1);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.totalTrades).toBe(3);
    // winRate is wins/total = 1/3
    expect(m.winRate).toBeCloseTo(1 / 3, 4);
  });
});

describe('computeMaxDrawdown', () => {
  it('is zero for an always-rising curve', () => {
    const dd = computeMaxDrawdown([trade(100, '2024-01-01'), trade(100, '2024-01-02')], 1000);
    expect(dd.maxDrawdownAbs).toBe(0);
    expect(dd.maxDrawdownPct).toBe(0);
  });

  it('captures the largest peak-to-trough drop', () => {
    // start 1000 → 1500 (peak) → 1200 → 1400 → 900 (trough from 1500)
    const trades = [
      trade(500, '2024-01-01'), // 1500
      trade(-300, '2024-01-02'), // 1200
      trade(200, '2024-01-03'), // 1400
      trade(-500, '2024-01-04'), // 900
    ];
    const dd = computeMaxDrawdown(trades, 1000);
    // max drop = 1500 - 900 = 600 → 600/1500 = 0.4
    expect(dd.maxDrawdownAbs).toBe(600);
    expect(dd.maxDrawdownPct).toBe(0.4);
  });

  it('orders by close time before measuring', () => {
    const trades = [
      trade(-500, '2024-01-04'),
      trade(500, '2024-01-01'),
      trade(-300, '2024-01-02'),
      trade(200, '2024-01-03'),
    ];
    const dd = computeMaxDrawdown(trades, 1000);
    expect(dd.maxDrawdownAbs).toBe(600);
  });
});

describe('equityCurve', () => {
  it('produces a cumulative curve seeded by starting balance', () => {
    const curve = equityCurve([trade(100, '2024-01-01'), trade(-40, '2024-01-02')], 1000);
    expect(curve.map((p) => p.equity)).toEqual([1100, 1060]);
  });
});
