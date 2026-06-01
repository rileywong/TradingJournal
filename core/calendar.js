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

  // Per-week roll-up (TradeZella-style summary column beside the grid).
  const weekSummaries = weeks.map((week) => {
    let pnl = 0;
    let trades = 0;
    let days = 0;
    for (const cell of week) {
      if (!cell || cell.trades === 0) continue;
      pnl = round2(pnl + cell.pnl);
      trades += cell.trades;
      days += 1;
    }
    return { pnl, trades, tradingDays: days };
  });

  return { year, month, weeks, weekSummaries, monthlyPnl, tradingDays };
}

/**
 * GitHub-style year heatmap of daily P&L: columns are Sun-first weeks spanning
 * the whole year, rows are weekdays. Cells outside `year` are null. Returns
 * `maxAbs` for color scaling plus yearly totals.
 * @returns {{ year, weeks: (null|{date,month,pnl,trades})[][], yearlyPnl,
 *   tradingDays, maxAbs }}
 */
export function buildYearHeatmap(trades, year) {
  const daily = aggregateDaily(trades);
  const jan1 = new Date(year, 0, 1);
  const start = new Date(year, 0, 1 - jan1.getDay()); // Sunday on/before Jan 1
  const dec31 = new Date(year, 11, 31);

  const weeks = [];
  let col = [];
  let yearlyPnl = 0;
  let tradingDays = 0;
  let maxAbs = 0;

  for (const d = new Date(start); d <= dec31 || col.length > 0; d.setDate(d.getDate() + 1)) {
    if (d.getFullYear() !== year) {
      col.push(null);
    } else {
      const key = dayKey(d);
      const agg = daily[key];
      const pnl = agg ? agg.pnl : 0;
      if (agg) {
        yearlyPnl = round2(yearlyPnl + pnl);
        tradingDays += 1;
        if (Math.abs(pnl) > maxAbs) maxAbs = Math.abs(pnl);
      }
      col.push({ date: key, month: d.getMonth(), pnl, trades: agg ? agg.trades : 0 });
    }
    if (col.length === 7) {
      weeks.push(col);
      col = [];
    }
  }
  if (col.length > 0) {
    while (col.length < 7) col.push(null);
    weeks.push(col);
  }

  return { year, weeks, yearlyPnl, tradingDays, maxAbs };
}
