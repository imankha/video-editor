import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';

// T12340: the athlete boxes pulse only while the user still has to pick one.
const guide = (pick) => resolveGuide({ screen: 'overlay', job: { status: 'none' }, local: { pick } });

describe('T12340 spotlight pick pulse', () => {
  it('pulses the boxes while a pick is still needed', () => {
    expect(guide({ phase: 'parked', step: 1, total: 4, assigned: 0, boxed: true }).pulse).toBe('pick-box');
    expect(guide({ phase: 'parked', step: 2, total: 4, assigned: 1, boxed: true, atMarker: true }).pulse).toBe('pick-box');
  });

  it.each([
    ['just tapped', { phase: 'confirm', step: 1, total: 4, assigned: 1, boxed: true }],
    ['scrubbed away', { phase: 'away', step: 2, total: 4, assigned: 1, boxed: true }],
    ['athlete not outlined', { phase: 'parked', step: 2, total: 4, assigned: 1, boxed: false }],
    ['nothing detected', { phase: 'parked', step: 1, total: 4, assigned: 0, boxed: false, noBoxes: true }],
    ['done', { phase: 'done', step: null, total: 4, assigned: 4 }],
  ])('does not pulse when %s', (_name, pick) => {
    expect(guide(pick).pulse).toBeNull();
  });
});
