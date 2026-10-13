import { describe, it, expect } from 'vitest';
import { resolveGuide, homeFacts } from './resolveGuide';
import { annotateFacts } from './catalog';
import { GUIDE } from '../../config/displayNames';

const focusFacts = (finishedCount) => ({
  screen: 'focus', job: { status: 'none' }, progress: { finishedCount },
  local: { dragDone: true, hasPlayed: true, trimStage: 'off', hasPlayedThrough: true, previewing: false, hasPreviewPlayedThrough: true, ctaBusy: false },
});

describe('finished-highlight count tiers (T12660)', () => {
  it('T12660:C1 Finished tab with 2+ highlights gets its own guide that points at the next play', () => {
    const g = resolveGuide(homeFacts({ tab: 'finished', games: 1, finished: 2 }));
    expect(g.id).toBe('home.finished.many');
    expect(g.message.title).toBe(GUIDE.home.finishedMany.title.replace('{n}', 2));
    expect(g.message.title).toMatch(/2 highlights/);
    expect(g.message.title).toMatch(/mark/i);
  });

  it('T12660:C2 one finished highlight keeps the core Finished guide', () => {
    expect(resolveGuide(homeFacts({ tab: 'finished', finished: 1 })).id).toBe('home.finished.first');
  });

  it('T12660:C3 Focus Generate step invites one advanced control only with 2+ finished', () => {
    expect(resolveGuide(focusFacts(1)).id).toBe('focus.progress.generate');
    const g = resolveGuide(focusFacts(2));
    expect(g.id).toBe('focus.progress.generate.advanced');
    expect(g.message.title).toMatch(/Trim and slow motion/);
  });

  it('T12660:C4 the end of the first-finish path points at marking the next play', () => {
    const facts = annotateFacts({ rating: 5 }, [{ orientation: 'portrait', projectId: 1, action: 'published' }], {});
    const g = resolveGuide({ ...facts, progress: { ...facts.progress, portrait: { action: 'published' } } });
    expect(g.id).toBe('annotate.progress.published');
    expect(`${g.message.title} ${g.message.body}`).toMatch(/another play/i);
  });
});
