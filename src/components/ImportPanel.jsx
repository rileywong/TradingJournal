import React, { useRef, useState } from 'react';
import { api } from '../api.js';

export default function ImportPanel({ accountId, onImported }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const csv = await file.text();
      const res = await api.importCsv(accountId, csv);
      setResult(res);
      onImported(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  return (
    <div className="import-panel">
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

      {error && <div className="banner error">{error}</div>}

      {result && (
        <div className="import-result">
          <div className="banner ok">
            Imported {result.imported.trades} trade{result.imported.trades !== 1 ? 's' : ''} from{' '}
            {result.imported.executions} executions ({result.broker}).
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
