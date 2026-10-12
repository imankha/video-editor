import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';

// T12470:C3 a draft that is already rendered shows no step-by-step generate guide.
const focus = (local, status = 'none') => ({
  screen: 'focus',
  job: { status },
  local: { dragDone: false, hasPlayed: false, trimStage: 'off', hasPlayedThrough: false, previewing: false, hasPreviewPlayedThrough: false, ctaBusy: true, rendered: false, ...local },
});

describe('T12470 rendered draft', () => {
  it('is silent for every step when the framing is already rendered', () => {
    for (const local of [{}, { dragDone: true }, { dragDone: true, hasPlayed: true }, { dragDone: true, hasPlayed: true, hasPlayedThrough: true }]) {
      expect(resolveGuide(focus({ ...local, rendered: true }))?.id ?? null, JSON.stringify(local)).toBeNull();
    }
  });

  it('still coaches steps when not rendered', () => {
    expect(resolveGuide(focus({}))?.step).toBe(1);
  });

  it('job state still outranks a rendered draft', () => {
    expect(resolveGuide(focus({ rendered: true }, 'failed'))?.id).toBe('focus.failed');
  });
});
