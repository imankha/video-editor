import { describe, it, expect } from 'vitest';
import { resolveGuide, GUIDE_STATES } from './resolveGuide';
import { GUIDE } from '../../config/displayNames';

const fl = (over) => ({
  dragDone: true, hasPlayed: true, trimStage: 'off', hasPlayedThrough: true,
  previewing: false, hasPreviewPlayedThrough: true, ctaBusy: false, ...over,
});
const focusFacts = (status, local) => ({ screen: 'focus', job: { status }, local: fl(local) });
const overlayFacts = (status, local = {}) => ({ screen: 'overlay', job: { status }, local });

describe('T12270 job-aware guide', () => {
  it('step 5 (Generate) never resolves while a job is not none', () => {
    for (const status of ['processing', 'finishing', 'failed', 'credits', 'ready']) {
      for (const ctaBusy of [false, true]) {
        const g = resolveGuide(focusFacts(status, { ctaBusy }));
        expect(g?.step ?? null, `${status}/${ctaBusy}`).not.toBe(5);
        expect(g?.id, `${status}/${ctaBusy}`).not.toBe('focus.progress.generate');
      }
    }
    expect(resolveGuide(focusFacts('none')).id).toBe('focus.progress.generate');
  });

  it('Focus job states resolve to their own rules and tones', () => {
    expect(resolveGuide(focusFacts('processing'))).toMatchObject({ id: 'focus.progress.export', tone: 'progress' });
    expect(resolveGuide(focusFacts('finishing'))).toMatchObject({ id: 'focus.finishing', tone: 'progress' });
    expect(resolveGuide(focusFacts('failed'))).toMatchObject({ id: 'focus.failed', tone: 'error' });
    expect(resolveGuide(focusFacts('credits'))).toMatchObject({ id: 'focus.credits', tone: 'error' });
    expect(resolveGuide(focusFacts('ready'))).toMatchObject({ id: 'focus.ready' });
  });

  it('Overlay generating, failed and ready all show a guide', () => {
    expect(resolveGuide(overlayFacts('processing'))).toMatchObject({ id: 'overlay.progress', tone: 'progress' });
    expect(resolveGuide(overlayFacts('failed'))).toMatchObject({ id: 'overlay.failed', tone: 'error' });
    expect(resolveGuide(overlayFacts('ready'))).toMatchObject({ id: 'overlay.ready' });
  });

  it('enumeration covers processing, complete-before-preview, error and needCredits', () => {
    const names = GUIDE_STATES.map((s) => s.name).join('|');
    for (const w of ['processing', 'finishing', 'error', 'needs credits', 'ready']) expect(names).toMatch(new RegExp(w));
  });

  it('ruled copy', () => {
    expect(GUIDE.focus.drag).toBe('Drag the box onto your athlete. Your highlight shows what’s inside it.');
    expect(GUIDE.focus.play).toBe('Tap Play and watch your athlete.');
    expect(GUIDE.focus.generate).toBe('Looks right? Tap Generate highlight.');
    expect(GUIDE.overlay.ready).toBe('Looks good? Tap Finish to get your link.');
  });
});
