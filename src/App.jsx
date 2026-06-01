import React, { useState, useEffect, useCallback } from 'react';
import { api, getStoredUser, clearSession } from './api.js';
import Auth from './components/Auth.jsx';
import MetricsGrid from './components/MetricsGrid.jsx';
import PnlCalendar from './components/PnlCalendar.jsx';
import TradeLog from './components/TradeLog.jsx';
import ImportPanel from './components/ImportPanel.jsx';
import DayDetail from './components/DayDetail.jsx';
import EquityChart from './components/EquityChart.jsx';
import Reports from './components/Reports.jsx';
import ScoreCard from './components/ScoreCard.jsx';

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [score, setScore] = useState(null);
  const [equityCurve, setEquityCurve] = useState([]);
  const [drawdownCurve, setDrawdownCurve] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [view, setView] = useState('dashboard');
  const [trades, setTrades] = useState([]);
  const [calendar, setCalendar] = useState(null);
  const [notedDays, setNotedDays] = useState([]);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dayDetail, setDayDetail] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);

  // Load accounts on login
  useEffect(() => {
    if (!user) return;
    api.listAccounts().then(({ accounts }) => {
      setAccounts(accounts);
      if (accounts.length > 0) setActiveId((id) => id || accounts[0].id);
      else setShowNewAccount(true);
    }).catch(() => logout());
  }, [user]);

  // The core state-transition: refresh metrics + trades + calendar together.
  const refreshDashboard = useCallback(async (accountId, cur) => {
    if (!accountId) return;
    const [m, t, c, a] = await Promise.all([
      api.getMetrics(accountId),
      api.getTrades(accountId),
      api.getCalendar(accountId, cur.year, cur.month),
      api.getAnalytics(accountId),
    ]);
    setMetrics(m.metrics);
    setScore(m.score || null);
    setEquityCurve(m.equityCurve || []);
    setDrawdownCurve(m.drawdownCurve || []);
    setTrades(t.trades);
    setCalendar(c.calendar);
    setNotedDays(c.notedDays || []);
    setAnalytics(a.analytics);
  }, []);

  useEffect(() => {
    if (activeId) refreshDashboard(activeId, cursor);
  }, [activeId, cursor, refreshDashboard]);

  // Switching accounts closes any open day drill-down (it belonged to the
  // previous account's dataset).
  useEffect(() => {
    setSelectedDate(null);
    setDayDetail(null);
  }, [activeId]);

  const logout = () => {
    clearSession();
    setUser(null);
    setAccounts([]);
    setActiveId(null);
    setMetrics(null);
    setScore(null);
    setEquityCurve([]);
    setDrawdownCurve([]);
    setAnalytics(null);
    setTrades([]);
    setCalendar(null);
    setNotedDays([]);
    setSelectedDate(null);
    setDayDetail(null);
  };

  const onTag = async (id, tags) => {
    const { trade } = await api.tagTrade(id, tags);
    setTrades((prev) => prev.map((t) => (t.id === trade.id ? trade : t)));
    // Keep an open day drill-down in sync with the tag edit.
    setDayDetail((prev) =>
      prev ? { ...prev, trades: prev.trades.map((t) => (t.id === trade.id ? trade : t)) } : prev
    );
  };

  const openDay = useCallback(async (date) => {
    if (!activeId) return;
    setSelectedDate((prev) => {
      // Switching to a different day: drop the previous day's stale detail so the
      // panel header doesn't show the old date/P&L while the new day loads.
      if (prev !== date) setDayDetail(null);
      return date;
    });
    setDayLoading(true);
    try {
      const detail = await api.getDay(activeId, date);
      setDayDetail(detail);
    } catch {
      // Failed to load: fully close the drill-down (don't leave selectedDate
      // dangling, which would auto-reopen on the next import).
      setDayDetail(null);
      setSelectedDate(null);
    } finally {
      setDayLoading(false);
    }
  }, [activeId]);

  const closeDay = () => {
    setSelectedDate(null);
    setDayDetail(null);
  };

  const saveDayNote = useCallback(async (date, note) => {
    if (!activeId) return;
    const { note: saved } = await api.setDayNote(activeId, date, note);
    // Reflect the saved note in the open panel and the calendar's note dots.
    setDayDetail((prev) => (prev && prev.date === date ? { ...prev, note: saved } : prev));
    setNotedDays((prev) => {
      const has = prev.includes(date);
      if (saved && !has) return [...prev, date];
      if (!saved && has) return prev.filter((d) => d !== date);
      return prev;
    });
  }, [activeId]);

  const shiftMonth = (delta) => {
    setCursor((c) => {
      let month = c.month + delta;
      let year = c.year;
      if (month < 1) { month = 12; year -= 1; }
      if (month > 12) { month = 1; year += 1; }
      return { year, month };
    });
  };

  if (!user) return <Auth onAuthed={setUser} />;

  const activeAccount = accounts.find((a) => a.id === activeId);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>TradeJournal<small> Simplified</small></span>
        </div>
        <div className="topbar-right">
          {accounts.length > 0 && (
            <select value={activeId || ''} onChange={(e) => setActiveId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          {activeAccount && (
            <button
              className="btn-ghost"
              onClick={() => setEditAccount(activeAccount)}
              title="Edit account settings"
              aria-label="Edit account"
            >
              ⚙
            </button>
          )}
          <button className="btn-ghost" onClick={() => setShowNewAccount(true)}>+ Account</button>
          <span className="muted">{user.email}</span>
          <button className="btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </div>

      <div className="container">
        {!activeAccount ? (
          <div className="empty-state">Create an account to begin tracking trades.</div>
        ) : (
          <>
            <div className="tabs">
              <button
                className={`tab ${view === 'dashboard' ? 'active' : ''}`}
                onClick={() => setView('dashboard')}
              >
                Dashboard
              </button>
              <button
                className={`tab ${view === 'reports' ? 'active' : ''}`}
                onClick={() => setView('reports')}
              >
                Reports
              </button>
            </div>

            {view === 'dashboard' ? (
              <>
                <div className="section-title">Performance Snapshot</div>
                <ScoreCard score={score} />
                <MetricsGrid metrics={metrics} />

                <div className="section-title">Equity Curve</div>
                <div className="card" style={{ padding: 14 }}>
                  <EquityChart data={equityCurve} />
                </div>

                <div className="section-title">This Month &amp; Import</div>
                <div className="row">
                  <PnlCalendar
                    calendar={calendar}
                    notedDays={notedDays}
                    onPrev={() => shiftMonth(-1)}
                    onNext={() => shiftMonth(1)}
                    onSelectDay={openDay}
                    selectedDate={selectedDate}
                  />
                  <div className="card" style={{ padding: 18 }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>Import Trades</h3>
                    <ImportPanel
                      accountId={activeId}
                      onImported={() => {
                        refreshDashboard(activeId, cursor);
                        if (selectedDate) openDay(selectedDate);
                      }}
                    />
                  </div>
                </div>

                <div className="section-title">Trade Log</div>
                <TradeLog trades={trades} onTag={onTag} />
              </>
            ) : (
              <Reports analytics={analytics} drawdownCurve={drawdownCurve} />
            )}
          </>
        )}
      </div>

      {(dayDetail || dayLoading) && (
        <DayDetail
          day={dayDetail}
          loading={dayLoading}
          onClose={closeDay}
          onTag={onTag}
          onSaveNote={saveDayNote}
        />
      )}

      {showNewAccount && (
        <AccountModal
          onClose={() => setShowNewAccount(false)}
          onSaved={(acct) => {
            setAccounts((prev) => [...prev, acct]);
            setActiveId(acct.id);
            setShowNewAccount(false);
          }}
        />
      )}

      {editAccount && (
        <AccountModal
          account={editAccount}
          onClose={() => setEditAccount(null)}
          onSaved={(acct) => {
            setAccounts((prev) => prev.map((a) => (a.id === acct.id ? acct : a)));
            setEditAccount(null);
            // Starting balance / commission affect the snapshot — refresh.
            refreshDashboard(acct.id, cursor);
          }}
          onDeleted={(id) => {
            setEditAccount(null);
            setAccounts((prev) => {
              const next = prev.filter((a) => a.id !== id);
              if (activeId === id) setActiveId(next[0]?.id || null);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

/** Create (no `account`) or edit (with `account`) an account; edit mode can delete. */
function AccountModal({ account, onClose, onSaved, onDeleted }) {
  const editing = Boolean(account);
  const [name, setName] = useState(account?.name ?? 'Main Account');
  const [startingBalance, setStartingBalance] = useState(account?.startingBalance ?? 10000);
  const [commissionPerTrade, setCommissionPerTrade] = useState(account?.commissionPerTrade ?? 0);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        name,
        startingBalance: Number(startingBalance),
        commissionPerTrade: Number(commissionPerTrade),
      };
      const { account: saved } = editing
        ? await api.updateAccount(account.id, body)
        : await api.createAccount(body);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api.deleteAccount(account.id);
      onDeleted(account.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? 'Account Settings' : 'New Account'}</h2>
        {error && <div className="banner error" style={{ marginBottom: 12 }}>{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Account name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Starting balance ($)</label>
            <input type="number" value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} min="0" step="0.01" />
          </div>
          <div className="field">
            <label>Simulated commission per trade ($)</label>
            <input type="number" value={commissionPerTrade} onChange={(e) => setCommissionPerTrade(e.target.value)} min="0" step="0.01" />
          </div>
          <div className="modal-actions">
            {editing && !confirmDelete && (
              <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)} disabled={busy} style={{ marginRight: 'auto' }}>
                Delete
              </button>
            )}
            {editing && confirmDelete && (
              <button type="button" className="btn-danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
                {busy ? 'Deleting…' : 'Confirm delete — this erases all its trades'}
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
