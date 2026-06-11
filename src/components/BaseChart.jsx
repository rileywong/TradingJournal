import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

// Shared light-theme tokens for every chart (mirrors styles.css).
export const CHART_TOKENS = {
  text: '#5e7268',
  grid: '#eef1f6',
  border: '#e2ece6',
  positive: '#10b981',
  negative: '#ef4444',
  accent: '#059669',
};

/**
 * Reusable lightweight-charts wrapper. Owns the create-once / resize / cleanup
 * lifecycle and the ascending-unique time normalization that the library
 * requires; callers supply only what differs between charts:
 *
 *   makeSeries(chart) → series   // which series type + colors to add (stable ref)
 *   mapPoint(datum)   → { time, value }   // datum → chart point (stable ref)
 *   renderTooltip(datum) → htmlString  // optional; crosshair tooltip (may change)
 *
 * `makeSeries` and `mapPoint` MUST be stable (module-scope) so the chart isn't
 * torn down and rebuilt on every render. `renderTooltip` is read through a ref,
 * so it may change freely.
 */
export default function BaseChart({ data, makeSeries, mapPoint, height = 240, emptyText, renderTooltip }) {
  const containerRef = useRef(null);
  const tooltipRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const datumByTime = useRef(new Map());
  const renderTooltipRef = useRef(renderTooltip);
  renderTooltipRef.current = renderTooltip;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Read theme tokens from CSS vars so charts adapt to light/dark.
    const cssVar = (name, fallback) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    };
    const text = cssVar('--muted', CHART_TOKENS.text);
    const grid = cssVar('--border', CHART_TOKENS.grid);

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: 'transparent' }, textColor: text, fontFamily: 'inherit' },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    const series = makeSeries(chart);

    chartRef.current = chart;
    seriesRef.current = series;

    // Custom crosshair tooltip (rendered into tooltipRef when renderTooltip set).
    const onMove = (param) => {
      const tip = tooltipRef.current;
      const render = renderTooltipRef.current;
      if (!tip) return;
      if (!render || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        tip.style.display = 'none';
        return;
      }
      const datum = datumByTime.current.get(param.time);
      const html = datum ? render(datum) : '';
      if (!html) {
        tip.style.display = 'none';
        return;
      }
      tip.innerHTML = html;
      tip.style.display = 'block';
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let left = param.point.x + 14;
      if (left + w > el.clientWidth) left = param.point.x - w - 14;
      let top = param.point.y + 14;
      if (top + h > el.clientHeight) top = param.point.y - h - 14;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${Math.max(4, top)}px`;
    };
    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, makeSeries]);

  useEffect(() => {
    if (!seriesRef.current) return;
    // Normalize to ascending-unique time, keeping each original datum keyed by
    // its final time so the tooltip can look it up on crosshair move.
    const map = new Map();
    let last = -Infinity;
    const points = (Array.isArray(data) ? data : []).map((p) => {
      const { time, value } = mapPoint(p);
      const t = time <= last ? last + 1 : time;
      last = t;
      map.set(t, p);
      return { time: t, value };
    });
    datumByTime.current = map;
    seriesRef.current.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [data, mapPoint]);

  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <div className="day-chart">
      <div ref={containerRef} className="day-chart-canvas" style={{ height }} />
      <div ref={tooltipRef} className="chart-tooltip" style={{ display: 'none' }} />
      {!hasData && <div className="day-chart-empty">{emptyText}</div>}
    </div>
  );
}
