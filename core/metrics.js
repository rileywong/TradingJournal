// Institutional-grade performance metrics computed from closed trades.
// All functions are pure and total (defined for empty / degenerate inputs).

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @param {object[]} trades closed trades (each with `netPnl`, `closedAt`)
 * @param {{ startingBalance?: number }} [opts]
 * @returns {object} metrics snapshot
 */
export function computeMetrics(trades, opts = {}) {
  const { startingBalance = 10000 } = opts;
  const total = trades.length;

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl < 0);
  const breakeven = trades.filter((t) => t.netPnl === 0);

  const netPnl = round2(trades.reduce((s, t) => s + t.netPnl, 0));
  const grossProfit = round2(wins.reduce((s, t) => s + t.netPnl, 0));
  const grossLoss = round2(Math.abs(losses.reduce((s, t) => s + t.netPnl, 0)));

  const winRate = total === 0 ? 0 : wins.length / total;
  const lossRate = total === 0 ? 0 : losses.length / total;

  const avgWin = wins.length === 0 ? 0 : grossProfit / wins.length;
  const avgLoss = losses.length === 0 ? 0 : grossLoss / losses.length;

  // Profit factor: Infinity when there are profits but no losses; 0 when neither.
  let profitFactor;
  if (grossLoss === 0) {
    profitFactor = grossProfit > 0 ? Infinity : 0;
  } else {
    profitFactor = grossProfit / grossLoss;
  }

  const expectancy = winRate * avgWin - lossRate * avgLoss;

  const drawdown = computeMaxDrawdown(trades, startingBalance);

  const largestWin = wins.reduce((m, t) => Math.max(m, t.netPnl), 0);
  const largestLoss = losses.reduce((m, t) => Math.min(m, t.netPnl), 0);

  return {
    totalTrades: total,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    netPnl,
    grossProfit,
    grossLoss,
    winRate: round4(winRate),
    lossRate: round4(lossRate),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    profitFactor: Number.isFinite(profitFactor) ? round2(profitFactor) : Infinity,
    expectancy: round2(expectancy),
    largestWin: round2(largestWin),
    largestLoss: round2(largestLoss),
    maxDrawdownAbs: drawdown.maxDrawdownAbs,
    maxDrawdownPct: drawdown.maxDrawdownPct,
    startingBalance,
    endingBalance: round2(startingBalance + netPnl),
  };
}

function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Largest peak-to-trough drop on the equity curve (startingBalance + cumPnl),
 * ordered by close time.
 * @returns {{ maxDrawdownAbs: number, maxDrawdownPct: number }}
 */
export function computeMaxDrawdown(trades, startingBalance = 10000) {
  if (trades.length === 0) return { maxDrawdownAbs: 0, maxDrawdownPct: 0 };

  const ordered = [...trades].sort(
    (a, b) => new Date(a.closedAt) - new Date(b.closedAt)
  );

  let equity = startingBalance;
  let peak = startingBalance;
  let maxDdAbs = 0;
  let maxDdPct = 0;

  for (const t of ordered) {
    equity += t.netPnl;
    if (equity > peak) peak = equity;
    const ddAbs = peak - equity;
    if (ddAbs > maxDdAbs) maxDdAbs = ddAbs;
    // Percentage only meaningful against a positive peak.
    if (peak > 0) {
      const ddPct = ddAbs / peak;
      if (ddPct > maxDdPct) maxDdPct = ddPct;
    }
  }

  return { maxDrawdownAbs: round2(maxDdAbs), maxDrawdownPct: round4(maxDdPct) };
}

/**
 * Cumulative equity curve points for charting.
 * @returns {{ date: string, equity: number, pnl: number }[]}
 */
export function equityCurve(trades, startingBalance = 10000) {
  const ordered = [...trades].sort(
    (a, b) => new Date(a.closedAt) - new Date(b.closedAt)
  );
  let equity = startingBalance;
  return ordered.map((t) => {
    equity += t.netPnl;
    return { date: t.closedAt, equity: round2(equity), pnl: t.netPnl };
  });
}
