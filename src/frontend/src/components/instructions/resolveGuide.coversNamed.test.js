import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';

// T13570: a card or shade must not cover or dim a control the screen still needs.
const t = (id) => `[data-testid="${id}"]`;
const annotate = (selectedPlay, local = {}) => resolveGuide({ screen: 'annotate', progress: { selectedPlay, portrait: null }, local });
const pick = (p) => resolveGuide({ screen: 'overlay', local: { pick: { step: 1, total: 4, assigned: 0, boxed: true, ...p } } });

describe('T13570', () => {
  it('T13570:C1 has-plays cards keep the plays row on the timeline clear (the sentence says tap a play)', () => {
    for (const playCount of [1, 4]) {
      const g = annotate(null, { playCount });
      expect(g.keepClear).toEqual(expect.arrayContaining([t('clip-track-mobile'), t('clip-lane-mine')]));
    }
  });

  it('T13570:C2 has-plays shade also cuts out Review plays and Share plays so the other main buttons stay reachable', () => {
    for (const playCount of [1, 6]) {
      const g = annotate(null, { playCount });
      expect(g.keepClear).toEqual(expect.arrayContaining([t('annotate-mark-play-button'), t('annotate-review-plays'), t('annotate-share-plays-action')]));
    }
  });

  it('T13570:C3 the play editor cuts the green trim bar out of the shade', () => {
    const g = annotate({ rating: 3 }, { editorOpen: true });
    expect(g.keepClear).toContain(t('scrub-track'));
  });

  it('T13570:C4 spotlight pick keeps the video stage (where the athletes are) clear of the card', () => {
    for (const p of [{ phase: 'parked' }, { phase: 'parked', assigned: 1 }, { phase: 'parked', boxed: false }]) {
      expect(pick(p).keepClear).toContain(t('overlay-video-stage'));
    }
  });
});
