// Weekly performance digest: a small summary of the last 7 days, built purely
// from a user's trades so it's testable and can run anywhere. Returns null when
// there's nothing worth emailing (no closed trades in the window).

import { summarize } from './analytics.js';

const DAY = 86_400_000;

export function buildWeeklyDigest(trades, now = Date.now()) {
  const since = now - 7 * DAY;
  const recent = (trades || []).filter((t) => Date.parse(t.closedAt) >= since);
  if (recent.length === 0) return null;

  const s = summarize(recent);
  const byDay = new Map();
  for (const t of recent) {
    const day = String(t.closedAt).slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + t.netPnl);
  }
  const days = [...byDay.entries()].map(([date, pnl]) => ({ date, pnl: Math.round(pnl * 100) / 100 }));
  const bestDay = days.reduce((m, d) => (m === null || d.pnl > m.pnl ? d : m), null);
  const worstDay = days.reduce((m, d) => (m === null || d.pnl < m.pnl ? d : m), null);

  return {
    netPnl: s.netPnl,
    trades: s.trades,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate,
    bestDay,
    worstDay,
    tradingDays: days.length,
  };
}
