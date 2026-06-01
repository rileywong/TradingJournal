// Dashboard period presets → inclusive YYYY-MM-DD date ranges (by trade close
// day). Pure and date-injectable so it's testable; 'all' means no bounds.

import { dayKey } from './dates.js';

export const PERIODS = [
  { key: 'all', label: 'All time' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'mtd', label: 'Month to date' },
  { key: 'ytd', label: 'Year to date' },
];

const KEYS = new Set(PERIODS.map((p) => p.key));

/**
 * @param {string} key one of PERIODS' keys
 * @param {Date} [today] reference "now" (injectable for tests)
 * @returns {{ from: string, to: string }} inclusive bounds ('' = unbounded)
 */
export function periodRange(key, today = new Date()) {
  if (!KEYS.has(key) || key === 'all') return { from: '', to: '' };
  const to = dayKey(today);
  switch (key) {
    case '30d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 29); // inclusive 30-day window
      return { from: dayKey(d), to };
    }
    case 'mtd':
      return { from: dayKey(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    case 'ytd':
      return { from: dayKey(new Date(today.getFullYear(), 0, 1)), to };
    default:
      return { from: '', to: '' };
  }
}
