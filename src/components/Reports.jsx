import React from 'react';
import DrawdownChart from './DrawdownChart.jsx';

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
function fmtDuration(min) {
  const m = Number(min) || 0;
  if (m < 60) return `${m.toFixed(0)}m`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}

function BreakdownTable({ title, rows, keyLabel }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card report-card">
        <h3>{title}</h3>
        <div className="empty-state">No data.</div>
      </div>
    );
  }
  return (
    <div className="card report-card">
      <h3>{title}</h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>{keyLabel}</th>
            <th style={{ textAlign: 'right' }}>Trades</th>
            <th style={{ textAlign: 'right' }}>Win%</th>
            <th style={{ textAlign: 'right' }}>PF</th>
            <th style={{ textAlign: 'right' }}>Net P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="sym">{r.key}</td>
              <td style={{ textAlign: 'right' }}>{r.trades}</td>
              <td style={{ textAlign: 'right' }}>{fmtPct(r.winRate)}</td>
              <td style={{ textAlign: 'right' }}>{fmtPf(r.profitFactor)}</td>
              <td style={{ textAlign: 'right' }} className={r.netPnl > 0 ? 'pos' : r.netPnl < 0 ? 'neg' : 'muted'}>
                <strong>{fmtMoney(r.netPnl)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Reports view — TradeZella-style performance breakdowns.
 * Props: analytics (from GET /api/analytics).
 */
export default function Reports({ analytics, drawdownCurve }) {
  if (!analytics) return <div className="empty-state">Loading reports…</div>;
  const { streaks, holdTime } = analytics;

  if (analytics.overall.trades === 0) {
    return <div className="card"><div className="empty-state">No trades yet. Import a brokerage CSV to unlock reports.</div></div>;
  }

  const summary = [
    { label: 'Win Streak (max)', value: `${streaks.longestWin}` },
    { label: 'Loss Streak (max)', value: `${streaks.longestLoss}` },
    {
      label: 'Current Streak',
      value: (
        <span className={streaks.current > 0 ? 'pos' : streaks.current < 0 ? 'neg' : 'muted'}>
          {streaks.current > 0 ? `${streaks.current}W` : streaks.current < 0 ? `${-streaks.current}L` : '—'}
        </span>
      ),
    },
    { label: 'Avg Hold', value: fmtDuration(holdTime.avgMinutes) },
    { label: 'Avg Hold · Wins', value: fmtDuration(holdTime.avgWinMinutes) },
    { label: 'Avg Hold · Losses', value: fmtDuration(holdTime.avgLossMinutes) },
  ];

  return (
    <>
      <div className="section-title">Streaks &amp; Hold Time</div>
      <div className="metrics-grid">
        {summary.map((c) => (
          <div className="metric-card" key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Drawdown (Underwater Equity)</div>
      <div className="card" style={{ padding: 14 }}>
        <DrawdownChart data={drawdownCurve} />
      </div>

      <div className="section-title">Performance Breakdowns</div>
      <div className="reports-grid">
        <BreakdownTable title="By Symbol" rows={analytics.bySymbol} keyLabel="Symbol" />
        <BreakdownTable title="By Side" rows={analytics.bySide} keyLabel="Side" />
        <BreakdownTable title="By Day of Week" rows={analytics.byDayOfWeek} keyLabel="Weekday" />
        <BreakdownTable title="By Hour of Day" rows={analytics.byHourOfDay} keyLabel="Hour" />
        <BreakdownTable title="By Tag / Setup" rows={analytics.byTag} keyLabel="Tag" />
      </div>
    </>
  );
}
