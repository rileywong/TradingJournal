import React, { useMemo, useState } from 'react';

const PRESET_TAGS = ['Breakout', 'Fading', 'Revenge Trade', 'Scalp', 'Swing', 'News'];

function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  { key: 'tags', label: 'Tags', sortable: false },
];

export default function TradesTable({ trades, onTag }) {
  const [sortKey, setSortKey] = useState('closedAt');
  const [sortDir, setSortDir] = useState('desc');
  const [adding, setAdding] = useState(null);

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

  const addTag = (trade, raw) => {
    const tag = (raw || '').trim();
    setAdding(null);
    if (!tag || trade.tags.includes(tag)) return;
    onTag(trade.id, [...trade.tags, tag]);
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
            <tr key={t.id}>
              <td className="sym">{t.symbol}</td>
              <td><span className={`pill ${t.side.toLowerCase()}`}>{t.side}</span></td>
              <td style={{ textAlign: 'right' }}>{t.quantity}</td>
              <td style={{ textAlign: 'right' }}>${t.entryPrice.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>${t.exitPrice.toFixed(2)}</td>
              <td className="muted">{fmtDate(t.closedAt)}</td>
              <td style={{ textAlign: 'right' }} className={t.netPnl > 0 ? 'pos' : t.netPnl < 0 ? 'neg' : ''}>
                <strong>{fmtMoney(t.netPnl)}</strong>
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
                        if (e.key === 'Enter') addTag(t, e.target.value);
                        else if (e.key === 'Escape') setAdding(null);
                      }}
                      onBlur={(e) => addTag(t, e.target.value)}
                    />
                  ) : (
                    <button className="tag-add" onClick={() => setAdding(t.id)}>+ tag</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
