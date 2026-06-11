import React, { useState } from 'react';
import { positionSize } from '../../core/calculator.js';
import { useEscape } from '../useEscape.js';

const money = (n) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Position-sizing tool: how many shares keep your loss within the risk budget,
// plus reward:risk when a target is set. Client-only (no API).
export default function RiskCalculator({ onClose, accountSize: initialAccount }) {
  useEscape(onClose);
  const [accountSize, setAccountSize] = useState(initialAccount ? String(Math.round(initialAccount)) : '');
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');

  const r = positionSize({ accountSize, riskPct, entry, stop, target });

  const Field = ({ label, value, onChange, placeholder, prefix }) => (
    <label className="calc-field">
      <span>{label}</span>
      <div className={`calc-input ${prefix ? 'has-prefix' : ''}`}>
        {prefix && <i>{prefix}</i>}
        <input type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      </div>
    </label>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal calc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Risk calculator</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="calc-grid">
          <Field label="Account size" value={accountSize} onChange={setAccountSize} placeholder="25000" prefix="$" />
          <Field label="Risk per trade" value={riskPct} onChange={setRiskPct} placeholder="1" prefix="%" />
          <Field label="Entry price" value={entry} onChange={setEntry} placeholder="100.00" prefix="$" />
          <Field label="Stop price" value={stop} onChange={setStop} placeholder="98.00" prefix="$" />
          <Field label="Target (optional)" value={target} onChange={setTarget} placeholder="106.00" prefix="$" />
        </div>

        {r ? (
          <div className="calc-result">
            <div className="calc-shares">
              <span className="calc-shares-num">{r.shares.toLocaleString()}</span>
              <span className="calc-shares-label">shares</span>
            </div>
            <div className="calc-stats">
              <div><span>Risk budget</span><b>{money(r.riskAmount)}</b></div>
              <div><span>Actual risk</span><b>{money(r.actualRisk)}</b></div>
              <div><span>Risk / share</span><b>{money(r.riskPerShare)}</b></div>
              <div><span>Position value</span><b>{money(r.positionValue)}</b></div>
              {r.rMultiple != null && <div><span>Reward : Risk</span><b className={r.rMultiple >= 1 ? 'pos' : 'neg'}>{r.rMultiple}R</b></div>}
              {r.targetProfit != null && <div><span>Target profit</span><b className="pos">{money(r.targetProfit)}</b></div>}
            </div>
          </div>
        ) : (
          <div className="calc-empty muted">Enter account size, risk %, entry, and stop to size your position.</div>
        )}
      </div>
    </div>
  );
}
