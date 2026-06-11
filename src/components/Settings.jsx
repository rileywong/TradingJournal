import React, { useState, useEffect } from 'react';
import { api, getToken } from '../api.js';

// Account settings: change password, export data, delete account. Opened from
// the topbar. Self-serve data portability + deletion gated on auth only, so a
// locked-out (lapsed) user can still leave with their data.
export default function Settings({ user, onClose, onDeleted }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [pw, setPw] = useState({ state: 'idle', msg: '' });
  const [exporting, setExporting] = useState(false);
  const [restore, setRestore] = useState({ busy: false, msg: '' });
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('tjs_theme') || 'light'; } catch { return 'light'; }
  });
  const [digest, setDigest] = useState(null);
  useEffect(() => { api.getEmailPrefs().then((p) => setDigest(p.digest)).catch(() => {}); }, []);
  const toggleDigest = async () => {
    const next = !digest;
    setDigest(next);
    try { await api.setEmailPrefs(next); } catch { setDigest(!next); }
  };
  const applyTheme = (t) => {
    setTheme(t);
    try { localStorage.setItem('tjs_theme', t); } catch { /* ignore */ }
    if (t === 'light') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  const [confirm, setConfirm] = useState('');
  const [del, setDel] = useState({ busy: false, err: '' });

  const changePassword = async (e) => {
    e.preventDefault();
    setPw({ state: 'busy', msg: '' });
    try {
      await api.changePassword(cur, next);
      setPw({ state: 'done', msg: 'Password updated.' });
      setCur(''); setNext('');
    } catch (err) {
      setPw({ state: 'error', msg: err.message });
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/me/export', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'greenstreak-export.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* surfaced via the disabled state resetting */ } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDel({ busy: true, err: '' });
    try {
      await api.deleteMe();
      onDeleted();
    } catch (err) {
      setDel({ busy: false, err: err.message });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="settings-section">
          <div className="settings-label">Account</div>
          <div className="settings-email">{user.email}</div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Appearance</div>
          <div className="theme-toggle" role="group" aria-label="Theme">
            {['light', 'dark'].map((t) => (
              <button key={t} className={theme === t ? 'active' : ''} onClick={() => applyTheme(t)}>
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Emails</div>
          <label className="settings-switch">
            <span>Weekly performance digest</span>
            <input type="checkbox" checked={!!digest} disabled={digest === null} onChange={toggleDigest} />
          </label>
        </div>

        <div className="settings-section">
          <div className="settings-label">Change password</div>
          <form onSubmit={changePassword} className="settings-form">
            <input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            <input type="password" placeholder="New password (min 6)" value={next} onChange={(e) => setNext(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={pw.state === 'busy'}>
              {pw.state === 'busy' ? 'Saving…' : 'Update password'}
            </button>
          </form>
          {pw.msg && <p className={pw.state === 'error' ? 'settings-msg err' : 'settings-msg ok'}>{pw.msg}</p>}
        </div>

        <div className="settings-section">
          <div className="settings-label">Your data</div>
          <p className="settings-help">Download everything — accounts, trades, tags, and notes — as JSON, or restore a previous export.</p>
          <button className="btn-ghost settings-btn" onClick={exportData} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Export my data'}
          </button>
          <label className="btn-ghost settings-btn settings-restore">
            {restore.busy ? 'Restoring…' : 'Restore from export'}
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              disabled={restore.busy}
              onChange={async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                setRestore({ busy: true, msg: '' });
                try {
                  const data = JSON.parse(await file.text());
                  const r = await api.importData(data);
                  setRestore({ busy: false, msg: `Restored ${r.accounts} account(s), ${r.trades} trades.` });
                } catch (err) {
                  setRestore({ busy: false, msg: `Restore failed: ${err.message}` });
                }
                e.target.value = '';
              }}
            />
          </label>
          {restore.msg && <p className={/failed/i.test(restore.msg) ? 'settings-msg err' : 'settings-msg ok'}>{restore.msg}</p>}
        </div>

        <div className="settings-section danger">
          <div className="settings-label">Danger zone</div>
          <p className="settings-help">Permanently delete your account and all data. This can’t be undone.</p>
          <input
            className="settings-confirm"
            placeholder={`Type your email to confirm`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            className="btn-danger settings-btn"
            disabled={confirm.trim().toLowerCase() !== user.email || del.busy}
            onClick={deleteAccount}
          >
            {del.busy ? 'Deleting…' : 'Delete my account'}
          </button>
          {del.err && <p className="settings-msg err">{del.err}</p>}
        </div>
      </div>
    </div>
  );
}
