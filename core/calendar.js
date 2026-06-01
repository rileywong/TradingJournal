// Daily / monthly P&L aggregation for the calendar grid.

import { dayKey } from './dates.js';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Aggregate trades into per-day buckets keyed by YYYY-MM-DD.
 * @param {object[]} trades
 * @returns {Record<string, { date: string, pnl: number, trades: number, wins: number, losses: number }>}
 */
export function aggregateDaily(trades) {
  const days = {};
  for (const t of trades) {
    const key = dayKey(t.closedAt);
    if (!days[key]) {
      days[key] = { date: key, pnl: 0, trades: 0, wins: 0, losses: 0 };
    }
    const d = days[key];
    d.pnl = round2(d.pnl + t.netPnl);
    d.trades += 1;
    if (t.netPnl > 0) d.wins += 1;
    else if (t.netPnl < 0) d.losses += 1;
  }
  return days;
}

/**
 * Build a calendar matrix for a given month (Sun-first weeks).
 * @param {object[]} trades
 * @param {number} year e.g. 2024
 * @param {number} month 1-12
 * @returns {{ year, month, weeks: (null|{date,day,pnl,trades,wins,losses})[][], monthlyPnl, tradingDays }}
 */
export function buildMonthlyCalendar(trades, year, month) {
  const daily = aggregateDaily(trades);
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  // leading blanks
  for (let i = 0; i < startWeekday; i++) cells.push(null);

  let monthlyPnl = 0;
  let tradingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const d = daily[key];
    if (d) {
      monthlyPnl = round2(monthlyPnl + d.pnl);
      tradingDays += 1;
      cells.push({ date: key, day, pnl: d.pnl, trades: d.trades, wins: d.wins, losses: d.losses });
    } else {
      cells.push({ date: key, day, pnl: 0, trades: 0, wins: 0, losses: 0 });
    }
  }
  // trailing blanks to complete the final week
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return { year, month, weeks, monthlyPnl, tradingDays };
}
