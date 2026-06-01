import React, { useMemo, useRef, useState } from 'react';

const PRESET_TAGS = ['Breakout', 'Fading', 'Revenge Trade', 'Scalp', 'Swing', 'News'];

function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const COLUMNS = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'side', label: 'Side' },
  { key: 'quantity', label: 'Qty', num: true },
  { key: 'entryPrice', label: 'Entry', num: true },
  { key: 'exitPrice', label: 'Exit', num: true },
  { key: 'closedAt', label: 'Closed' },
  { key: 'netPnl', label: 'Net P&L', num: true },
  { key: 'risk', label: 'Risk / R', num: true, sortable: false },
  { key: 'tags', label: 'Tags', sortable: false },
];

function rMultiple(t) {
  const risk = Number(t.riskAmount);
  return Number.isFinite(risk) && risk > 0 ? t.netPnl / risk : null;
}

export default function TradesTable({ trades, onTag, onRisk, onTradeNote }) {
  const [sortKey, setSortKey] = useState('closedAt');
  const [sortDir, setSortDir] = useState('desc');
  const [adding, setAdding] = useState(null);
  const [editingRisk, setEditingRisk] = useState(null);
  const [noteOpen, setNoteOpen] = useState(null);
  // Set when Escape cancels an inline input, so the resulting blur doesn't commit.
  const cancelNextBlur = useRef(false);

  const sorted = useMemo(() => {
    const arr = [...trades];
    arr.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'closedAt') {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [trades, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Single commit path: both Enter and click-away blur the input, which commits
  // here exactly once. Escape sets cancelNextBlur so its blur is a no-op.
  const commitTag = (trade, raw) => {
    setAdding(null);
    const tag = (raw || '').trim();
    if (!tag || trade.tags.includes(tag)) return;
    onTag(trade.id, [...trade.tags, tag]);
  };
  const commitRisk = (trade, raw) => {
    setEditingRisk(null);
    const next = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(next) || next < 0) return;
    if (next === (trade.riskAmount || 0)) return;
    if (onRisk) onRisk(trade.id, next);
  };

  const removeTag = (trade, tag) => {
    onTag(trade.id, trade.tags.filter((t) => t !== tag));
  };

  if (trades.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">No trades yet. Import a brokerage CSV to get started.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <datalist id="preset-tags">
        {PRESET_TAGS.map((p) => <option key={p} value={p} />)}
      </datalist>
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                onClick={() => c.sortable !== false && toggleSort(c.key)}
                style={{ textAlign: c.num ? 'right' : 'left', cursor: c.sortable === false ? 'default' : 'pointer' }}
              >
                {c.label}
                {sortKey === c.key && <span className="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <React.Fragment key={t.id}>
            <tr>
              <td className="sym">{t.symbol}</td>
              <td><span className={`pill ${t.side.toLowerCase()}`}>{t.side}</span></td>
              <td style={{ textAlign: 'right' }}>{t.quantity}</td>
              <td style={{ textAlign: 'right' }}>${t.entryPrice.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>${t.exitPrice.toFixed(2)}</td>
              <td className="muted">{fmtDate(t.closedAt)}</td>
              <td style={{ textAlign: 'right' }} className={t.netPnl > 0 ? 'pos' : t.netPnl < 0 ? 'neg' : ''}>
                <strong>{fmtMoney(t.netPnl)}</strong>
              </td>
              <td style={{ textAlign: 'right' }}>
                {editingRisk === t.id ? (
                  <input
                    autoFocus
                    type="number"
                    min="0"
                    step="0.01"
                    className="risk-input"
                    defaultValue={t.riskAmount || ''}
                    placeholder="risk $"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                      else if (e.key === 'Escape') { cancelNextBlur.current = true; e.currentTarget.blur(); }
                    }}
                    onBlur={(e) => {
                      if (cancelNextBlur.current) { cancelNextBlur.current = false; setEditingRisk(null); return; }
                      commitRisk(t, e.target.value);
                    }}
                  />
                ) : (
                  <button className="risk-btn" onClick={() => setEditingRisk(t.id)} title="Set planned risk ($)">
                    {(() => {
                      const r = rMultiple(t);
                      return r === null ? (
                        <span className="muted">+ risk</span>
                      ) : (
                        <>
                          <strong className={r > 0 ? 'pos' : r < 0 ? 'neg' : ''}>{r.toFixed(2)}R</strong>
                          <span className="muted"> · ${t.riskAmount}</span>
                        </>
                      );
                    })()}
                  </button>
                )}
              </td>
              <td>
                <div className="tags">
                  {t.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                      <button onClick={() => removeTag(t, tag)} aria-label={`Remove ${tag}`}>×</button>
                    </span>
                  ))}
                  {adding === t.id ? (
                    <input
                      autoFocus
                      list="preset-tags"
                      className="tag-input"
                      placeholder="Tag or custom…"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                        else if (e.key === 'Escape') { cancelNextBlur.current = true; e.currentTarget.blur(); }
                      }}
                      onBlur={(e) => {
                        if (cancelNextBlur.current) { cancelNextBlur.current = false; setAdding(null); return; }
                        commitTag(t, e.target.value);
                      }}
                    />
                  ) : (
                    <button className="tag-add" onClick={() => setAdding(t.id)}>+ tag</button>
                  )}
                  {onTradeNote && (
                    <button
                      className={`note-toggle ${t.note ? 'has-note' : ''}`}
                      onClick={() => setNoteOpen(noteOpen === t.id ? null : t.id)}
                      title={t.note ? 'Edit note' : 'Add note'}
                    >
                      {t.note ? '📝 note' : '+ note'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
            {noteOpen === t.id && onTradeNote && (
              <tr className="trade-note-row">
                <td colSpan={COLUMNS.length}>
                  <TradeNote
                    key={t.id}
                    note={t.note || ''}
                    onSave={(text) => { onTradeNote(t.id, text); setNoteOpen(null); }}
                    onCancel={() => setNoteOpen(null)}
                  />
                </td>
              </tr>
            )}
          </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Inline per-trade journal note editor (shown in an expanded row). */
function TradeNote({ note, onSave, onCancel }) {
  const [text, setText] = useState(note);
  return (
    <div className="trade-note">
      <textarea
        autoFocus
        className="trade-note-input"
        placeholder="Notes on this trade — thesis, execution, what you'd do differently…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />
      <div className="trade-note-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(text)} disabled={text === note}>
          Save note
        </button>
      </div>
    </div>
  );
}
