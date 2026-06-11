import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const money = (n) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);
const date = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_LABEL = {
  active: 'Active', trialing: 'Trialing', past_due: 'Past due',
  trial_expired: 'Trial expired', expired: 'Expired', none: 'No trial',
};

const FUNNEL_ROWS = [
  ['active', 'Active (paying)'],
  ['trialing', 'Trialing'],
  ['past_due', 'Past due (grace)'],
  ['trial_expired', 'Trial expired'],
  ['expired', 'Subscription expired'],
  ['none', 'No trial'],
];

/**
 * Site-wide admin overview: user/revenue/engagement KPIs, the subscription
 * funnel, a 30-day signup sparkline, and recent signups. Data comes from the
 * admin-gated /api/admin/stats endpoint.
 */
export default function AdminDashboard({ onBack }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminStats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="container">
        <div className="banner error">Couldn't load admin stats: {error}</div>
        <button className="btn-ghost" onClick={onBack} style={{ marginTop: 14 }}>← Back to app</button>
      </div>
    );
  }
  if (!stats) return <div className="container"><div className="empty-state">Loading site stats…</div></div>;

  const { totalUsers, signups, funnel, revenue, conversion, engagement, funnelStages = [], waitlistCount = 0, signupSeries, recentSignups, generatedAt } = stats;
  const maxDay = Math.max(1, ...signupSeries.map((d) => d.count));

  return (
    <div className="container admin">
      <div className="admin-head">
        <div>
          <div className="section-title" style={{ margin: 0 }}>Site Admin</div>
          <h1 className="admin-title">Overview</h1>
        </div>
        <button className="btn-ghost" onClick={onBack}>← Back to app</button>
      </div>

      <div className="metrics-grid">
        <Kpi label="Total users" value={totalUsers.toLocaleString()} sub={`${signups.last30} new in 30d`} />
        <Kpi label="Paying subscribers" value={revenue.payingUsers.toLocaleString()} sub={`${pct(conversion.rate)} trial → paid`} />
        <Kpi label="MRR" value={money(revenue.mrr)} sub={`${money(revenue.arr)} ARR`} accent />
        <Kpi label="Active trials" value={funnel.trialing.toLocaleString()} sub={`${funnel.past_due} in payment grace`} />
        <Kpi label="Activated users" value={engagement.usersWithData.toLocaleString()} sub="imported ≥ 1 trade" />
        <Kpi label="Waitlist" value={waitlistCount.toLocaleString()} sub="interested · not signed up" />
      </div>

      <div className="section-title">Acquisition funnel</div>
      <div className="card admin-panel">
        <div className="afunnel">
          {funnelStages.map((s, i) => (
            <div className="afunnel-row" key={s.key}>
              <div className="afunnel-head">
                <span className="afunnel-label">{s.label}</span>
                <span className="afunnel-count">
                  {s.count.toLocaleString()}
                  <span className="afunnel-pct">{pct(s.pctOfTop)} of signups</span>
                </span>
              </div>
              <div className="afunnel-track">
                <span style={{ width: `${Math.max(2, Math.round(s.pctOfTop * 100))}%` }} />
              </div>
              {i > 0 && (
                <div className="afunnel-drop">
                  {s.droppedFromPrev > 0
                    ? `↓ ${s.droppedFromPrev.toLocaleString()} dropped off (${pct(s.pctOfPrev)} continued)`
                    : `↓ ${pct(s.pctOfPrev)} continued`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">New signups (last 30 days)</div>
      <div className="card admin-panel">
        <div className="admin-signup-stats">
          <div><b>{signups.today}</b><span>today</span></div>
          <div><b>{signups.last7}</b><span>last 7 days</span></div>
          <div><b>{signups.last30}</b><span>last 30 days</span></div>
        </div>
        <div className="admin-spark" role="img" aria-label="Daily signups, last 30 days">
          {signupSeries.map((d) => (
            <div key={d.date} className="admin-spark-bar" title={`${d.date}: ${d.count} signup${d.count === 1 ? '' : 's'}`}>
              <span style={{ height: `${(d.count / maxDay) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">Subscription funnel</div>
      <div className="card admin-panel">
        <div className="admin-funnel">
          {FUNNEL_ROWS.map(([key, label]) => (
            <div key={key} className="admin-funnel-row">
              <span className={`admin-dot st-${key}`} />
              <span className="admin-funnel-label">{label}</span>
              <span className="admin-funnel-count">{(funnel[key] || 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">Recent signups</div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Email</th><th>Joined</th><th>Status</th><th>Auth</th>
              <th style={{ textAlign: 'right' }}>Trades</th>
            </tr>
          </thead>
          <tbody>
            {recentSignups.map((u) => (
              <tr key={u.email}>
                <td>{u.email}</td>
                <td className="muted">{date(u.createdAt)}</td>
                <td><span className={`admin-badge st-${u.status}`}>{STATUS_LABEL[u.status] || u.status}</span></td>
                <td className="muted">{u.oauth ? 'SSO' : 'Email'}</td>
                <td style={{ textAlign: 'right' }}>{u.tradeCount}</td>
              </tr>
            ))}
            {recentSignups.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 22 }}>No signups yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="muted admin-generated">Generated {new Date(generatedAt).toLocaleString()}</div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="metric-card">
      <div className="label">{label}</div>
      <div className="value" style={accent ? { color: 'var(--positive)' } : undefined}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
