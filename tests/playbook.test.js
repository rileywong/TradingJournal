import { describe, it, expect } from 'vitest';
import { buildPlaybook, listSetups, setupKey, UNASSIGNED } from '../core/playbook.js';

const t = (over = {}) => ({
  symbol: 'AAPL', side: 'LONG', netPnl: 0, riskAmount: 0,
  openedAt: '2024-03-04T09:31:00.000Z', closedAt: '2024-03-04T14:00:00.000Z', ...over,
});

describe('setupKey', () => {
  it('falls back to Unassigned for missing/blank setups', () => {
    expect(setupKey(t({ setup: 'ORB' }))).toBe('ORB');
    expect(setupKey(t({ setup: '  ' }))).toBe(UNASSIGNED);
    expect(setupKey(t({}))).toBe(UNASSIGNED);
  });
});

describe('buildPlaybook', () => {
  it('groups by setup with per-strategy stats and Unassigned last', () => {
    const trades = [
      t({ setup: 'ORB', netPnl: 300, riskAmount: 100 }),   // +3R
      t({ setup: 'ORB', netPnl: -100, riskAmount: 100 }),  // -1R
      t({ setup: 'VWAP', netPnl: 50 }),
      t({ netPnl: -20 }),                                  // Unassigned
    ];
    const pb = buildPlaybook(trades);
    expect(pb.map((r) => r.setup)).toEqual(['ORB', 'VWAP', UNASSIGNED]);

    const orb = pb[0];
    expect(orb).toMatchObject({ trades: 2, wins: 1, losses: 1, netPnl: 200 });
    expect(orb.winRate).toBe(0.5);
    expect(orb.expectancy).toBe(100); // 200 / 2
    expect(orb.avgR).toBe(1); // (3 + -1) / 2
    expect(orb.rCount).toBe(2);

    const vwap = pb[1];
    expect(vwap.avgR).toBeNull(); // no risk set
    expect(vwap.rCount).toBe(0);
  });

  it('returns an empty array for no trades', () => {
    expect(buildPlaybook([])).toEqual([]);
  });
});

describe('listSetups', () => {
  it('returns distinct non-blank setups, alphabetized', () => {
    const trades = [t({ setup: 'VWAP' }), t({ setup: 'ORB' }), t({ setup: 'VWAP' }), t({ setup: '' })];
    expect(listSetups(trades)).toEqual(['ORB', 'VWAP']);
  });
});
