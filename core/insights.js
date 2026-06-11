// Turn the analytics breakdowns into a few plain-English, actionable insights.
// Pure + total: same input → same insights, so it's easy to test and runs on
// either the server or client. Each insight is { id, tone, text }.

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const pct = (r) => `${Math.round((r || 0) * 100)}%`;
const hourLabel = (h) => `${((Number(h) + 11) % 12) + 1}${Number(h) < 12 ? 'am' : 'pm'}`;

export function buildInsights(analytics, { minTrades = 6 } = {}) {
  if (!analytics) return [];
  const out = [];
  const { byDayOfWeek = [], byHourOfDay = [], bySymbol = [], winLoss, holdTime, streaks: st } = analytics;
  const enough = (b) => b && b.trades >= minTrades;

  // Best / worst weekday.
  const days = byDayOfWeek.filter(enough);
  if (days.length >= 2) {
    const best = days.reduce((a, b) => (b.netPnl > a.netPnl ? b : a));
    const worst = days.reduce((a, b) => (b.netPnl < a.netPnl ? b : a));
    if (best.netPnl > 0) {
      out.push({ id: 'best-day', tone: 'positive', text: `You're most profitable on ${best.key}s — ${money(best.netPnl)} net at a ${pct(best.winRate)} win rate.` });
    }
    if (worst.netPnl < 0 && worst.key !== best.key) {
      out.push({ id: 'worst-day', tone: 'negative', text: `${worst.key}s are your weakest day — ${money(worst.netPnl)} net. Consider sizing down or sitting out.` });
    }
  }

  // Best trading hour.
  const hours = byHourOfDay.filter(enough);
  if (hours.length >= 2) {
    const bestH = hours.reduce((a, b) => (b.netPnl > a.netPnl ? b : a));
    if (bestH.netPnl > 0) {
      out.push({ id: 'best-hour', tone: 'positive', text: `Your edge peaks around ${hourLabel(bestH.key)} — ${money(bestH.netPnl)} net in that hour.` });
    }
  }

  // Reward/risk (payoff ratio).
  if (winLoss && winLoss.winners.count >= 3 && winLoss.losers.count >= 3) {
    const { winners, losers, payoffRatio } = winLoss;
    if (payoffRatio < 1) {
      out.push({ id: 'payoff-low', tone: 'negative', text: `Your average loss (${money(losers.avg)}) is bigger than your average win (${money(winners.avg)}). Tightening exits would lift your expectancy.` });
    } else if (payoffRatio >= 1.6) {
      out.push({ id: 'payoff-high', tone: 'positive', text: `Strong reward/risk — your average win is ${payoffRatio}× your average loss.` });
    }
  }

  // Best / worst ticker (bySymbol is sorted by net P&L desc).
  const syms = bySymbol.filter(enough);
  if (syms.length >= 2) {
    const bestS = syms[0];
    const worstS = syms[syms.length - 1];
    if (bestS.netPnl > 0) {
      out.push({ id: 'best-symbol', tone: 'positive', text: `${bestS.key} is your best ticker — ${money(bestS.netPnl)} across ${bestS.trades} trades.` });
    }
    if (worstS.netPnl < 0 && worstS.key !== bestS.key) {
      out.push({ id: 'worst-symbol', tone: 'negative', text: `${worstS.key} has cost you ${money(worstS.netPnl)} over ${worstS.trades} trades — worth a rethink.` });
    }
  }

  // Disposition bias: holding losers longer than winners.
  if (holdTime && holdTime.avgWinMinutes > 0 && holdTime.avgLossMinutes > holdTime.avgWinMinutes * 1.3) {
    out.push({ id: 'hold-bias', tone: 'negative', text: `You hold losers longer than winners — a classic disposition bias. Decide your exit before you enter.` });
  }

  // Current streak.
  if (st && typeof st.current === 'number') {
    if (st.current <= -3) {
      out.push({ id: 'streak-loss', tone: 'negative', text: `You're on a ${Math.abs(st.current)}-trade losing streak. A short break can reset your process.` });
    } else if (st.current >= 4) {
      out.push({ id: 'streak-win', tone: 'positive', text: `Hot hand — ${st.current} winners in a row. Stick to your rules and don't over-size.` });
    }
  }

  return out;
}
