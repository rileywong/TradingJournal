import React, { useRef, useState } from 'react';
import { api } from '../api.js';

// Canonical fields the matcher needs. action & commission are optional —
// action can be inferred from the quantity sign, commission defaults to 0.
const FIELD_LABELS = {
  symbol: 'Symbol *',
  action: 'Side / action',
  quantity: 'Quantity *',
  price: 'Price *',
  commission: 'Commission',
  executedAt: 'Date / time *',
};
const FIELD_ORDER = ['symbol', 'action', 'quantity', 'price', 'commission', 'executedAt'];

export default function ImportPanel({ accountId, onImported }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('replace');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [csvText, setCsvText] = useState(''); // last selected file, for mapping
  const [preview, setPreview] = useState(null); // inspectCsv result
  const [mapping, setMapping] = useState({});
  const inputRef = useRef(null);

  const runImport = async (csv, map) => {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const res = await api.importCsv(accountId, csv, undefined, mode, map);
      setResult(res);
      if (res.imported.executions > 0) {
        setPreview(null); // mapping worked — close the mapper
      }
      onImported(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    const csv = await file.text();
    setCsvText(csv);
    setPreview(null);
    runImport(csv);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const openMapper = async () => {
    if (!csvText) {
      setError('Choose a CSV file first, then map its columns.');
      return;
    }
    setError('');
    try {
      const info = await api.previewCsv(csvText);
      setPreview(info);
      setMapping(info.suggested || {});
    } catch (err) {
      setError(err.message);
    }
  };

  const canImportMapping = mapping.symbol && mapping.quantity && mapping.price && mapping.executedAt;

  return (
    <div className="import-panel">
      <div className="import-mode" role="group" aria-label="Import mode">
        {[['replace', 'Replace account'], ['append', 'Add to existing']].map(([key, label]) => (
          <label key={key} className={`import-mode-opt ${mode === key ? 'active' : ''}`}>
            <input
              type="radio"
              name="import-mode"
              value={key}
              checked={mode === key}
              onChange={() => setMode(key)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>
        {mode === 'append'
          ? 'Merges this file with the account — combine multiple brokers; re-uploads de-dupe.'
          : 'Replaces all trades in this account with this file.'}
      </div>
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{ cursor: 'pointer' }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <div style={{ fontWeight: 700 }}>
          {busy ? 'Importing…' : 'Drop a brokerage CSV here, or click to browse'}
        </div>
        <div className="hint">ThinkOrSwim · Robinhood · Webull · generic exports auto-detected</div>
      </div>

      {csvText && !preview && (
        <button type="button" className="link-btn" onClick={openMapper} style={{ marginTop: 8 }}>
          Columns not detected correctly? Map them manually →
        </button>
      )}

      {preview && (
        <div className="col-mapper">
          <div className="col-mapper-head">
            <strong>Map columns</strong>
            <button type="button" className="link-btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
          <div className="hint" style={{ marginBottom: 10 }}>
            Detected as <code>{preview.detectedBroker}</code>. Match each field to a column
            from your file (* required).
          </div>
          <div className="col-mapper-grid">
            {FIELD_ORDER.map((field) => (
              <label key={field} className="col-mapper-row">
                <span>{FIELD_LABELS[field]}</span>
                <select
                  value={mapping[field] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                >
                  <option value="">— none —</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {preview.sampleRows?.length > 0 && (
            <div className="col-mapper-sample">
              <table>
                <thead>
                  <tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={!canImportMapping || busy}
            onClick={() => runImport(csvText, mapping)}
            style={{ marginTop: 12 }}
          >
            {busy ? 'Importing…' : 'Import with this mapping'}
          </button>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      {result && (
        <div className="import-result">
          <div className="banner ok">
            {result.mode === 'append'
              ? `Added ${result.addedExecutions} executions (${result.broker}) — account now has ${result.imported.trades} trade${result.imported.trades !== 1 ? 's' : ''} from ${result.imported.executions} executions.`
              : `Imported ${result.imported.trades} trade${result.imported.trades !== 1 ? 's' : ''} from ${result.imported.executions} executions (${result.broker}).`}
            {result.accountBrokers?.length > 1 && (
              <div style={{ marginTop: 4, fontWeight: 600 }}>
                Merged {result.accountBrokers.length} brokers: {result.accountBrokers.join(', ')}.
              </div>
            )}
          </div>
          {result.errors?.length > 0 && (
            <div className="banner error" style={{ marginTop: 8 }}>
              {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped:{' '}
              {result.errors.slice(0, 3).map((e) => `row ${e.row} (${e.reason})`).join(', ')}
              {result.errors.length > 3 ? '…' : ''}
            </div>
          )}
          {result.openPositions?.length > 0 && (
            <div className="banner" style={{ marginTop: 8, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {result.openPositions.length} open position{result.openPositions.length !== 1 ? 's' : ''} not yet closed:{' '}
              {result.openPositions.map((p) => `${p.symbol} (${p.position})`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
