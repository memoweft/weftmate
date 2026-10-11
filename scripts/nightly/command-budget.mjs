// Cleanup may outlive the run deadline, while still respecting its heavy slot.
export function commandBudget(requested, { allowFailure, phaseDeadline = Infinity, slotDeadline = Infinity, now = Date.now() } = {}) {
  return Math.min(requested, (allowFailure ? slotDeadline : phaseDeadline) - now);
}
