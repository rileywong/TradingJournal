import React from 'react';
import { buildInsights } from '../../core/insights.js';
import DrawdownChart from './DrawdownChart.jsx';
import Heatmap from './Heatmap.jsx';
import YearHeatmap from './YearHeatmap.jsx';

function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function fmtPct(n) {
  return `${((Number(n) || 0) * 100).toFixed(1)}%`;
}
function fmtPf(pf) {
  return pf === Infinity || pf === null ? '∞' : (Number(pf) || 0).toFixed(2);
}
function fmtDuration(min) {
  const m = Number(min) || 0;
  if (m < 60) return `${m.toFixed(0)}m`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}

function BreakdownTable({ title, rows, keyLabel, onRowClick, isRowClickable = () => true }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card report-card">
        <h3>{title}</h3>
        <div className="empty-state">No data.</div>
      </div>
    );
  }
  return (
    <div className="card report-card">
      <h3>
        {title}
        {onRowClick && <span className="muted report-hint"> · click to filter</span>}
      </h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>{keyLabel}</th>
            <th style={{ textAlign: 'right' }}>Trades</th>
            <th style={{ textAlign: 'right' }}>Win%</th>
            <th style={{ textAlign: 'right' }}>PF</th>
            <th style={{ textAlign: 'right' }}>Net P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clickable = Boolean(onRowClick) && isRowClickable(r);
            return (
              <tr
                key={r.key}
                className={clickable ? 'report-row-clickable' : undefined}
                onClick={clickable ? () => onRowClick(r) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r); } } : undefined}
              >
                <td className="sym">{r.key}</td>
                <td style={{ textAlign: 'right' }}>{r.trades}</td>
                <td style={{ textAlign: 'right' }}>{fmtPct(r.winRate)}</td>
                <td style={{ textAlign: 'right' }}>{fmtPf(r.profitFactor)}</td>
                <td style={{ textAlign: 'right' }} className={r.netPnl > 0 ? 'pos' : r.netPnl < 0 ? 'neg' : 'muted'}>
                  <strong>{fmtMoney(r.netPnl)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Reports view — TradeZella-style performance breakdowns.
 * Props: analytics (from GET /api/analytics).
 */
function StatCard({ label, value, hint, tone }) {
  return (
    <div className="metric-card" key={label}>
      <div className="label">{label}</div>
      <div className={`value${tone ? ' ' + tone : ''}`}>{value}</div>
      {hint && <div className="muted report-hint">{hint}</div>}
    </div>
  );
}

export default function Reports({ analytics, statistics, playbook, drawdownCurve, onDrill, yearHeatmap, onPrevYear, onNextYear }) {
  if (!analytics) return <div className="empty-state">Loading reports…</div>;
  const { streaks, holdTime, winLoss } = analytics;

  if (analytics.overall.trades === 0) {
    return <div className="card"><div className="empty-state">No trades yet. Import a brokerage CSV to unlock reports.</div></div>;
  }

  const r = analytics.rMultiple;
  const summary = [
    { label: 'Win Streak (max)', value: `${streaks.longestWin}` },
    { label: 'Loss Streak (max)', value: `${streaks.longestLoss}` },
    {
      label: 'Current Streak',
      value: (
        <span className={streaks.current > 0 ? 'pos' : streaks.current < 0 ? 'neg' : 'muted'}>
          {streaks.current > 0 ? `${streaks.current}W` : streaks.current < 0 ? `${-streaks.current}L` : '—'}
        </span>
      ),
    },
    { label: 'Avg Hold', value: fmtDuration(holdTime.avgMinutes) },
    { label: 'Avg Hold · Wins', value: fmtDuration(holdTime.avgWinMinutes) },
    { label: 'Avg Hold · Losses', value: fmtDuration(holdTime.avgLossMinutes) },
  ];

  if (r && r.count > 0) {
    summary.push(
      { label: 'Expectancy (R)', value: <span className={r.expectancyR > 0 ? 'pos' : r.expectancyR < 0 ? 'neg' : ''}>{r.expectancyR.toFixed(2)}R</span> },
      { label: 'Best / Worst R', value: <span><span className="pos">{r.bestR.toFixed(2)}</span> / <span className="neg">{r.worstR.toFixed(2)}</span></span> },
      { label: 'Trades w/ Risk Set', value: `${r.count}` },
    );
  }

  const conc = analytics.concentration;
  if (conc && conc.topTradePct != null) {
    summary.push(
      { label: 'Top Trade % of Profit', value: `${Math.round(conc.topTradePct * 100)}%`, hint: 'concentration risk', tone: conc.topTradePct > 0.4 ? 'neg' : undefined },
      { label: 'Top Day % of Profit', value: `${Math.round(conc.topDayPct * 100)}%` },
    );
  }

  const st = statistics;
  const d = st && st.daily;

  const insights = buildInsights(analytics);

  return (
    <>
      {insights.length > 0 && (
        <>
          <div className="section-title">Insights</div>
          <div className="insights-grid">
            {insights.map((i) => (
              <div key={i.id} className={`insight insight-${i.tone}`}>
                <span className="insight-dot" />
                <span>{i.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {st && (
        <>
          <div className="section-title">Key Statistics</div>
          <div className="metrics-grid">
            <StatCard label="Expectancy / Trade" value={fmtMoney(st.expectancy)} tone={st.expectancy > 0 ? 'pos' : st.expectancy < 0 ? 'neg' : ''} hint="Avg P&L you can expect per trade" />
            <StatCard label="Payoff Ratio" value={fmtPf(st.payoffRatio)} hint="Avg win ÷ avg loss" />
            <StatCard label="Avg Win / Avg Loss" value={<span><span className="pos">{fmtMoney(st.avgWin)}</span> / <span className="neg">{fmtMoney(st.avgLoss)}</span></span>} />
            <StatCard label="Kelly Allocation" value={`${(st.kelly.clamped * 100).toFixed(1)}%`} hint={`Raw f* ${(st.kelly.fraction * 100).toFixed(1)}% · suggested size`} tone={st.kelly.fraction > 0 ? 'pos' : 'neg'} />
            <StatCard label="Sharpe (daily)" value={st.sharpe.toFixed(2)} tone={st.sharpe > 0 ? 'pos' : st.sharpe < 0 ? 'neg' : ''} hint="Return per unit of daily volatility" />
            <StatCard label="Total Commissions" value={fmtMoney(st.totalCommissions)} hint={`${st.totalVolume.toLocaleString()} shares/contracts traded`} />
          </div>

          {d && d.tradingDays > 0 && (
            <>
              <div className="section-title">Daily Performance</div>
              <div className="metrics-grid">
                <StatCard label="Trading Days" value={d.tradingDays} hint={`${d.avgTradesPerDay} trades/day avg`} />
                <StatCard label="Day Win Rate" value={fmtPct(d.dayWinRate)} hint={`${d.greenDays} green · ${d.redDays} red`} tone={d.dayWinRate >= 0.5 ? 'pos' : ''} />
                <StatCard label="Avg Daily P&L" value={fmtMoney(d.avgDailyPnl)} tone={d.avgDailyPnl > 0 ? 'pos' : d.avgDailyPnl < 0 ? 'neg' : ''} />
                <StatCard label="Best Day" value={<span className="pos">{fmtMoney(d.bestDay ? d.bestDay.pnl : 0)}</span>} hint={d.bestDay ? d.bestDay.date : ''} />
                <StatCard label="Worst Day" value={<span className="neg">{fmtMoney(d.worstDay ? d.worstDay.pnl : 0)}</span>} hint={d.worstDay ? d.worstDay.date : ''} />
                <StatCard label="Day Streak (G/R max)" value={<span><span className="pos">{d.maxGreenStreak}</span> / <span className="neg">{d.maxRedStreak}</span></span>} hint="Consecutive green / red days" />
              </div>
            </>
          )}
        </>
      )}

      <div className="section-title">Streaks &amp; Hold Time</div>
      <div className="metrics-grid">
        {summary.map((c) => (
          <div className="metric-card" key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>

      {winLoss && (
        <>
          <div className="section-title">Winners vs Losers</div>
          <div className="card winloss-card">
            <table className="report-table winloss-table">
              <thead>
                <tr>
                  <th></th>
                  <th style={{ textAlign: 'right' }} className="pos">Winners</th>
                  <th style={{ textAlign: 'right' }} className="neg">Losers</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Count</td><td style={{ textAlign: 'right' }}>{winLoss.winners.count}</td><td style={{ textAlign: 'right' }}>{winLoss.losers.count}</td></tr>
                <tr><td>Total P&amp;L</td><td style={{ textAlign: 'right' }} className="pos">{fmtMoney(winLoss.winners.total)}</td><td style={{ textAlign: 'right' }} className="neg">{fmtMoney(winLoss.losers.total)}</td></tr>
                <tr><td>Average</td><td style={{ textAlign: 'right' }} className="pos">{fmtMoney(winLoss.winners.avg)}</td><td style={{ textAlign: 'right' }} className="neg">{fmtMoney(winLoss.losers.avg)}</td></tr>
                <tr><td>Largest</td><td style={{ textAlign: 'right' }} className="pos">{fmtMoney(winLoss.winners.largest)}</td><td style={{ textAlign: 'right' }} className="neg">{fmtMoney(winLoss.losers.largest)}</td></tr>
                <tr><td>Avg Hold</td><td style={{ textAlign: 'right' }}>{fmtDuration(winLoss.winners.avgHoldMinutes)}</td><td style={{ textAlign: 'right' }}>{fmtDuration(winLoss.losers.avgHoldMinutes)}</td></tr>
              </tbody>
            </table>
            <div className="winloss-payoff">
              Payoff ratio <strong>{fmtPf(winLoss.payoffRatio)}</strong>
              <span className="muted"> (avg win / avg loss)</span>
            </div>
          </div>
        </>
      )}

      <div className="section-title">Drawdown (Underwater Equity)</div>
      <div className="card" style={{ padding: 14 }}>
        <DrawdownChart data={drawdownCurve} />
      </div>

      <div className="section-title">Yearly P&amp;L</div>
      <YearHeatmap data={yearHeatmap} onPrevYear={onPrevYear} onNextYear={onNextYear} />

      <div className="section-title">When You Trade — P&amp;L Heatmap</div>
      <Heatmap data={analytics.heatmap} />

      <div className="section-title">Performance Breakdowns</div>
      <div className="reports-grid">
        <BreakdownTable
          title="By Symbol" rows={analytics.bySymbol} keyLabel="Symbol"
          onRowClick={onDrill && ((r) => onDrill({ symbol: r.key }))}
        />
        <BreakdownTable
          title="By Side" rows={analytics.bySide} keyLabel="Side"
          onRowClick={onDrill && ((r) => onDrill({ side: r.key }))}
        />
        <BreakdownTable title="By Day of Week" rows={analytics.byDayOfWeek} keyLabel="Weekday" />
        <BreakdownTable title="By Hour of Day" rows={analytics.byHourOfDay} keyLabel="Hour" />
        <BreakdownTable
          title="By Tag" rows={analytics.byTag} keyLabel="Tag"
          onRowClick={onDrill && ((r) => onDrill({ tag: r.key }))}
          isRowClickable={(r) => r.key !== 'Untagged'}
        />
      </div>

      <div className="section-title">Setup Playbook</div>
      <PlaybookTable rows={playbook} onDrill={onDrill} />
    </>
  );
}

/**
 * Per-strategy performance with expectancy and average R — the table that tells
 * you which setups actually carry an edge. Rows come from GET /api/playbook.
 */
function PlaybookTable({ rows, onDrill }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card report-card">
        <div className="empty-state">
          No setups assigned yet. Tag trades with a setup in the trade log to build your playbook.
        </div>
      </div>
    );
  }
  return (
    <div className="card report-card">
      <h3>
        Performance by setup
        {onDrill && <span className="muted report-hint"> · click to filter</span>}
      </h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>Setup</th>
            <th style={{ textAlign: 'right' }}>Trades</th>
            <th style={{ textAlign: 'right' }}>Win%</th>
            <th style={{ textAlign: 'right' }}>PF</th>
            <th style={{ textAlign: 'right' }}>Expectancy</th>
            <th style={{ textAlign: 'right' }}>Avg R</th>
            <th style={{ textAlign: 'right' }}>Net P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clickable = Boolean(onDrill) && r.setup !== 'Unassigned';
            return (
              <tr
                key={r.setup}
                className={clickable ? 'report-row-clickable' : undefined}
                onClick={clickable ? () => onDrill({ setup: r.setup }) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrill({ setup: r.setup }); } } : undefined}
              >
                <td className="sym">{r.setup}</td>
                <td style={{ textAlign: 'right' }}>{r.trades}</td>
                <td style={{ textAlign: 'right' }}>{fmtPct(r.winRate)}</td>
                <td style={{ textAlign: 'right' }}>{fmtPf(r.profitFactor)}</td>
                <td style={{ textAlign: 'right' }} className={r.expectancy > 0 ? 'pos' : r.expectancy < 0 ? 'neg' : 'muted'}>
                  {fmtMoney(r.expectancy)}
                </td>
                <td style={{ textAlign: 'right' }} className={r.avgR > 0 ? 'pos' : r.avgR < 0 ? 'neg' : 'muted'}>
                  {r.avgR === null || r.avgR === undefined ? '—' : `${r.avgR.toFixed(2)}R`}
                </td>
                <td style={{ textAlign: 'right' }} className={r.netPnl > 0 ? 'pos' : r.netPnl < 0 ? 'neg' : 'muted'}>
                  <strong>{fmtMoney(r.netPnl)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
