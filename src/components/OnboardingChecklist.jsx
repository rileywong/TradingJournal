import React from 'react';
import { onboardingSteps } from '../../core/onboarding.js';

// Compact activation checklist shown atop the dashboard until the user is fully
// set up (or dismisses it). Progress is derived from real state passed in.
export default function OnboardingChecklist({ hasAccount, hasTrades, exploredReports, onImport, onExplore, onDismiss }) {
  const { steps, doneCount, total, complete } = onboardingSteps({ hasAccount, hasTrades, exploredReports });
  if (complete) return null;

  const action = { import: onImport, explore: onExplore };

  return (
    <div className="checklist">
      <div className="checklist-head">
        <div>
          <strong>Get set up</strong>
          <span className="checklist-count">{doneCount} of {total} done</span>
        </div>
        <button className="checklist-dismiss" onClick={onDismiss} aria-label="Dismiss checklist">×</button>
      </div>
      <div className="checklist-bar"><span style={{ width: `${(doneCount / total) * 100}%` }} /></div>
      <ul className="checklist-steps">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'done' : ''}>
            <span className="checklist-check">{s.done ? '✓' : ''}</span>
            <span className="checklist-label">{s.label}<span className="checklist-hint">{s.hint}</span></span>
            {!s.done && action[s.key] && (
              <button className="checklist-action" onClick={action[s.key]}>{s.key === 'import' ? 'Import' : 'View'}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
