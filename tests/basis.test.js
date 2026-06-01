import { describe, it, expect } from 'vitest';
import { projectBasis, normalizeBasis } from '../core/basis.js';

describe('normalizeBasis', () => {
  it('only accepts "gross", everything else is "net"', () => {
    expect(normalizeBasis('gross')).toBe('gross');
    expect(normalizeBasis('net')).toBe('net');
    expect(normalizeBasis(undefined)).toBe('net');
    expect(normalizeBasis('NET')).toBe('net');
  });
});

describe('projectBasis', () => {
  const trades = [
    { netPnl: 298, grossPnl: 300 },
    { netPnl: 149, grossPnl: 150 },
  ];

  it('returns trades unchanged for net', () => {
    expect(projectBasis(trades, 'net')).toBe(trades);
  });

  it('projects netPnl onto grossPnl for gross (non-mutating)', () => {
    const g = projectBasis(trades, 'gross');
    expect(g.map((t) => t.netPnl)).toEqual([300, 150]);
    // originals untouched
    expect(trades[0].netPnl).toBe(298);
  });

  it('falls back to netPnl when grossPnl is missing', () => {
    expect(projectBasis([{ netPnl: 10 }], 'gross')[0].netPnl).toBe(10);
  });
});
