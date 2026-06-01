// Trade-log CSV export. Pure string builder (RFC-4180-ish quoting) so it's
// usable in both the browser (Blob download) and tests.

const HEADERS = [
  'Symbol', 'Side', 'Quantity', 'EntryPrice', 'ExitPrice',
  'OpenedAt', 'ClosedAt', 'GrossPnl', 'Commission', 'NetPnl', 'Tags',
];

function esc(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize closed trades to a CSV string (header + one row per trade). Tags are
 * joined with "; " inside a single cell.
 * @param {object[]} trades
 * @returns {string}
 */
export function tradesToCsv(trades) {
  const rows = (trades || []).map((t) =>
    [
      t.symbol,
      t.side,
      t.quantity,
      t.entryPrice,
      t.exitPrice,
      t.openedAt,
      t.closedAt,
      t.grossPnl,
      t.commission,
      t.netPnl,
      Array.isArray(t.tags) ? t.tags.join('; ') : '',
    ]
      .map(esc)
      .join(',')
  );
  return [HEADERS.join(','), ...rows].join('\n');
}
