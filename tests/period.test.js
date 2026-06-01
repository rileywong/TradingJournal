import { describe, it, expect } from 'vitest';
import { periodRange, PERIODS } from '../core/period.js';

// Fixed reference date: Wednesday, 2024-03-13 (local).
const TODAY = new Date(2024, 2, 13, 12, 0, 0);

describe('periodRange', () => {
  it('returns unbounded for "all" or an unknown key', () => {
    expect(periodRange('all', TODAY)).toEqual({ from: '', to: '' });
    expect(periodRange('bogus', TODAY)).toEqual({ from: '', to: '' });
  });

  it('computes an inclusive 30-day window', () => {
    // 29 days before Mar 13 is Feb 13.
    expect(periodRange('30d', TODAY)).toEqual({ from: '2024-02-13', to: '2024-03-13' });
  });

  it('computes month-to-date', () => {
    expect(periodRange('mtd', TODAY)).toEqual({ from: '2024-03-01', to: '2024-03-13' });
  });

  it('computes year-to-date', () => {
    expect(periodRange('ytd', TODAY)).toEqual({ from: '2024-01-01', to: '2024-03-13' });
  });

  it('exposes the preset list', () => {
    expect(PERIODS.map((p) => p.key)).toEqual(['all', '30d', 'mtd', 'ytd']);
  });
});
