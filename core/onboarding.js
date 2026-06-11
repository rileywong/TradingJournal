// Activation checklist shown on the dashboard until a new user is fully set up.
// Pure + framework-free so the step logic is unit-testable; the React component
// just renders what this returns.

export function onboardingSteps({ hasAccount = true, hasTrades = false, exploredReports = false } = {}) {
  const steps = [
    { key: 'account', label: 'Create your account', hint: 'One per broker', done: !!hasAccount },
    { key: 'import', label: 'Import your trades', hint: 'Drag in a broker CSV', done: !!hasTrades },
    { key: 'explore', label: 'Explore your reports', hint: 'See your deeper stats', done: !!exploredReports },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length };
}
