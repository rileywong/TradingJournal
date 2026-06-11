import React, { useEffect } from 'react';
import { api } from '../api.js';
import FeatureTour from './FeatureTour.jsx';

// Public marketing page shown to logged-out visitors. Positioning: serious,
// quant-grade analytics in a fast, clean journal that imports (and merges) any
// broker — at a fraction of the incumbents' price. CTAs hand off to the auth
// flow (onGetStarted / onSignIn) or seed a no-signup demo (onDemo).

const HOW_IT_WORKS = [
  { n: 1, title: 'Import your trades', body: 'Drag in a CSV from any broker. Greenstreak auto-detects the format and matches your fills into closed trades — splits, shorts, and flips handled.' },
  { n: 2, title: 'See your real numbers', body: 'Instantly get 40+ statistics, your Trade Score, calendars, and heatmaps. No setup, no spreadsheets, no formulas.' },
  { n: 3, title: 'Find & refine your edge', body: 'Tag setups, journal sessions, and double down on the strategies and time-windows that actually make you money.' },
];

const PILLARS = [
  {
    icon: '📈',
    title: 'Statistics, not just a logbook',
    body: 'Expectancy, Kelly sizing, daily Sharpe, R-multiples, payoff ratio, per-setup edge. The math a desk would run on your trades — most journals stop at win rate.',
  },
  {
    icon: '🔗',
    title: 'Every broker, merged into one',
    body: 'Import ThinkOrSwim, Robinhood, Webull, or any CSV. Greenstreak re-derives trades from your combined fills, so a position opened on one broker and closed on another still matches.',
  },
  {
    icon: '⚡',
    title: 'Fast, focused, $10/mo',
    body: 'No bloat, no ten-menu setup. A clean read on how you really trade — for a fraction of what the $40/mo journals charge.',
  },
];

const FEATURES = [
  { icon: '📥', title: 'Smart CSV import', body: 'Auto-detects your broker, tolerantly parses messy exports, and routes bad rows aside instead of failing. Re-uploads de-dupe; unknown formats get a manual column mapper.' },
  { icon: '🧮', title: '40+ pro statistics', body: 'Win rate, profit factor, expectancy, payoff ratio, Kelly, daily Sharpe, R-multiple, trade economics, win/loss streaks, hold-time — scoped by period and net/gross.' },
  { icon: '🎯', title: 'Trade Score', body: 'One 0–100 grade blends win rate, profit factor, win/loss ratio, drawdown control, and consistency, so you know where you stand at a glance.' },
  { icon: '🗓️', title: 'Calendars & heatmaps', body: 'A P&L calendar with weekly roll-ups, a GitHub-style yearly heatmap, and a weekday × hour heatmap that shows exactly when you make money.' },
  { icon: '🧩', title: 'Setup playbook', body: 'Tag each trade with its strategy and see win%, profit factor, expectancy, and average R per setup. Double down on what works, cut what doesn’t.' },
  { icon: '📝', title: 'Journaling that sticks', body: 'Per-trade and per-day notes, durable tags and planned risk — all survive re-imports, so your context is never wiped when you upload fresh fills.' },
  { icon: '⚙️', title: 'Options & futures', body: 'Correct contract multipliers (options ×100, futures point values), OCC symbol parsing for underlying/expiry/strike, and net-vs-gross P&L toggles.' },
  { icon: '🗂️', title: 'Multi-account roll-ups', body: 'Keep an account per broker, then switch to “All accounts” for a combined dashboard, score, calendar, and reports across your whole book.' },
];

const DEEPER = [
  'Expectancy & R-multiple per trade',
  'Kelly position sizing',
  'Daily Sharpe ratio',
  'Weekday × hour P&L heatmap',
  'Per-setup playbook analytics',
  'Cross-broker trade merging',
];

const HERO_STATS = [
  { k: 'Net P&L', v: '+$12,480', tone: 'pos' },
  { k: 'Win Rate', v: '58.6%' },
  { k: 'Profit Factor', v: '2.41' },
  { k: 'Trade Score', v: '78 · B', tone: 'accent' },
];

