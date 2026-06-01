import React, { useEffect, useRef } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';

// Light-theme design tokens (mirrors styles.css) so the chart matches the app.
const TOKENS = {
  text: '#64748b',
  grid: '#eef1f6',
  border: '#e6eaf0',
  positive: '#10b981',
  negative: '#ef4444',
};

/**
 * Intraday cumulative-P&L chart for a single day, rendered with
 * lightweight-charts as a baseline area series (green above zero, red below).
 *
 * `data` is the `cumulative` series from GET /api/day:
 *   [{ time: unixSeconds, value: number, symbol, tradeId }]
 *
 * The chart instance is created once and its data is swapped on prop change;
 * a ResizeObserver keeps it fitted to its container.
 */
export default function DayChart({ data }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 240,
      layout: {
        background: { color: 'transparent' },
        textColor: TOKENS.text,
        fontFamily: 'inherit',
      },
      grid: {
        vertLines: { color: TOKENS.grid },
        horzLines: { color: TOKENS.grid },
      },
      rightPriceScale: { borderColor: TOKENS.border },
      timeScale: {
        borderColor: TOKENS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { horzLine: { labelVisible: true }, vertLine: { labelVisible: true } },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addBaselineSeries({
      baseValue: { type: 'price', price: 0 },
      topLineColor: TOKENS.positive,
      topFillColor1: 'rgba(16, 185, 129, 0.28)',
      topFillColor2: 'rgba(16, 185, 129, 0.05)',
      bottomLineColor: TOKENS.negative,
      bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
      bottomFillColor2: 'rgba(239, 68, 68, 0.28)',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    // Zero baseline reference line.
    series.createPriceLine({
      price: 0,
      color: TOKENS.border,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
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
  }, []);

  // Swap data when it changes.
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(sanitize(data));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <div className="day-chart">
      <div ref={containerRef} className="day-chart-canvas" />
      {!hasData && (
        <div className="day-chart-empty">No closed trades to chart for this day.</div>
      )}
    </div>
  );
}

/**
 * lightweight-charts requires strictly-ascending, unique time values. Trades can
 * close within the same second, so nudge any collision forward by a second while
 * preserving order. Returns only `{ time, value }` points.
 */
function sanitize(points) {
  if (!Array.isArray(points)) return [];
  let last = -Infinity;
  return points.map((p) => {
    let time = p.time;
    if (time <= last) time = last + 1;
    last = time;
    return { time, value: p.value };
  });
}
