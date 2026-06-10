import React, { useState } from 'react';
import { api } from '../api.js';

const FEATURES = [
  'Unlimited CSV imports across every broker',
  'Multi-account dashboards & cross-account roll-ups',
  'Options & futures P&L, setup playbook, and full reports',
  'Trade Score, calendars, heatmaps, and journaling',
];

/**
 * Shown when the user's trial has lapsed (or a subscription expired). Starts a
 * checkout; with the dev billing provider it completes locally, otherwise it
 * redirects to the provider's hosted checkout.
 */
export default function Paywall({ billing, onActivated, onLogout }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const expired = billing?.status === 'expired';
  const headline = expired ? 'Your subscription has ended' : 'Your free trial has ended';

  const subscribe = async () => {
    setError('');
    setBusy(true);
    try {
      const session = await api.startCheckout();
      if (session.mock) {
        // Dev/local billing: complete the mock checkout in place.
        await api.mockCompleteCheckout();
        onActivated();
      } else if (session.url) {
        window.location.href = session.url; // hosted checkout (e.g. Stripe)
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card paywall-card">
        <div className="brand">
          <span className="dot" />
          <span>Tradelytics</span>
        </div>
        <h1>{headline}</h1>
        <p className="sub">Subscribe to keep analyzing your trades. Cancel anytime.</p>

        <div className="price-tag">
          <span className="price-amount">$19</span>
          <span className="price-period">/ month</span>
        </div>

        <ul className="paywall-features">
          {FEATURES.map((f) => <li key={f}>{f}</li>)}
        </ul>

        {error && <div className="banner error" style={{ marginBottom: 12 }}>{error}</div>}

        <button className="btn-primary" onClick={subscribe} disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Starting checkout…' : 'Subscribe now'}
        </button>
        <div className="auth-switch">
          Wrong account?
          <button onClick={onLogout}>Log out</button>
        </div>
      </div>
    </div>
  );
}
