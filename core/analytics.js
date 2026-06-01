// Performance breakdowns (a "Reports" tab à la TradeZella): slice closed trades
// by symbol, side, day-of-week, hour-of-day, and tag, plus hold-time and
// win/loss streak summaries. All functions are pure and total.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Core per-bucket summary shared by every breakdown.
 * @param {object[]} trades
 * @returns {{ trades, wins, losses, breakeven, netPnl, grossProfit, grossLoss,
 *   winRate, profitFactor, avgWin, avgLoss }}
 */
export function summarize(trades) {
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl < 0);
  const breakeven = trades.filter((t) => t.netPnl === 0);

  const netPnl = round2(trades.reduce((s, t) => s + t.netPnl, 0));
  const grossProfit = round2(wins.reduce((s, t) => s + t.netPnl, 0));
  const grossLoss = round2(Math.abs(losses.reduce((s, t) => s + t.netPnl, 0)));

  let profitFactor;
  if (grossLoss === 0) profitFactor = grossProfit > 0 ? Infinity : 0;
  else profitFactor = round2(grossProfit / grossLoss);

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    netPnl,
    grossProfit,
    grossLoss,
    winRate: trades.length === 0 ? 0 : round4(wins.length / trades.length),
    profitFactor,
    avgWin: wins.length === 0 ? 0 : round2(grossProfit / wins.length),
    avgLoss: losses.length === 0 ? 0 : round2(grossLoss / losses.length),
  };
}

/**
 * Group trades by an arbitrary key, summarize each bucket, and sort by net P&L
 * descending. Keys whose `keyFn` returns null/undefined are skipped.
 * @param {object[]} trades
 * @param {(t) => (string|number|null)} keyFn
 * @returns {{ key, ...summary }[]}
 */
export function groupBy(trades, keyFn) {
  const buckets = new Map();
  for (const t of trades) {
    const key = keyFn(t);
    // Skip null/undefined and NaN (e.g. an unparseable closedAt → getDay()=NaN),
    // which would otherwise form a bogus bucket with an undefined label.
    if (key === null || key === undefined) continue;
    if (typeof key === 'number' && Number.isNaN(key)) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  return [...buckets.entries()]
    .map(([key, group]) => ({ key, ...summarize(group) }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export function bySymbol(trades) {
  return groupBy(trades, (t) => t.symbol);
}

export function bySide(trades) {
  return groupBy(trades, (t) => t.side);
}

export function byDayOfWeek(trades) {
  // Keyed/sorted Mon..Sun for a stable, readable report (not by P&L).
  const order = [1, 2, 3, 4, 5, 6, 0];
  const grouped = groupBy(trades, (t) => new Date(t.closedAt).getDay());
  const map = new Map(grouped.map((g) => [g.key, g]));
  return order
    .filter((d) => map.has(d))
    .map((d) => ({ ...map.get(d), key: DOW[d], weekday: d }));
}

export function byHourOfDay(trades) {
  return groupBy(trades, (t) => new Date(t.closedAt).getHours())
    .sort((a, b) => a.key - b.key)
    .map((g) => ({ ...g, hour: g.key, key: `${String(g.key).padStart(2, '0')}:00` }));
}

/**
 * Tag breakdown. A trade contributes to every tag it carries; trades with no
 * tags fall into an "Untagged" bucket so the report always reconciles.
 */
export function byTag(trades) {
  const buckets = new Map();
  for (const t of trades) {
    const tags = Array.isArray(t.tags) && t.tags.length > 0 ? t.tags : ['Untagged'];
    for (const tag of tags) {
      if (!buckets.has(tag)) buckets.set(tag, []);
      buckets.get(tag).push(t);
    }
  }
  return [...buckets.entries()]
    .map(([key, group]) => ({ key, ...summarize(group) }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

/**
 * Hold-time summary in minutes (openedAt → closedAt), split by outcome so you
 * can see whether winners are held longer than losers.
 */
export function holdTimeStats(trades) {
  const minutes = (t) =>
    Math.max(0, (new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 60000);
  const avg = (arr) =>
    arr.length === 0 ? 0 : round2(arr.reduce((s, t) => s + minutes(t), 0) / arr.length);
  return {
    avgMinutes: avg(trades),
    avgWinMinutes: avg(trades.filter((t) => t.netPnl > 0)),
    avgLossMinutes: avg(trades.filter((t) => t.netPnl < 0)),
  };
}

/**
 * Win/loss streaks over the trades in close-time order. `current` is signed:
 * positive = consecutive wins through the last trade, negative = losses,
 * 0 = no trades or the last trade was breakeven.
 */
export function streaks(trades) {
  const ordered = [...trades].sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  let longestWin = 0;
  let longestLoss = 0;
  let runWin = 0;
  let runLoss = 0;
  let current = 0;
  for (const t of ordered) {
    if (t.netPnl > 0) {
      runWin += 1;
      runLoss = 0;
      current = runWin;
    } else if (t.netPnl < 0) {
      runLoss += 1;
      runWin = 0;
      current = -runLoss;
    } else {
      runWin = 0;
      runLoss = 0;
      current = 0;
    }
    if (runWin > longestWin) longestWin = runWin;
    if (runLoss > longestLoss) longestLoss = runLoss;
  }
  return { longestWin, longestLoss, current };
}

/**
 * Side-by-side winners vs losers comparison (count, total, average, average
 * hold, and the largest single outcome), plus the payoff ratio (avg win / avg
 * loss). Infinity payoff when there are wins but no losses.
 */
export function winLossComparison(trades) {
  const minutes = (t) =>
    Math.max(0, (new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 60000);
  const side = (arr) => {
    const total = round2(arr.reduce((s, t) => s + t.netPnl, 0));
    const largest = arr.reduce((m, t) => (Math.abs(t.netPnl) > Math.abs(m) ? t.netPnl : m), 0);
    return {
      count: arr.length,
      total,
      avg: arr.length ? round2(total / arr.length) : 0,
      avgHoldMinutes: arr.length ? round2(arr.reduce((s, t) => s + minutes(t), 0) / arr.length) : 0,
      largest: round2(largest),
    };
  };
  const winners = side(trades.filter((t) => t.netPnl > 0));
  const losers = side(trades.filter((t) => t.netPnl < 0));
  let payoffRatio;
  if (losers.avg === 0) payoffRatio = winners.avg > 0 ? Infinity : 0;
  else payoffRatio = round2(Math.abs(winners.avg / losers.avg));
  return { winners, losers, payoffRatio };
}

/** Full analytics payload for the Reports view. */
export function buildAnalytics(trades) {
  return {
    overall: summarize(trades),
    winLoss: winLossComparison(trades),
    bySymbol: bySymbol(trades),
    bySide: bySide(trades),
    byDayOfWeek: byDayOfWeek(trades),
    byHourOfDay: byHourOfDay(trades),
    byTag: byTag(trades),
    holdTime: holdTimeStats(trades),
    streaks: streaks(trades),
  };
}
