// Advanced statistics — the analytical edge of the journal. Everything here is
// a pure, total function of the closed-trade set, computed on top of the same
// data the dashboard/metrics use. Daily grouping reuses dayKey() so it lines up
// exactly with the P&L calendar.

import { dayKey } from './dates.js';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Per-calendar-day performance: how many days you traded, how many were green
 * vs red, your best/worst day, and consecutive green/red day streaks. This is
 * the "are you consistently profitable day to day" view.
 */
export function dailyStats(trades) {
  const byDay = new Map(); // dayKey → { pnl, trades }
  for (const t of trades) {
    const k = dayKey(t.closedAt);
    const d = byDay.get(k) || { date: k, pnl: 0, trades: 0 };
    d.pnl = round2(d.pnl + t.netPnl);
    d.trades += 1;
    byDay.set(k, d);
  }
  const days = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const tradingDays = days.length;
  const green = days.filter((d) => d.pnl > 0);
  const red = days.filter((d) => d.pnl < 0);
  const breakeven = days.filter((d) => d.pnl === 0);

  // Consecutive green / red day streaks (chronological).
  let maxGreenStreak = 0, maxRedStreak = 0, runG = 0, runR = 0;
  for (const d of days) {
    if (d.pnl > 0) { runG += 1; runR = 0; } else if (d.pnl < 0) { runR += 1; runG = 0; } else { runG = 0; runR = 0; }
    if (runG > maxGreenStreak) maxGreenStreak = runG;
    if (runR > maxRedStreak) maxRedStreak = runR;
  }

  const totalPnl = round2(days.reduce((s, d) => s + d.pnl, 0));
  const best = days.reduce((m, d) => (m === null || d.pnl > m.pnl ? d : m), null);
  const worst = days.reduce((m, d) => (m === null || d.pnl < m.pnl ? d : m), null);

  return {
    tradingDays,
    greenDays: green.length,
    redDays: red.length,
    breakevenDays: breakeven.length,
    dayWinRate: tradingDays === 0 ? 0 : round4(green.length / tradingDays),
    avgDailyPnl: tradingDays === 0 ? 0 : round2(totalPnl / tradingDays),
    avgTradesPerDay: tradingDays === 0 ? 0 : round2(trades.length / tradingDays),
    bestDay: best ? { date: best.date, pnl: best.pnl } : null,
    worstDay: worst ? { date: worst.date, pnl: worst.pnl } : null,
    maxGreenStreak,
    maxRedStreak,
  };
}

/**
 * Kelly fraction — the bet size (as a fraction of capital) that maximizes
 * long-run growth, given your edge: f* = W − (1 − W) / R, where W is win rate
 * and R is the payoff ratio (avg win / avg loss). Can be negative (no edge → do
 * not bet); we surface the raw value and a clamped, capital-preserving version.
 * @returns {{ fraction: number, clamped: number }}
 */
export function kelly(winRate, payoffRatio) {
  if (!Number.isFinite(payoffRatio) || payoffRatio <= 0) return { fraction: 0, clamped: 0 };
  const f = winRate - (1 - winRate) / payoffRatio;
  return { fraction: round4(f), clamped: round4(Math.max(0, Math.min(1, f))) };
}

/**
 * Sharpe-style ratio of daily P&L: mean daily P&L divided by its standard
 * deviation (population). A unitless measure of return per unit of day-to-day
 * volatility. 0 when fewer than two trading days or no variance.
 */
export function dailySharpe(trades) {
  const byDay = new Map();
  for (const t of trades) {
    const k = dayKey(t.closedAt);
    byDay.set(k, (byDay.get(k) || 0) + t.netPnl);
  }
  const series = [...byDay.values()];
  if (series.length < 2) return 0;
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : round2(mean / std);
}

/**
 * Full statistics payload: the daily view plus capital-allocation (Kelly),
 * risk-adjusted return (Sharpe), payoff ratio, expectancy, and trade economics
 * (commissions, volume, average size).
 */
export function buildStatistics(trades) {
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const winRate = trades.length === 0 ? 0 : wins.length / trades.length;
  const lossRate = trades.length === 0 ? 0 : losses.length / trades.length;
  const avgWin = wins.length === 0 ? 0 : grossProfit / wins.length;
  const avgLoss = losses.length === 0 ? 0 : grossLoss / losses.length;
  const payoffRatio = avgLoss === 0 ? (avgWin > 0 ? Infinity : 0) : round2(avgWin / avgLoss);
  const expectancy = round2(winRate * avgWin - lossRate * avgLoss);

  const totalCommissions = round2(trades.reduce((s, t) => s + (Number(t.commission) || 0), 0));
  const totalVolume = trades.reduce((s, t) => s + (Number(t.quantity) || 0), 0);
  const avgPositionSize = trades.length === 0 ? 0 : round2(totalVolume / trades.length);

  return {
    daily: dailyStats(trades),
    expectancy,
    payoffRatio: Number.isFinite(payoffRatio) ? payoffRatio : null, // null = no losses yet
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    kelly: kelly(winRate, payoffRatio),
    sharpe: dailySharpe(trades),
    totalCommissions,
    totalVolume: round2(totalVolume),
    avgPositionSize,
  };
}
