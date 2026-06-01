import React from 'react';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Color a cell by P&L sign and magnitude relative to the grid's max |pnl|.
function cellStyle(cell, maxAbs) {
  if (!cell || maxAbs <= 0) return {};
  const intensity = Math.min(1, Math.abs(cell.pnl) / maxAbs);
  const alpha = 0.12 + intensity * 0.73; // keep faint cells visible
  const rgb = cell.pnl >= 0 ? '16, 185, 129' : '239, 68, 68';
  return { backgroundColor: `rgba(${rgb}, ${alpha.toFixed(3)})` };
}

/**
 * Weekday × hour P&L heatmap. `data` is `analytics.heatmap`:
 *   { weekdays:number[], hours:number[], cells:[{weekday,hour,pnl,trades}], maxAbs }
 */
export default function Heatmap({ data }) {
  if (!data || data.cells.length === 0) {
    return <div className="card"><div className="empty-state">No trades to chart yet.</div></div>;
  }
  const { weekdays, hours, cells, maxAbs } = data;
  const lookup = {};
  for (const c of cells) lookup[`${c.weekday}:${c.hour}`] = c;

  return (
    <div className="card heatmap-card">
      <table className="heatmap">
        <thead>
          <tr>
            <th className="heatmap-corner" />
            {hours.map((h) => (
              <th key={h} className="heatmap-hour">{String(h).padStart(2, '0')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekdays.map((wd) => (
            <tr key={wd}>
              <th className="heatmap-dow">{DOW[wd]}</th>
              {hours.map((h) => {
                const c = lookup[`${wd}:${h}`];
                return (
                  <td
                    key={h}
                    className="heatmap-cell"
                    style={cellStyle(c, maxAbs)}
                    title={c ? `${DOW[wd]} ${String(h).padStart(2, '0')}:00 — ${fmtMoney(c.pnl)} · ${c.trades} trade${c.trades > 1 ? 's' : ''}` : ''}
                  >
                    {c ? <span className="heatmap-val">{fmtMoney(c.pnl)}</span> : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heatmap-legend">
        <span className="neg-swatch" /> Loss
        <span className="heatmap-legend-spacer" />
        <span className="pos-swatch" /> Profit
        <span className="muted heatmap-legend-note">· hour of close (local), color scaled to max |P&amp;L|</span>
      </div>
    </div>
  );
}
