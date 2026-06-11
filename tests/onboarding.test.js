import { describe, it, expect } from 'vitest';
import { onboardingSteps } from '../core/onboarding.js';

describe('onboardingSteps', () => {
  it('marks account done by default and the rest pending', () => {
    const { steps, doneCount, complete } = onboardingSteps();
    expect(steps.map((s) => s.key)).toEqual(['account', 'import', 'explore']);
    expect(steps[0].done).toBe(true);
    expect(doneCount).toBe(1);
    expect(complete).toBe(false);
  });

  it('tracks progress as milestones are reached', () => {
    expect(onboardingSteps({ hasTrades: true }).doneCount).toBe(2);
    const full = onboardingSteps({ hasAccount: true, hasTrades: true, exploredReports: true });
    expect(full.doneCount).toBe(3);
    expect(full.complete).toBe(true);
  });
});
