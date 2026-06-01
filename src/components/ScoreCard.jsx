import React from 'react';

// Color ramp by score band (matches the light-theme palette).
function scoreColor(score) {
  if (score >= 80) return '#10b981'; // emerald
  if (score >= 60) return '#6366f1'; // indigo
  if (score >= 40) return '#f59e0b'; // amber
  return '#ef4444'; // crimson
}

/** SVG ring gauge for the 0–100 composite score. */
function Gauge({ score, grade }) {
  const size = 132;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = scoreColor(score);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="score-gauge">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f6" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" className="score-num" fill={color}>
        {score}
      </text>
      <text x="50%" y="66%" textAnchor="middle" dominantBaseline="central" className="score-grade">
        {grade}
      </text>
    </svg>
  );
}

/**
 * Composite "Trade Score" card: a ring gauge plus the weighted component
 * breakdown. Props: score = { score, grade, components[] } from /api/metrics.
 */
export default function ScoreCard({ score }) {
  if (!score) return null;
  return (
    <div className="card score-card">
      <div className="score-left">
        <Gauge score={score.score} grade={score.grade} />
        <div className="score-caption">Trade Score</div>
      </div>
      <div className="score-components">
        {score.components.map((c) => (
          <div className="score-row" key={c.key}>
            <div className="score-row-label">
              {c.label}
              <span className="muted score-weight">{Math.round(c.weight * 100)}%</span>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(100, c.score)}%`, background: scoreColor(c.score) }} />
            </div>
            <div className="score-row-val">{Math.round(c.score)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
