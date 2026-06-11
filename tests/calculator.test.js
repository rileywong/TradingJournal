import { describe, it, expect } from 'vitest';
import { positionSize } from '../core/calculator.js';

describe('positionSize', () => {
  it('sizes a long by the risk budget and floors to whole shares', () => {
    // $25k account, risk 1% = $250; entry 100, stop 98 → $2/share → 125 shares.
    const r = positionSize({ accountSize: 25000, riskPct: 1, entry: 100, stop: 98 });
    expect(r.riskAmount).toBe(250);
    expect(r.riskPerShare).toBe(2);
    expect(r.shares).toBe(125);
    expect(r.positionValue).toBe(12500);
    expect(r.actualRisk).toBe(250);
  });

  it('floors fractional share counts and reports actual risk', () => {
    // $250 budget, $3/share → 83.33 → 83 shares; actual risk 83*3 = 249.
    const r = positionSize({ accountSize: 25000, riskPct: 1, entry: 50, stop: 47 });
    expect(r.shares).toBe(83);
    expect(r.actualRisk).toBe(249);
  });

  it('works for shorts (stop above entry)', () => {
    const r = positionSize({ accountSize: 10000, riskPct: 2, entry: 100, stop: 104 });
    expect(r.riskPerShare).toBe(4);
    expect(r.riskAmount).toBe(200);
    expect(r.shares).toBe(50);
  });

  it('computes reward:risk and target profit when a target is given', () => {
    const r = positionSize({ accountSize: 25000, riskPct: 1, entry: 100, stop: 98, target: 106 });
    expect(r.rMultiple).toBe(3);            // reward 6 / risk 2
    expect(r.targetProfit).toBe(750);       // 6 * 125 shares
  });

  it('rejects invalid input', () => {
    expect(positionSize({})).toBeNull();
    expect(positionSize({ accountSize: 0, riskPct: 1, entry: 100, stop: 98 })).toBeNull();
    expect(positionSize({ accountSize: 25000, riskPct: 1, entry: 100, stop: 100 })).toBeNull(); // entry === stop
    expect(positionSize({ accountSize: 25000, riskPct: -1, entry: 100, stop: 98 })).toBeNull();
    expect(positionSize({ accountSize: 25000, riskPct: 1, entry: 'x', stop: 98 })).toBeNull();
  });
});
