import React from 'react';
import DayChart from './DayChart.jsx';
import TradesTable from './TradesTable.jsx';

function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function fmtPct(n) {
  return `${((Number(n) || 0) * 100).toFixed(1)}%`;
}
function fmtPf(pf) {
  return pf === Infinity || pf === null ? '∞' : (Number(pf) || 0).toFixed(2);
}
function fmtLongDate(dateKey) {
  // Parse as local midnight to avoid a UTC day shift.
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Full-day drill-down panel (TradeZella-style "daily journal"): a headline P&L,
 * a stats grid, the intraday cumulative-P&L chart, and the day's trade log.
 *
 * Props:
 *   day:    { date, stats, trades, cumulative } | null
 *   loading: boolean
 *   onClose: () => void
 *   onTag:  (tradeId, tags[]) => void   // forwarded to the trade log
 */
export default function DayDetail({ day, loading, onClose, onTag }) {
  const stats = day?.stats;
  const net = stats?.netPnl ?? 0;
  const netClass = net > 0 ? 'pos' : net < 0 ? 'neg' : 'muted';

  const cells = stats
    ? [
        { label: 'Trades', value: stats.totalTrades, sub: `${stats.wins}W · ${stats.losses}L · ${stats.breakeven}BE` },
        { label: 'Win Rate', value: fmtPct(stats.winRate), bar: stats.winRate },
        { label: 'Profit Factor', value: fmtPf(stats.profitFactor), sub: `Gross ${fmtMoney(stats.grossProfit)} / ${fmtMoney(stats.grossLoss)}` },
        { label: 'Expectancy', value: <span className={stats.expectancy > 0 ? 'pos' : stats.expectancy < 0 ? 'neg' : ''}>{fmtMoney(stats.expectancy)}</span>, sub: 'Per-trade expected value' },
        { label: 'Avg Win / Loss', value: <span><span className="pos">{fmtMoney(stats.avgWin)}</span> / <span className="neg">{fmtMoney(stats.avgLoss)}</span></span> },
        { label: 'Largest Win / Loss', value: <span><span className="pos">{fmtMoney(stats.largestWin)}</span> / <span className="neg">{fmtMoney(stats.largestLoss)}</span></span> },
        { label: 'Volume', value: stats.volume.toLocaleString(), sub: 'Shares / contracts traded' },
        { label: 'Commissions', value: <span className={stats.commissions > 0 ? 'neg' : ''}>{fmtMoney(stats.commissions)}</span> },
        {
          label: 'Best / Worst',
          value: (
            <span>
              {stats.bestSymbol ? <span className="pos">{stats.bestSymbol.symbol}</span> : '—'}
              {' / '}
              {stats.worstSymbol ? <span className="neg">{stats.worstSymbol.symbol}</span> : '—'}
            </span>
          ),
          sub: stats.bestSymbol ? `${fmtMoney(stats.bestSymbol.netPnl)} / ${fmtMoney(stats.worstSymbol.netPnl)}` : 'No trades',
        },
      ]
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal day-detail" onClick={(e) => e.stopPropagation()}>
        <div className="day-detail-head">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Daily journal</div>
            <h2 style={{ margin: '2px 0 0' }}>{day ? fmtLongDate(day.date) : ''}</h2>
          </div>
          <div className="day-detail-head-right">
            <div className={`day-detail-net ${netClass}`}>{fmtMoney(net)}</div>
            <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {loading || !day ? (
          <div className="empty-state">Loading day…</div>
        ) : (
          <>
            <div className="metrics-grid day-stats-grid">
              {cells.map((c) => (
                <div className="metric-card" key={c.label}>
                  <div className="label">{c.label}</div>
                  <div className="value">{c.value}</div>
                  {c.bar !== undefined && (
                    <div className="bar"><span style={{ width: `${Math.min(100, c.bar * 100)}%` }} /></div>
                  )}
                  {c.sub && <div className="sub">{c.sub}</div>}
                </div>
              ))}
            </div>

            <div className="section-title" style={{ marginTop: 22 }}>Cumulative P&amp;L</div>
            <div className="card" style={{ padding: 14 }}>
              <DayChart data={day.cumulative} />
            </div>

            <div className="section-title">
              Trades <span className="muted">({day.trades.length})</span>
            </div>
            <TradesTable trades={day.trades} onTag={onTag} />
          </>
        )}
      </div>
    </div>
  );
}
