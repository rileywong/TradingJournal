import React from 'react';
import BaseChart, { CHART_TOKENS } from './BaseChart.jsx';

const makeSeries = (chart) =>
  chart.addAreaSeries({
    lineColor: CHART_TOKENS.accent,
    topColor: 'rgba(8, 145, 178, 0.20)',
    bottomColor: 'rgba(8, 145, 178, 0.02)',
    lineWidth: 2,
    priceLineVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });

const mapPoint = (p) => ({ time: Math.floor(new Date(p.date).getTime() / 1000), value: p.equity });

/**
 * Account equity curve over time. `data` is the `equityCurve` from GET
 * /api/metrics: [{ date: ISO, equity, pnl }].
 */
export default function EquityChart({ data, height = 260 }) {
  return (
    <BaseChart
      data={data}
      makeSeries={makeSeries}
      mapPoint={mapPoint}
      height={height}
      emptyText="Import trades to see your equity curve."
    />
  );
}
