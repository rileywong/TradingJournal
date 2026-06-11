import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const pct = (r) => `${Math.round((r || 0) * 100)}%`;
const clamp = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

function Progress({ label, cur, goal, pctVal, done }) {
  return (
    <div className="goal-row">
      <div className="goal-row-head">
        <span>{label}</span>
        <span><b>{cur}</b> <span className="muted">/ {goal}</span></span>
      </div>
      <div className="goal-track"><span className={done ? 'done' : ''} style={{ width: `${pctVal}%` }} /></div>
    </div>
  );
}

// Monthly P&L / win-rate goals with month-to-date progress. Self-fetching;
// re-fetches when `refreshKey` changes (e.g. after an import).
export default function GoalsCard({ refreshKey }) {
  const [g, setG] = useState(null);
  const [editing, setEditing] = useState(false);
  const [pnl, setPnl] = useState('');
  const [wr, setWr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.getGoals().then(setG).catch(() => {});
  useEffect(() => { load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!g) return null;

  const startEdit = () => {
    setPnl(g.goalMonthlyPnl ?? '');
    setWr(g.goalWinRate != null ? Math.round(g.goalWinRate * 100) : '');
    setEditing(true);
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.setGoals({
        goalMonthlyPnl: pnl === '' ? null : Number(pnl),
        goalWinRate: wr === '' ? null : Number(wr) / 100,
      });
      await load();
      setEditing(false);
    } finally { setBusy(false); }
  };

  const hasGoals = g.goalMonthlyPnl != null || g.goalWinRate != null;
  const delta = g.lastMonth ? g.mtd.netPnl - g.lastMonth.netPnl : null;
  const comparison = g.lastMonth && (g.lastMonth.trades > 0 || g.mtd.trades > 0) ? (
    <div className="goals-compare">
      <span>vs last month <b>{money(g.lastMonth.netPnl)}</b></span>
      <span className={delta >= 0 ? 'pos' : 'neg'}>{delta >= 0 ? '▲' : '▼'} {money(Math.abs(delta))}</span>
    </div>
  ) : null;

  return (
    <div className="card goals-card">
      <div className="goals-head">
        <h3>This month vs goal</h3>
        <button className="btn-ghost goals-edit" onClick={editing ? () => setEditing(false) : startEdit}>
          {editing ? 'Cancel' : hasGoals ? 'Edit' : 'Set goals'}
        </button>
      </div>

      {editing ? (
        <form className="goals-form" onSubmit={save}>
          <label>Monthly P&amp;L goal ($)
            <input type="number" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="e.g. 5000" />
          </label>
          <label>Win-rate goal (%)
            <input type="number" min="0" max="100" value={wr} onChange={(e) => setWr(e.target.value)} placeholder="e.g. 55" />
          </label>
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save goals'}</button>
        </form>
      ) : hasGoals ? (
        <div className="goals-bars">
          {g.goalMonthlyPnl != null && (
            <Progress label="Net P&L" cur={money(g.mtd.netPnl)} goal={money(g.goalMonthlyPnl)}
              pctVal={clamp((g.mtd.netPnl / g.goalMonthlyPnl) * 100)} done={g.mtd.netPnl >= g.goalMonthlyPnl} />
          )}
          {g.goalWinRate != null && (
            <Progress label="Win rate" cur={pct(g.mtd.winRate)} goal={pct(g.goalWinRate)}
              pctVal={clamp((g.mtd.winRate / g.goalWinRate) * 100)} done={g.mtd.winRate >= g.goalWinRate} />
          )}
          <div className="goals-foot muted">{g.mtd.trades} trade{g.mtd.trades === 1 ? '' : 's'} this month</div>
          {comparison}
        </div>
      ) : (
        <div>
          <p className="goals-empty muted">Set a monthly P&amp;L or win-rate target to track your progress.</p>
          {comparison}
        </div>
      )}
    </div>
  );
}
