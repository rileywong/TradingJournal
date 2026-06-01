// Composite "Trade Score" (0–100) — a TradeZella-style single number that
// blends profitability, risk/reward, drawdown control, and consistency, so a
// trader sees overall quality at a glance rather than chasing raw P&L.
//
// Each sub-score is normalized to 0–100 with an explicit, documented mapping,
// then combined with fixed weights. The breakdown is returned so the UI can
// show how each dimension contributed.

import { computeMetrics, computeMaxDrawdown } from './metrics.js';
import { aggregateDaily } from './calendar.js';

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

const WEIGHTS = [
  { key: 'winRate', label: 'Win Rate', weight: 0.2 },
  { key: 'profitFactor', label: 'Profit Factor', weight: 0.25 },
  { key: 'winLoss', label: 'Win/Loss Ratio', weight: 0.2 },
  { key: 'maxDrawdown', label: 'Drawdown Control', weight: 0.2 },
  { key: 'consistency', label: 'Consistency', weight: 0.15 },
];

/** Win rate (0..1): 60%+ is treated as elite → 100. */
function winRateScore(winRate) {
  return clamp((winRate / 0.6) * 100);
}

/** Profit factor: 1.0 (breakeven) → 0, 2.0+ → 100; Infinity → 100. */
function profitFactorScore(profitFactor) {
  if (profitFactor === Infinity) return 100;
  return clamp((profitFactor - 1) * 100);
}

/** Avg win / avg loss: 2.0+ → 100, 1.0 → 50, 0 → 0; no losses → 100. */
function winLossScore(avgWin, avgLoss) {
  if (avgLoss === 0) return avgWin > 0 ? 100 : 0;
  return clamp((avgWin / avgLoss / 2) * 100);
}

/** Max drawdown %: 0 → 100, 30%+ → 0 (linear). */
function maxDrawdownScore(ddPct) {
  return clamp((1 - ddPct / 0.3) * 100);
}

/**
 * Consistency: penalizes reliance on a single lucky day. Uses the share of
 * total positive daily P&L contributed by the best day — spread evenly across
 * many days → high; one day carrying everything → low. Needs ≥1 profitable day.
 */
function consistencyScore(trades) {
  const daily = Object.values(aggregateDaily(trades));
  const positive = daily.map((d) => d.pnl).filter((p) => p > 0);
  const totalPositive = positive.reduce((s, p) => s + p, 0);
  if (totalPositive <= 0 || positive.length === 0) return 0;
  const best = Math.max(...positive);
  // bestShare in (0,1]; 1 (single profitable day) → 0, well-spread → 100.
  const bestShare = best / totalPositive;
  return clamp((1 - bestShare) * 100);
}

function gradeFor(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

/**
 * @param {object[]} trades closed trades
 * @param {{ startingBalance?: number }} [opts]
 * @returns {{ score: number, grade: string, components: {key,label,weight,score}[] }}
 *   0 trades → score 0, grade 'N/A'.
 */
export function computeScore(trades, opts = {}) {
  if (!trades || trades.length === 0) {
    return {
      score: 0,
      grade: 'N/A',
      components: WEIGHTS.map((w) => ({ ...w, score: 0 })),
    };
  }

  const { startingBalance = 10000 } = opts;
  const m = computeMetrics(trades, { startingBalance });
  const { maxDrawdownPct } = computeMaxDrawdown(trades, startingBalance);

  const subs = {
    winRate: winRateScore(m.winRate),
    profitFactor: profitFactorScore(m.profitFactor),
    winLoss: winLossScore(m.avgWin, m.avgLoss),
    maxDrawdown: maxDrawdownScore(maxDrawdownPct),
    consistency: consistencyScore(trades),
  };

  const components = WEIGHTS.map((w) => ({ ...w, score: round1(subs[w.key]) }));
  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));

  return { score, grade: gradeFor(score), components };
}
