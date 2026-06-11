import React, { useState } from 'react';
import { api, getToken } from '../api.js';

// Account settings: change password, export data, delete account. Opened from
// the topbar. Self-serve data portability + deletion gated on auth only, so a
// locked-out (lapsed) user can still leave with their data.
export default function Settings({ user, onClose, onDeleted }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [pw, setPw] = useState({ state: 'idle', msg: '' });
  const [exporting, setExporting] = useState(false);
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
          <p className="settings-help">Download everything — accounts, trades, tags, and notes — as JSON.</p>
          <button className="btn-ghost settings-btn" onClick={exportData} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Export my data'}
          </button>
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
