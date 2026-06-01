// Shared trade-log filtering. A single pure predicate used by both the API
// (GET /api/trades query params) and the React trade log, so server and client
// always agree on what a filter means.

/** Local YYYY-MM-DD key for a trade's close time (matches calendar.js). */
function dayKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param {object[]} trades
 * @param {object} [criteria]
 * @param {string} [criteria.symbol]  exact ticker (case-insensitive)
 * @param {string} [criteria.side]    'LONG' | 'SHORT' (case-insensitive)
 * @param {string} [criteria.tag]     trade must carry this tag
 * @param {string} [criteria.outcome] 'win' | 'loss' | 'breakeven'
 * @param {string} [criteria.from]    inclusive lower bound, YYYY-MM-DD (by close day)
 * @param {string} [criteria.to]      inclusive upper bound, YYYY-MM-DD (by close day)
 * @returns {object[]} the subset matching every provided criterion
 */
export function filterTrades(trades, criteria = {}) {
  const symbol = criteria.symbol ? String(criteria.symbol).trim().toUpperCase() : null;
  const side = criteria.side ? String(criteria.side).trim().toUpperCase() : null;
  const tag = criteria.tag ? String(criteria.tag).trim() : null;
  const outcome = criteria.outcome ? String(criteria.outcome).trim().toLowerCase() : null;
  const from = criteria.from || null;
  const to = criteria.to || null;

  return trades.filter((t) => {
    if (symbol && String(t.symbol).toUpperCase() !== symbol) return false;
    if (side && String(t.side).toUpperCase() !== side) return false;
    if (tag && !(Array.isArray(t.tags) && t.tags.includes(tag))) return false;
    if (outcome === 'win' && !(t.netPnl > 0)) return false;
    if (outcome === 'loss' && !(t.netPnl < 0)) return false;
    if (outcome === 'breakeven' && t.netPnl !== 0) return false;
    if (from || to) {
      const key = dayKey(t.closedAt);
      if (from && key < from) return false;
      if (to && key > to) return false;
    }
    return true;
  });
}

/** Distinct, sorted symbols present in a trade list (for filter dropdowns). */
export function distinctSymbols(trades) {
  return [...new Set(trades.map((t) => t.symbol))].sort();
}

/** Distinct, sorted tags present across a trade list. */
export function distinctTags(trades) {
  const set = new Set();
  for (const t of trades) for (const tag of t.tags || []) set.add(tag);
  return [...set].sort();
}
