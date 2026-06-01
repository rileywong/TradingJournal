import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

const TOKENS = {
  text: '#64748b',
  grid: '#eef1f6',
  border: '#e6eaf0',
  accent: '#6366f1',
};

/**
 * Account equity curve over time, rendered with lightweight-charts as an area
 * series. `data` is the `equityCurve` from GET /api/metrics:
 *   [{ date: ISO, equity: number, pnl: number }]
 */
export default function EquityChart({ data, height = 260 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: 'transparent' }, textColor: TOKENS.text, fontFamily: 'inherit' },
      grid: { vertLines: { color: TOKENS.grid }, horzLines: { color: TOKENS.grid } },
      rightPriceScale: { borderColor: TOKENS.border },
      timeScale: { borderColor: TOKENS.border, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addAreaSeries({
      lineColor: TOKENS.accent,
      topColor: 'rgba(99, 102, 241, 0.22)',
      bottomColor: 'rgba(99, 102, 241, 0.02)',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

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
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(toSeries(data));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <div className="day-chart">
      <div ref={containerRef} className="day-chart-canvas" style={{ height }} />
      {!hasData && <div className="day-chart-empty">Import trades to see your equity curve.</div>}
    </div>
  );
}

/** ISO points → ascending, unique {time(unix sec), value} for lightweight-charts. */
function toSeries(points) {
  if (!Array.isArray(points)) return [];
  let last = -Infinity;
  return points.map((p) => {
    let time = Math.floor(new Date(p.date).getTime() / 1000);
    if (time <= last) time = last + 1;
    last = time;
    return { time, value: p.equity };
  });
}
