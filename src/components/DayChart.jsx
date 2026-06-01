import React, { useMemo } from 'react';
import { LineStyle } from 'lightweight-charts';
import BaseChart, { CHART_TOKENS } from './BaseChart.jsx';

// Baseline area: green above zero, red below, with a dashed zero reference line.
const makeSeries = (chart) => {
  const series = chart.addBaselineSeries({
    baseValue: { type: 'price', price: 0 },
    topLineColor: CHART_TOKENS.positive,
    topFillColor1: 'rgba(16, 185, 129, 0.28)',
    topFillColor2: 'rgba(16, 185, 129, 0.05)',
    bottomLineColor: CHART_TOKENS.negative,
    bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
    bottomFillColor2: 'rgba(239, 68, 68, 0.28)',
    lineWidth: 2,
    priceLineVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  series.createPriceLine({
    price: 0,
    color: CHART_TOKENS.border,
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: false,
  });
  return series;
};

// `cumulative` points already carry unix-second `time` + `value` (+ tradeId/symbol).
const mapPoint = (p) => ({ time: p.time, value: p.value });

function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Intraday cumulative-P&L chart for a single day. `data` is the `cumulative`
 * series from GET /api/day; `trades` is that day's trades, used to enrich the
 * crosshair tooltip with each trade's own P&L and journal note.
 */
export default function DayChart({ data, trades = [] }) {
  const renderTooltip = useMemo(() => {
    const byId = new Map(trades.map((t) => [t.id, t]));
    return (datum) => {
      const t = datum.tradeId ? byId.get(datum.tradeId) : null;
      const cumCls = datum.value >= 0 ? 'pos' : 'neg';
      let html = `<div class="ct-head"><strong>${esc(datum.symbol || '')}</strong>`
        + `<span class="${cumCls}">${fmtMoney(datum.value)} cum</span></div>`;
      if (t) html += `<div class="ct-sub">Trade ${fmtMoney(t.netPnl)}</div>`;
      if (t && t.note) html += `<div class="ct-note">${esc(t.note)}</div>`;
      return html;
    };
  }, [trades]);

  return (
    <BaseChart
      data={data}
      makeSeries={makeSeries}
      mapPoint={mapPoint}
      height={240}
      emptyText="No closed trades to chart for this day."
      renderTooltip={renderTooltip}
    />
  );
}
