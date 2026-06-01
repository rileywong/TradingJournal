import React from 'react';

function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

export default function MetricsGrid({ metrics }) {
  if (!metrics) return null;
  const pnlClass = metrics.netPnl > 0 ? 'pos' : metrics.netPnl < 0 ? 'neg' : '';
  const pf =
    metrics.profitFactor === Infinity || metrics.profitFactor === null
      ? '∞'
      : metrics.profitFactor.toFixed(2);
  const expClass = metrics.expectancy > 0 ? 'pos' : metrics.expectancy < 0 ? 'neg' : '';

  const cards = [
    {
      label: 'Net P&L',
      value: <span className={pnlClass}>{fmtMoney(metrics.netPnl)}</span>,
      sub: `${metrics.totalTrades} trades · end bal ${fmtMoney(metrics.endingBalance)}`,
    },
    {
      label: 'Win Rate',
      value: fmtPct(metrics.winRate),
      sub: `${metrics.wins}W · ${metrics.losses}L · ${metrics.breakeven}BE`,
      bar: metrics.winRate,
    },
    {
      label: 'Profit Factor',
      value: pf,
      sub: `Gross ${fmtMoney(metrics.grossProfit)} / ${fmtMoney(metrics.grossLoss)}`,
    },
    {
      label: 'Expectancy',
      value: <span className={expClass}>{fmtMoney(metrics.expectancy)}</span>,
      sub: 'Per-trade expected value',
    },
    {
      label: 'Total Trades',
      value: metrics.totalTrades,
      sub: `Avg win ${fmtMoney(metrics.avgWin)} · avg loss ${fmtMoney(metrics.avgLoss)}`,
    },
    {
      label: 'Max Drawdown',
      value: <span className="neg">{fmtPct(metrics.maxDrawdownPct)}</span>,
      sub: `${fmtMoney(metrics.maxDrawdownAbs)} peak-to-trough`,
    },
  ];

  return (
    <div className="metrics-grid">
      {cards.map((c) => (
        <div className="metric-card" key={c.label}>
          <div className="label">{c.label}</div>
          <div className="value">{c.value}</div>
          {c.bar !== undefined && (
            <div className="bar">
              <span style={{ width: `${Math.min(100, c.bar * 100)}%` }} />
            </div>
          )}
          {c.sub && <div className="sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
