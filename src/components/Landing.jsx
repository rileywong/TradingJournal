import React from 'react';

// Public marketing page shown to logged-out visitors. The whole pitch: a fast,
// lightweight trading journal whose edge is depth of statistics. CTAs hand off
// to the auth flow (onGetStarted / onSignIn switch <App> to <Auth>).

const FEATURES = [
  { icon: '📥', title: 'Import any broker', body: 'Drag in a CSV from ThinkOrSwim, Robinhood, Webull, or anything else. Fills are auto-matched into closed trades — splits, shorts, and position flips handled.' },
  { icon: '📊', title: '40+ statistics', body: 'Win rate, profit factor, expectancy, payoff ratio, Kelly sizing, daily Sharpe, R-multiples, drawdown — the numbers serious traders actually track.' },
  { icon: '🎯', title: 'Trade Score', body: 'One 0–100 grade blends win rate, profit factor, win/loss ratio, drawdown control, and consistency, so you know where you stand at a glance.' },
  { icon: '🗓️', title: 'Calendars & heatmaps', body: 'A P&L calendar with weekly roll-ups, a yearly heatmap, and a weekday × hour heatmap that shows exactly when you make money.' },
  { icon: '🧩', title: 'Setup playbook', body: 'Tag each trade with its strategy and see win%, profit factor, expectancy, and average R per setup. Double down on what works.' },
  { icon: '⚡', title: 'Options & futures', body: 'Correct contract multipliers for options (×100) and futures (point values), OCC symbol parsing, and net-vs-gross P&L toggles.' },
];

const STATS = [
  { k: 'Net P&L', v: '+$12,480', tone: 'pos' },
  { k: 'Win Rate', v: '58.6%' },
  { k: 'Profit Factor', v: '2.41' },
  { k: 'Trade Score', v: '78 · B', tone: 'accent' },
];

export default function Landing({ onGetStarted, onSignIn }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="dot" />
          <span>TradeJournal<small> Simplified</small></span>
        </div>
        <nav className="landing-nav-actions">
          <button className="btn-ghost" onClick={onSignIn}>Sign in</button>
          <button className="btn-primary landing-cta-sm" onClick={onGetStarted}>Get started</button>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-pill">Lightweight · stats-first</span>
          <h1>The trading journal with serious statistics.</h1>
          <p className="landing-sub">
            Import your trades, and instantly see the metrics that actually move your
            P&amp;L — expectancy, Kelly sizing, daily Sharpe, per-setup edge, and more.
            No bloat, no clutter. Just a fast, clean read on how you really trade.
          </p>
          <div className="landing-cta-row">
            <button className="btn-primary landing-cta" onClick={onGetStarted}>Start free</button>
            <button className="btn-ghost landing-cta" onClick={onSignIn}>I already have an account</button>
          </div>
          <p className="landing-fineprint">Free to start · no credit card required</p>
        </div>

        <div className="landing-hero-card" aria-hidden="true">
          <div className="lhc-head">
            <span className="dot" />
            <span>Dashboard</span>
          </div>
          <div className="lhc-stats">
            {STATS.map((s) => (
              <div className="lhc-stat" key={s.k}>
                <div className="lhc-k">{s.k}</div>
                <div className={`lhc-v ${s.tone || ''}`}>{s.v}</div>
              </div>
            ))}
          </div>
          <svg className="lhc-chart" viewBox="0 0 320 90" preserveAspectRatio="none">
            <polyline
              points="0,80 30,70 55,74 85,58 115,60 145,44 175,48 205,32 235,36 265,18 300,10 320,6"
              fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            />
            <polyline
              points="0,90 0,80 30,70 55,74 85,58 115,60 145,44 175,48 205,32 235,36 265,18 300,10 320,6 320,90"
              fill="#eef0fe" stroke="none"
            />
          </svg>
        </div>
      </section>

      <section className="landing-features">
        <h2>Everything you need to find your edge</h2>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <div className="landing-feature" key={f.title}>
              <div className="landing-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-why">
        <h2>Why TradeJournal Simplified?</h2>
        <div className="landing-why-grid">
          <div><strong>Lightweight by design.</strong> It loads fast, stays out of your way, and shows you the numbers without ten menus to dig through.</div>
          <div><strong>Statistics are the point.</strong> Most journals stop at win rate. We go deep — expectancy, Kelly, Sharpe, per-setup and per-session edge.</div>
          <div><strong>Your data, private.</strong> Every account is isolated to you. Import as many brokers as you want and roll them up into one view.</div>
        </div>
      </section>

      <section className="landing-final">
        <h2>See how you really trade.</h2>
        <button className="btn-primary landing-cta" onClick={onGetStarted}>Start free</button>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} TradeJournal Simplified</span>
      </footer>
    </div>
  );
}
