import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

// Shared light-theme tokens for every chart (mirrors styles.css).
export const CHART_TOKENS = {
  text: '#64748b',
  grid: '#eef1f6',
  border: '#e6eaf0',
  positive: '#10b981',
  negative: '#ef4444',
  accent: '#6366f1',
};

/**
 * Reusable lightweight-charts wrapper. Owns the create-once / resize / cleanup
 * lifecycle and the ascending-unique time normalization that the library
 * requires; callers supply only what differs between charts:
 *
 *   makeSeries(chart) → series   // which series type + colors to add (stable ref)
 *   mapPoint(datum)   → { time, value }   // datum → chart point (stable ref)
 *
 * `makeSeries` and `mapPoint` MUST be stable (module-scope) so the chart isn't
 * torn down and rebuilt on every render.
 */
export default function BaseChart({ data, makeSeries, mapPoint, height = 240, emptyText }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: 'transparent' }, textColor: CHART_TOKENS.text, fontFamily: 'inherit' },
      grid: { vertLines: { color: CHART_TOKENS.grid }, horzLines: { color: CHART_TOKENS.grid } },
      rightPriceScale: { borderColor: CHART_TOKENS.border },
      timeScale: { borderColor: CHART_TOKENS.border, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    const series = makeSeries(chart);

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, makeSeries]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(toAscendingUnique(data, mapPoint));
    chartRef.current?.timeScale().fitContent();
  }, [data, mapPoint]);

  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <div className="day-chart">
      <div ref={containerRef} className="day-chart-canvas" style={{ height }} />
      {!hasData && <div className="day-chart-empty">{emptyText}</div>}
    </div>
  );
}

/**
 * lightweight-charts requires strictly-ascending, unique time values; points
 * that collide (e.g. trades closing in the same second) are nudged forward a
 * second while preserving order. Returns only `{ time, value }`.
 */
function toAscendingUnique(points, mapPoint) {
  if (!Array.isArray(points)) return [];
  let last = -Infinity;
  return points.map((p) => {
    const { time, value } = mapPoint(p);
    const t = time <= last ? last + 1 : time;
    last = t;
    return { time: t, value };
  });
}
