import React from 'react';
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

// `cumulative` points already carry unix-second `time` + `value`.
const mapPoint = (p) => ({ time: p.time, value: p.value });

/**
 * Intraday cumulative-P&L chart for a single day. `data` is the `cumulative`
 * series from GET /api/day: [{ time: unixSeconds, value, symbol, tradeId }].
 */
export default function DayChart({ data }) {
  return (
    <BaseChart
      data={data}
      makeSeries={makeSeries}
      mapPoint={mapPoint}
      height={240}
      emptyText="No closed trades to chart for this day."
    />
  );
}
