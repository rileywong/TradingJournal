// Per-day drill-down: TradeZella-style daily stats, the day's trade list, and an
// intraday cumulative-P&L series for charting. Built on the shared metric engine
// so the daily snapshot is computed identically to the all-time snapshot.

import { computeMetrics } from './metrics.js';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Local YYYY-MM-DD key for a trade's close time (matches calendar.js). */
function dayKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed YYYY-MM-DD calendar key. */
export function isValidDateKey(key) {
  return typeof key === 'string' && DATE_RE.test(key);
}

/**
 * The closed trades that settled on a given local calendar day, ordered by
 * close time (stable, oldest first).
 * @param {object[]} trades
 * @param {string} dateKey YYYY-MM-DD
 * @returns {object[]}
 */
export function tradesForDay(trades, dateKey) {
  return trades
    .filter((t) => dayKey(t.closedAt) === dateKey)
    .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
}

/**
 * TradeZella-style daily statistics for a single day. Reuses computeMetrics for
 * the shared figures (net P&L, win rate, profit factor, expectancy, avg win/loss)
 * and adds day-specific aggregates (commissions, shares/contracts traded, the
 * winning/losing streak split, and the best/worst symbol of the session).
 * @param {object[]} trades all of the account's closed trades
 * @param {string} dateKey YYYY-MM-DD
 * @param {{ startingBalance?: number }} [opts]
 */
export function dailyStats(trades, dateKey, opts = {}) {
  const dayTrades = tradesForDay(trades, dateKey);
  const base = computeMetrics(dayTrades, opts);

  const commissions = round2(
    dayTrades.reduce((s, t) => s + (t.commission || 0), 0)
  );
  const volume = dayTrades.reduce((s, t) => s + (t.quantity || 0), 0);

  // Best / worst single trade symbol of the day (by net P&L).
  let bestSymbol = null;
  let worstSymbol = null;
  for (const t of dayTrades) {
    if (bestSymbol === null || t.netPnl > bestSymbol.netPnl) {
      bestSymbol = { symbol: t.symbol, netPnl: round2(t.netPnl) };
    }
    if (worstSymbol === null || t.netPnl < worstSymbol.netPnl) {
      worstSymbol = { symbol: t.symbol, netPnl: round2(t.netPnl) };
    }
  }

  return {
    date: dateKey,
    ...base,
    commissions,
    volume,
    bestSymbol,
    worstSymbol,
  };
}

/**
 * Intraday cumulative net-P&L curve for the day's trades, formatted for a
 * lightweight-charts line/area series. `time` is a UNIX timestamp in seconds
 * (the chart library's UTCTimestamp form); each point carries the realizing
 * trade's id and symbol so the UI can cross-reference the trade log.
 * @returns {{ time: number, value: number, tradeId: string, symbol: string }[]}
 */
export function dailyCumulativePnl(trades, dateKey) {
  const dayTrades = tradesForDay(trades, dateKey);
  let cum = 0;
  return dayTrades.map((t) => {
    cum = round2(cum + t.netPnl);
    return {
      time: Math.floor(new Date(t.closedAt).getTime() / 1000),
      value: cum,
      tradeId: t.id,
      symbol: t.symbol,
    };
  });
}
