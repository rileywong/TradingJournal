import React, { useMemo } from 'react';
import TradesTable from './TradesTable.jsx';
import { filterTrades, distinctSymbols, distinctTags } from '../../core/filters.js';
import { tradesToCsv } from '../../core/export.js';

function downloadCsv(trades) {
  const blob = new Blob([tradesToCsv(trades)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Date scoping is owned by the dashboard period selector; the in-log filter
// covers the categorical dimensions.
export const EMPTY_FILTER = { symbol: '', side: '', outcome: '', tag: '' };

/**
 * Trade log with a filter bar. Controlled: the parent owns the `filter` so other
 * views (e.g. Reports) can drill into it. Filtering runs client-side through the
 * shared core `filterTrades`, matching GET /api/trades semantics without a
 * round-trip.
 */
export default function TradeLog({ trades, onTag, onRisk, onTradeNote, filter = EMPTY_FILTER, onFilterChange }) {
  const f = filter;
  const setFilter = onFilterChange || (() => {});

  const symbols = useMemo(() => distinctSymbols(trades), [trades]);
  const tags = useMemo(() => distinctTags(trades), [trades]);
  const filtered = useMemo(() => filterTrades(trades, f), [trades, f]);

  const set = (key) => (e) => setFilter({ ...f, [key]: e.target.value });
  const active = Object.values(f).some(Boolean);

  return (
    <div className="trade-log">
      <div className="filter-bar">
        <select value={f.symbol} onChange={set('symbol')} aria-label="Filter by symbol">
          <option value="">All symbols</option>
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={f.side} onChange={set('side')} aria-label="Filter by side">
          <option value="">Long &amp; Short</option>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
        </select>
        <select value={f.outcome} onChange={set('outcome')} aria-label="Filter by outcome">
          <option value="">All outcomes</option>
          <option value="win">Winners</option>
          <option value="loss">Losers</option>
          <option value="breakeven">Breakeven</option>
        </select>
        <select value={f.tag} onChange={set('tag')} aria-label="Filter by tag">
          <option value="">All tags</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="filter-count muted">
          {filtered.length} of {trades.length}
        </span>
        {active && (
          <button className="btn-ghost" onClick={() => setFilter(EMPTY_FILTER)}>Clear</button>
        )}
        <button
          className="btn-ghost"
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          title="Export the filtered trades to CSV"
        >
          Export CSV
        </button>
      </div>
      <TradesTable trades={filtered} onTag={onTag} onRisk={onRisk} onTradeNote={onTradeNote} />
    </div>
  );
}
