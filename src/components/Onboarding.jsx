import React from 'react';

// First-run guide shown to a brand-new user with no accounts yet. Turns the
// blank dashboard into a clear, three-step path to a populated app.
const STEPS = [
  { n: 1, title: 'Create an account', body: 'Add a trading account — one per broker. You can roll them all up into one view later.' },
  { n: 2, title: 'Import your trades', body: 'Drag in a CSV export from ThinkOrSwim, Robinhood, Webull, or any broker. Fills auto-match into closed trades.' },
  { n: 3, title: 'Explore your edge', body: 'Your Trade Score, stats, calendar, and reports populate instantly — no spreadsheets, no setup.' },
];

export default function Onboarding({ onCreate, onSample }) {
  const [sampling, setSampling] = React.useState(false);
  const loadSample = async () => {
    if (!onSample) return;
    setSampling(true);
    try { await onSample(); } catch { setSampling(false); }
  };
  return (
    <div className="onboard">
      <div className="onboard-card">
        <span className="landing-pill">Welcome to Greenstreak</span>
        <h1>Let’s get your trades in.</h1>
        <p className="onboard-sub">Three quick steps and your dashboard comes to life.</p>
        <ol className="onboard-steps">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="onboard-num">{s.n}</span>
              <div>
                <strong>{s.title}</strong>
                <span>{s.body}</span>
              </div>
            </li>
          ))}
        </ol>
        <button className="btn-primary onboard-cta" onClick={onCreate}>Create your first account</button>
        {onSample && (
          <button className="btn-ghost onboard-sample" onClick={loadSample} disabled={sampling}>
            {sampling ? 'Loading sample data…' : 'Or explore with sample data first →'}
          </button>
        )}
        <p className="onboard-hint muted">
          Sample data drops a demo account in your dashboard so you can look around. Delete it anytime.
        </p>
      </div>
    </div>
  );
}
