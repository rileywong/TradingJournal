import React from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function cellStyle(cell, maxAbs) {
  if (!cell || cell.trades === 0 || maxAbs <= 0) return {};
  const intensity = Math.min(1, Math.abs(cell.pnl) / maxAbs);
  const alpha = 0.18 + intensity * 0.72;
  const rgb = cell.pnl >= 0 ? '16, 185, 129' : '239, 68, 68';
  return { backgroundColor: `rgba(${rgb}, ${alpha.toFixed(3)})` };
}

/**
 * GitHub-style yearly P&L heatmap. `data` is `heatmap` from GET /api/year:
 *   { year, weeks:(null|{date,month,pnl,trades})[][], yearlyPnl, tradingDays, maxAbs }
 */
export default function YearHeatmap({ data, onPrevYear, onNextYear }) {
  if (!data) return null;
  const { year, weeks, yearlyPnl, tradingDays, maxAbs } = data;
  const pnlCls = yearlyPnl > 0 ? 'pos' : yearlyPnl < 0 ? 'neg' : 'muted';

  // Month label positioned above the first week-column whose first in-year day
  // belongs to that month.
  const monthLabels = weeks.map((col, wi) => {
    const firstDay = col.find(Boolean);
    if (!firstDay) return null;
    const prev = wi > 0 ? weeks[wi - 1].find(Boolean) : null;
    return !prev || prev.month !== firstDay.month ? MONTHS[firstDay.month] : null;
  });

  return (
    <div className="card year-heatmap-card">
      <div className="year-hm-head">
        <div className="cal-nav">
          <button onClick={onPrevYear} aria-label="Previous year">‹</button>
          <strong>{year}</strong>
          <button onClick={onNextYear} aria-label="Next year">›</button>
        </div>
        <div className="year-hm-totals">
          <span className={pnlCls}>{fmtMoney(yearlyPnl)}</span>
          <span className="muted"> · {tradingDays} trading days</span>
        </div>
      </div>
      <div className="year-hm-scroll">
        <div className="year-hm-months">
          {monthLabels.map((m, i) => (
            <div key={i} className="year-hm-month" style={{ gridColumnStart: i + 1 }}>{m}</div>
          ))}
        </div>
        <div className="year-hm-grid">
          {weeks.map((col, wi) => (
            <div className="year-hm-col" key={wi}>
              {col.map((cell, di) => (
                <div
                  key={di}
                  className={`year-hm-cell ${cell ? '' : 'empty'}`}
                  style={cellStyle(cell, maxAbs)}
                  title={cell && cell.trades > 0
                    ? `${cell.date} — ${fmtMoney(cell.pnl)} · ${cell.trades} trade${cell.trades > 1 ? 's' : ''}`
                    : cell ? `${cell.date} — no trades` : ''}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
