// Setup playbook: per-strategy performance. Each trade carries an optional
// single `setup` (e.g. "Opening Range Breakout"); this groups closed trades by
// setup and reports the stats that tell you which strategies actually have an
// edge — net P&L, win rate, profit factor, expectancy, and average R.

import { summarize, rMultiple } from './analytics.js';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const UNASSIGNED = 'Unassigned';

/** The trade's setup label, or the Unassigned bucket. */
export function setupKey(trade) {
  const s = trade.setup != null ? String(trade.setup).trim() : '';
  return s || UNASSIGNED;
}

/**
 * Group closed trades by setup and summarize each, sorted by net P&L desc with
 * the Unassigned bucket always last so real strategies lead the report.
 * @param {object[]} trades
 * @returns {{ setup, expectancy, avgR, rCount, ...summary }[]}
 */
export function buildPlaybook(trades) {
  const buckets = new Map();
  for (const t of trades) {
    const key = setupKey(t);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }

  const rows = [...buckets.entries()].map(([setup, group]) => {
    const s = summarize(group);
    const rs = group.map(rMultiple).filter((r) => r !== null);
    return {
      setup,
      ...s,
      expectancy: group.length ? round2(s.netPnl / group.length) : 0,
      avgR: rs.length ? round2(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
      rCount: rs.length,
    };
  });

  return rows.sort((a, b) => {
    if (a.setup === UNASSIGNED) return 1;
    if (b.setup === UNASSIGNED) return -1;
    return b.netPnl - a.netPnl;
  });
}

/** Distinct setup labels in use (excludes Unassigned), alphabetized. */
export function listSetups(trades) {
  const set = new Set();
  for (const t of trades) {
    const s = t.setup != null ? String(t.setup).trim() : '';
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