const PRICE_INCLUDES = [
  'Unlimited CSV imports, every broker',
  'All 40+ statistics & reports',
  'Trade Score, calendars & heatmaps',
  'Setup playbook & journaling',
  'Multi-account roll-ups',
  'Options & futures support',
];

// Reveal-on-scroll: fade/slide elements in as they enter the viewport.
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function Landing({ onGetStarted, onSignIn, onDemo }) {
  const [demoBusy, setDemoBusy] = React.useState(false);
  const [wlEmail, setWlEmail] = React.useState('');
  const [wlState, setWlState] = React.useState('idle'); // idle | busy | done | error
  const [wlError, setWlError] = React.useState('');
  useReveal();

  const viewDemo = async () => {
    if (!onDemo) return;
    setDemoBusy(true);
    try { await onDemo(); } catch { setDemoBusy(false); }
  };

  const joinWaitlist = async (e) => {
    e.preventDefault();
    setWlState('busy');
    setWlError('');
    try {
      await api.joinWaitlist(wlEmail);
      setWlState('done');
    } catch (err) {
      setWlError(err.message || 'Something went wrong — try again.');
      setWlState('error');
    }
  };

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="dot" />
          <span>Greenstreak</span>
        </div>
        <nav className="landing-nav-actions">
          <a className="landing-navlink" href="#how">How it works</a>
          <a className="landing-navlink" href="#tour">See it</a>
          <a className="landing-navlink" href="#pricing">Pricing</a>
          <button className="btn-ghost" onClick={onSignIn}>Sign in</button>
          <button className="btn-primary landing-cta-sm" onClick={onGetStarted}>Get started</button>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy reveal">
          <span className="landing-pill">Serious statistics · seriously simple</span>
          <h1>Find your edge.<br />Then prove it with the math.</h1>
          <p className="landing-sub">
            Greenstreak imports your trades from any broker and instantly runs the
            numbers that actually move your P&amp;L — expectancy, Kelly sizing, daily
            Sharpe, per-setup edge. A fast, clean trading journal that goes deeper
            than win rate.
          </p>
          <div className="landing-cta-row">
            <button className="btn-primary landing-cta" onClick={onGetStarted}>Start free</button>
            {onDemo && (
              <button className="btn-ghost landing-cta demo-cta" onClick={viewDemo} disabled={demoBusy}>
                {demoBusy ? 'Loading demo…' : 'View live demo'}
              </button>
            )}
          </div>
          <p className="landing-fineprint">
            14-day free trial · no credit card · cancel anytime
          </p>
        </div>

        <div className="landing-hero-card reveal" aria-hidden="true">
          <div className="lhc-head">
            <span className="dot" />
            <span>Dashboard</span>
            <span className="lhc-grade">A</span>
          </div>
          <div className="lhc-stats">
            {HERO_STATS.map((s) => (
              <div className="lhc-stat" key={s.k}>
                <div className="lhc-k">{s.k}</div>
                <div className={`lhc-v ${s.tone || ''}`}>{s.v}</div>
              </div>
            ))}
          </div>
          <svg className="lhc-chart" viewBox="0 0 320 90" preserveAspectRatio="none">
            <polyline
              points="0,80 30,70 55,74 85,58 115,60 145,44 175,48 205,32 235,36 265,18 300,10 320,6"
              fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            />
            <polyline
              points="0,90 0,80 30,70 55,74 85,58 115,60 145,44 175,48 205,32 235,36 265,18 300,10 320,6 320,90"
              fill="#e0f7fb" stroke="none"
            />
          </svg>
        </div>
      </section>

      <section className="landing-brokers reveal">
        <span className="landing-brokers-label">Imports in seconds from</span>
        <div className="landing-brokers-row">
          <span>ThinkOrSwim</span><span>Robinhood</span><span>Webull</span>
          <span>Interactive Brokers</span><span>+ any CSV</span>
        </div>
      </section>

      <section className="landing-pillars">
        <div className="landing-pillar-grid">
          {PILLARS.map((p) => (
            <div className="landing-pillar reveal" key={p.title}>
              <div className="landing-pillar-icon">{p.icon}</div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="howitworks" id="how">
        <div className="howitworks-inner">
          <h2 className="reveal">From broker export to real insight in three steps</h2>
          <div className="howitworks-grid">
            {HOW_IT_WORKS.map((s) => (
              <div className="howstep reveal" key={s.n}>
                <span className="howstep-num">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FeatureTour onDemo={onDemo ? viewDemo : undefined} />

      <section className="landing-features" id="features">
        <h2 className="reveal">Everything you need to find your edge</h2>
        <p className="landing-section-sub reveal">
          One fast, focused app — from raw broker export to institutional-grade analytics.
        </p>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <div className="landing-feature reveal" key={f.title}>
              <div className="landing-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-deeper">
        <div className="landing-deeper-inner">
          <div className="landing-deeper-copy reveal">
            <h2>Most journals stop at win rate.<br />Greenstreak keeps going.</h2>
            <p>
              Anyone can show you a P&amp;L number. The hard part — and the part that
              actually makes you money — is knowing your real expectancy, how big to
              size, and which setups and sessions carry your edge. That’s the whole point.
            </p>
            <button className="btn-primary landing-cta" onClick={onGetStarted}>Start free</button>
          </div>
          <ul className="landing-deeper-list reveal">
            {DEEPER.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      </section>

      <section className="landing-pricing" id="pricing">
        <h2 className="reveal">One plan. Everything included.</h2>
        <p className="landing-section-sub reveal">
          A fraction of what the big-name journals charge — with the deeper stats they don’t have.
        </p>
        <div className="landing-price-card reveal">
          <div className="landing-price-head">
            <span className="landing-price-amount">$10</span>
            <span className="landing-price-period">/ month</span>
          </div>
          <p className="landing-price-trial">Starts with a 14-day free trial · no card required</p>
          <ul className="landing-price-includes">
            {PRICE_INCLUDES.map((i) => <li key={i}>{i}</li>)}
          </ul>
          <button className="btn-primary landing-cta landing-price-cta" onClick={onGetStarted}>Start your free trial</button>
          <button type="button" className="landing-textlink landing-price-signin" onClick={onSignIn}>or sign in</button>
        </div>
      </section>

      <section className="landing-final reveal">
        <h2>See how you really trade.</h2>
        <p className="landing-section-sub">Import your first CSV in under a minute.</p>
        <div className="landing-cta-row landing-final-cta">
          <button className="btn-primary landing-cta" onClick={onGetStarted}>Start free</button>
          {onDemo && (
            <button className="btn-ghost landing-cta demo-cta" onClick={viewDemo} disabled={demoBusy}>
              {demoBusy ? 'Loading demo…' : 'View live demo'}
            </button>
          )}
        </div>
      </section>

      <section className="landing-waitlist reveal">
        <div className="landing-waitlist-inner">
          <div className="landing-waitlist-copy">
            <h3>Not ready to dive in?</h3>
            <p>Get the occasional product update — new features, broker support, and trading tips. No spam, unsubscribe anytime.</p>
          </div>
          {wlState === 'done' ? (
            <p className="waitlist-done">Thanks — you’re on the list. ✓</p>
          ) : (
            <form className="waitlist-form" onSubmit={joinWaitlist}>
              <input
                type="email"
                placeholder="you@example.com"
                value={wlEmail}
                onChange={(e) => setWlEmail(e.target.value)}
                aria-label="Email address"
                required
              />
              <button className="btn-primary" type="submit" disabled={wlState === 'busy'}>
                {wlState === 'busy' ? 'Adding…' : 'Keep me posted'}
              </button>
            </form>
          )}
        </div>
        {wlState === 'error' && <p className="waitlist-error">{wlError}</p>}
      </section>

      <footer className="landing-footer">
        <div className="brand">
          <span className="dot" />
          <span>Greenstreak</span>
        </div>
        <span className="landing-footer-copy">© {new Date().getFullYear()} Greenstreak · The trading journal with serious statistics.</span>
      </footer>
    </div>
  );
}
