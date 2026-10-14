import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';
import { GUIDE_PULSE } from './guideTargets';

// T12340: the athlete boxes pulse only while the user still has to pick one.
const guide = (pick) => resolveGuide({ screen: 'overlay', job: { status: 'none' }, local: { pick } });

describe('T12340 spotlight pick pulse', () => {
  it('pulses the boxes while a pick is still needed', () => {
    expect(guide({ phase: 'parked', step: 1, total: 4, assigned: 0, boxed: true }).pulse).toBe(GUIDE_PULSE.PICK_BOX);
    expect(guide({ phase: 'parked', step: 2, total: 4, assigned: 1, boxed: true, atMarker: true }).pulse).toBe(GUIDE_PULSE.PICK_BOX);
  });

  it.each([
    ['just tapped', { phase: 'confirm', step: 1, total: 4, assigned: 1, boxed: true }],
    ['scrubbed away', { phase: 'away', step: 2, total: 4, assigned: 1, boxed: true }],
    ['athlete not outlined', { phase: 'parked', step: 2, total: 4, assigned: 1, boxed: false }],
    ['nothing detected', { phase: 'parked', step: 1, total: 4, assigned: 0, boxed: false, noBoxes: true }],
  ])('does not pulse when %s', (_name, pick) => {
    expect(guide(pick).pulse).toBeNull();
  });

  it('done pulses the export button (T12760), never the athlete boxes', () => {
    expect(guide({ phase: 'done', step: null, total: 4, assigned: 4 }).pulse).toBe(GUIDE_PULSE.EXPORT);
  });
});
