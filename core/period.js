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

const isDayKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Effective range for a period selection. For the special 'custom' period, use
 * the provided {from,to} (validated; reversed bounds swapped; invalid → ''),
 * otherwise fall back to the presets.
 */
export function resolveRange(period, custom = {}, today = new Date()) {
  if (period === 'custom') {
    let from = isDayKey(custom.from) ? custom.from : '';
    let to = isDayKey(custom.to) ? custom.to : '';
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  return periodRange(period, today);
}

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
