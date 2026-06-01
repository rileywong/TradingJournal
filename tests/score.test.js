import { describe, it, expect } from 'vitest';
import { computeScore } from '../core/score.js';

function trade(netPnl, closedAt, over = {}) {
  return { netPnl, closedAt, openedAt: closedAt, symbol: over.symbol || 'AAPL', side: over.side || 'LONG', quantity: 100, ...over };
}

describe('computeScore', () => {
  it('returns a neutral N/A card for no trades', () => {
    const s = computeScore([]);
    expect(s.score).toBe(0);
    expect(s.grade).toBe('N/A');
    expect(s.components).toHaveLength(5);
    expect(s.components.every((c) => c.score === 0)).toBe(true);
  });

  it('produces a 0–100 score with a weighted breakdown', () => {
    const trades = [
      trade(120, '2024-03-04T10:00:00'),
      trade(90, '2024-03-05T10:00:00'),
      trade(-40, '2024-03-06T10:00:00'),
      trade(110, '2024-03-07T10:00:00'),
      trade(-30, '2024-03-08T10:00:00'),
    ];
    const s = computeScore(trades);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThanOrEqual(100);
    // Component weights sum to 1.0
    const totalWeight = s.components.reduce((a, c) => a + c.weight, 0);
    expect(Math.abs(totalWeight - 1)).toBeLessThan(1e-9);
    // Each component score is within range
    expect(s.components.every((c) => c.score >= 0 && c.score <= 100)).toBe(true);
    // Score equals the weighted sum (rounded)
    const expected = Math.round(s.components.reduce((a, c) => a + c.score * c.weight, 0));
    expect(s.score).toBe(expected);
  });

  it('scores an all-winning, well-spread book very highly', () => {
    const trades = [
      trade(100, '2024-03-04T10:00:00'),
      trade(100, '2024-03-05T10:00:00'),
      trade(100, '2024-03-06T10:00:00'),
      trade(100, '2024-03-07T10:00:00'),
    ];
    const s = computeScore(trades);
    // No losses → PF & win/loss components max out; even days → high consistency
    expect(s.score).toBeGreaterThanOrEqual(80);
    expect(['A', 'A+']).toContain(s.grade);
  });

  it('scores a mostly-losing book poorly', () => {
    const trades = [
      trade(-100, '2024-03-04T10:00:00'),
      trade(-80, '2024-03-05T10:00:00'),
      trade(20, '2024-03-06T10:00:00'),
      trade(-60, '2024-03-07T10:00:00'),
    ];
    const s = computeScore(trades);
    expect(s.score).toBeLessThan(40);
  });

  it('penalizes consistency when one day carries all the profit', () => {
    const concentrated = [
      trade(500, '2024-03-04T10:00:00'),
      trade(5, '2024-03-05T10:00:00'),
    ];
    const spread = [
      trade(250, '2024-03-04T10:00:00'),
      trade(255, '2024-03-05T10:00:00'),
    ];
    const cConc = computeScore(concentrated).components.find((c) => c.key === 'consistency').score;
    const cSpread = computeScore(spread).components.find((c) => c.key === 'consistency').score;
    expect(cSpread).toBeGreaterThan(cConc);
  });
});
