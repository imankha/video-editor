import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';
import { GUIDE } from '../../config/displayNames';

const fresh = { dragDone: false, hasPlayed: false, trimStage: 'off', hasPlayedThrough: false, previewing: false, hasPreviewPlayedThrough: false, ctaBusy: false };
const focusFacts = (finishedCount, local = {}) => ({
  screen: 'focus', job: { status: 'none' }, progress: { finishedCount }, local: { ...fresh, ...local },
});

describe('T13640: experienced users get advanced options, not the 5 basics', () => {
  it('T13640:C1 with 3+ finished highlights the first Frame step offers advanced options', () => {
    const g = resolveGuide(focusFacts(4));
    expect(g.id).toBe('focus.progress.experienced');
    expect(g.message.title).toMatch(/Trim and slow motion/);
    expect(g.message.title).not.toMatch(/Drag the box/);
  });

  it('T13640:C1 the cockpit (landscape) gets the same advanced prompt', () => {
    expect(resolveGuide(focusFacts(3, { cockpit: true })).id).toBe('focus.cockpit.experienced');
  });

  it('T13640:C1 every basic step is replaced, not just the first', () => {
    for (const local of [{ dragDone: true }, { dragDone: true, hasPlayed: true }, { dragDone: true, hasPlayed: true, hasPlayedThrough: true }]) {
      expect(resolveGuide(focusFacts(4, local)).id).toBe('focus.progress.experienced');
    }
  });

  it('T13640:C2 new users (under 3 finished) keep the basics unchanged', () => {
    expect(resolveGuide(focusFacts(0)).message.title).toBe(GUIDE.focus.drag);
    expect(resolveGuide(focusFacts(2)).message.title).toBe(GUIDE.focus.drag);
    expect(resolveGuide(focusFacts(undefined)).message.title).toBe(GUIDE.focus.drag);
  });

  it('T13640:C1 job states, trim steps and Generate still outrank/follow the experienced prompt', () => {
    expect(resolveGuide({ ...focusFacts(4), job: { status: 'processing' } }).id).toBe('focus.progress.export');
    expect(resolveGuide(focusFacts(4, { dragDone: true, hasPlayed: true, trimStage: 'split' })).id).toBe('focus.progress.trimSplit');
    expect(resolveGuide(focusFacts(4, { dragDone: true, hasPlayed: true, hasPlayedThrough: true, hasPreviewPlayedThrough: true })).id).toBe('focus.progress.generate.advanced');
  });
});
