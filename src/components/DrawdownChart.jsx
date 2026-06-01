import React from 'react';
import BaseChart, { CHART_TOKENS } from './BaseChart.jsx';

const makeSeries = (chart) =>
  chart.addAreaSeries({
    lineColor: CHART_TOKENS.negative,
    topColor: 'rgba(239, 68, 68, 0.05)',
    bottomColor: 'rgba(239, 68, 68, 0.30)',
    lineWidth: 2,
    priceLineVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });

const mapPoint = (p) => ({ time: Math.floor(new Date(p.date).getTime() / 1000), value: p.drawdown });

/**
 * Underwater (drawdown) curve — equity's distance below its running peak (≤ 0).
 * `data` is the `drawdownCurve` from GET /api/metrics:
 *   [{ date: ISO, drawdown(≤0), drawdownPct, equity }].
 */
export default function DrawdownChart({ data, height = 220 }) {
  return (
    <BaseChart
      data={data}
      makeSeries={makeSeries}
      mapPoint={mapPoint}
      height={height}
      emptyText="No drawdown data yet."
    />
  );
}
