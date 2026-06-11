import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { distinctTags } from '../../core/filters.js';
import { useEscape } from '../useEscape.js';

/**
 * Manage an account's tags: rename or delete across all trades. Loads the full
 * (unscoped) tag set so management isn't limited by the dashboard period.
 *
 * Props: accountId, onClose, onChanged (called after a successful mutation).
 */
export default function TagManager({ accountId, onClose, onChanged }) {
  useEscape(onClose);
  const [tags, setTags] = useState(null);
  const [editing, setEditing] = useState(null); // tag being renamed
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const { trades } = await api.getTrades(accountId); // unscoped → all tags
    setTags(distinctTags(trades));
  }, [accountId]);

  useEffect(() => { reload().catch((e) => setError(e.message)); }, [reload]);

  const startRename = (tag) => { setEditing(tag); setDraft(tag); setError(''); };

  const doRename = async (from) => {
    const to = draft.trim();
    if (!to || to === from) { setEditing(null); return; }
    setBusy(true); setError('');
    try {
      await api.renameTag(accountId, from, to);
      setEditing(null);
      await reload();
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const doDelete = async (tag) => {
    setBusy(true); setError('');
    try {
      await api.removeTag(accountId, tag);
      setConfirmDelete(null);
      await reload();
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tag-manager" onClick={(e) => e.stopPropagation()}>
        <h2>Manage Tags</h2>
        {error && <div className="banner error" style={{ marginBottom: 12 }}>{error}</div>}
        {tags === null ? (
          <div className="empty-state">Loading tags…</div>
        ) : tags.length === 0 ? (
          <div className="empty-state">No tags yet. Tag a trade in the log to get started.</div>
        ) : (
          <ul className="tag-manager-list">
            {tags.map((tag) => (
              <li key={tag} className="tag-manager-row">
                {editing === tag ? (
                  <>
                    <input
                      autoFocus
                      className="tag-rename-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') doRename(tag); else if (e.key === 'Escape') setEditing(null); }}
                    />
                    <div className="tag-manager-actions">
                      <button className="btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                      <button className="btn-primary" onClick={() => doRename(tag)} disabled={busy}>Save</button>
                    </div>
                  </>
                ) : confirmDelete === tag ? (
                  <>
                    <span className="tag-pill">{tag}</span>
                    <div className="tag-manager-actions">
                      <button className="btn-ghost" onClick={() => setConfirmDelete(null)} disabled={busy}>Keep</button>
                      <button className="btn-danger" onClick={() => doDelete(tag)} disabled={busy}>Confirm remove</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="tag-pill">{tag}</span>
                    <div className="tag-manager-actions">
                      <button className="btn-ghost" onClick={() => startRename(tag)}>Rename</button>
                      <button className="btn-ghost" onClick={() => setConfirmDelete(tag)}>Delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
