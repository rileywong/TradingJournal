import React, { useState } from 'react';

// Interactive product tour for the landing page: tabs swap a real screenshot
// (captured from live demo data) with a short "here's what you can do" caption,
// so prospects see the actual app before they sign up.
const TABS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    img: '/showcase/dashboard.png',
    video: '/showcase/dashboard.webm',
    title: 'Your whole edge, at a glance',
    body: 'Trade Score, net P&L, win rate, profit factor, expectancy, and a live equity curve — scoped to any period, net or gross.',
  },
  {
    key: 'reports',
    label: 'Reports & stats',
    img: '/showcase/reports.png',
    video: '/showcase/reports.webm',
    title: 'Institutional-grade analytics',
    body: 'Expectancy, Kelly sizing, daily Sharpe, R-multiples, winners-vs-losers, streaks, and per-setup edge — the numbers that actually move your P&L.',
  },
  {
    key: 'calendar',
    label: 'P&L calendar',
    img: '/showcase/calendar.png',
    video: '/showcase/calendar.webm',
    title: 'See your month at a glance',
    body: 'Green and red days with weekly roll-ups. Click any day to drill into a full journal of that session.',
  },
  {
    key: 'journal',
    label: 'Daily journal',
    img: '/showcase/journal.png',
    video: '/showcase/journal.webm',
    title: 'Journal every session',
    body: 'An intraday P&L chart, that day’s trades and stats, plus a note that survives re-imports — so your context is never lost.',
  },
];

export default function FeatureTour({ onDemo }) {
  const [active, setActive] = useState(TABS[0].key);
  const tab = TABS.find((t) => t.key === active);
  return (
    <section className="tour" id="tour">
      <h2 className="reveal">See it before you sign up</h2>
      <p className="landing-section-sub reveal">
        A real look at the app running on live demo data — click through the core of Greenstreak.
      </p>
      <div className="tour-tabs reveal" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            className={`tour-tab ${active === t.key ? 'active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tour-stage reveal">
        <figure className="tour-shot">
          <div className="tour-shot-bar"><i /><i /><i /></div>
          {/* key forces a remount on tab change so the new clip autoplays; the
              screenshot is the poster + fallback if the video can't play. */}
          {tab.video ? (
            <video
              key={tab.key}
              className="tour-media"
              poster={tab.img}
              autoPlay
              loop
              muted
              playsInline
            >
              <source src={tab.video} type="video/webm" />
              <img src={tab.img} alt={tab.title} />
            </video>
          ) : (
            <img className="tour-media" src={tab.img} alt={tab.title} loading="lazy" />
          )}
        </figure>
        <div className="tour-caption">
          <h3>{tab.title}</h3>
          <p>{tab.body}</p>
          {onDemo && (
            <button type="button" className="tour-demo-link" onClick={onDemo}>
              Explore the live demo →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
