// P&L basis projection. Net (after commissions) is the default everywhere; the
// "gross" basis re-projects each trade's netPnl onto its gross (pre-commission)
// figure so EVERY downstream calculation (metrics, score, equity, drawdown,
// calendar, analytics) works unchanged — they all read `netPnl`.

/**
 * @param {object[]} trades
 * @param {'net'|'gross'} basis
 * @returns {object[]} the same trades for 'net'; gross-projected copies otherwise
 */
export function projectBasis(trades, basis) {
  if (basis !== 'gross') return trades;
  return trades.map((t) => ({ ...t, netPnl: t.grossPnl ?? t.netPnl }));
}

/** Normalize an untrusted basis value to 'net' | 'gross'. */
export function normalizeBasis(value) {
  return value === 'gross' ? 'gross' : 'net';
}
