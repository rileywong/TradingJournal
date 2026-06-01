// Instrument classification: stocks, options, and futures.
//
// Equities trade 1:1, but options carry a 100× contract multiplier and futures
// carry a per-contract point value, so P&L must scale by the right multiplier.
// We classify from (in priority order): an explicit multiplier, an OCC option
// symbol, an instrument-type hint, or a known futures root.

// Point value ($ per 1.00 price move) for common futures roots.
export const FUTURES_MULTIPLIERS = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, RTY: 50, M2K: 5, YM: 5, MYM: 0.5,
  CL: 1000, MCL: 100, GC: 100, MGC: 10, SI: 5000,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000,
};

function normMultiplier(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse a standardized OCC option symbol, e.g. "AAPL 240315C00170000" or
 * "AAPL240315C00170000": root + YYMMDD + C/P + strike×1000 (8 digits).
 * @returns {{underlying,expiry,right,strike}|null}
 */
export function parseOccSymbol(symbol) {
  const m = /^([A-Z][A-Z.]{0,5})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(symbol || '').trim().toUpperCase());
  if (!m) return null;
  const [, underlying, yy, mm, dd, cp, strike] = m;
  return {
    underlying,
    expiry: `20${yy}-${mm}-${dd}`,
    right: cp === 'C' ? 'CALL' : 'PUT',
    strike: Number(strike) / 1000,
  };
}

/** The futures point value for a symbol's root, or null if not a known future. */
export function futuresMultiplier(symbol) {
  let root = String(symbol || '').trim().toUpperCase();
  if (!root) return null;
  if (root.startsWith('/')) root = root.slice(1);
  // Exact root (e.g. "ES") or root + month/year code (e.g. "ESZ4", "MNQH25").
  if (FUTURES_MULTIPLIERS[root] != null) return FUTURES_MULTIPLIERS[root];
  const stripped = root.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
  return FUTURES_MULTIPLIERS[stripped] ?? null;
}

/**
 * Classify a symbol into { instrument, multiplier, ...optionMeta }.
 * @param {string} symbol
 * @param {{ type?: string, multiplier?: any }} [hints] - optional CSV columns
 */
export function classifyInstrument(symbol, hints = {}) {
  const explicit = normMultiplier(hints.multiplier);
  const typeStr = String(hints.type || '').toLowerCase();

  const occ = parseOccSymbol(symbol);
  if (occ || /\b(option|opt|call|put)\b/.test(typeStr)) {
    return { instrument: 'option', multiplier: explicit || 100, ...(occ || {}) };
  }

  if (/\b(future|fut|fut\.)\b/.test(typeStr)) {
    return { instrument: 'future', multiplier: explicit || futuresMultiplier(symbol) || 1 };
  }

  const fm = futuresMultiplier(symbol);
  if (fm != null) return { instrument: 'future', multiplier: explicit || fm };

  return { instrument: 'stock', multiplier: explicit || 1 };
}
