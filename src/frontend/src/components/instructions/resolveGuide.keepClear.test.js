import { describe, it, expect } from 'vitest';
import { resolveGuide, homeFacts } from './resolveGuide';

const t = (id) => `[data-testid="${id}"]`;
const home = (over) => resolveGuide(homeFacts(over));
const annotate = (selectedPlay, local = {}, portrait = null) =>
  resolveGuide({ screen: 'annotate', progress: { selectedPlay, portrait }, local });

describe('T12620: the cutout contains every control the sentence names', () => {
  it('T12620:C1 Clips guides keep the clip tiles, Games tab and Upload highlight clear', () => {
    for (const over of [{ tab: 'clips', drafts: 2 }, { tab: 'clips' }, { tab: 'clips', finished: 1 }]) {
      const g = home(over);
      expect(g.keepClear).toEqual(expect.arrayContaining([t('clips-gallery'), t('home-tab-games'), t('home-upload-clip')]));
    }
  });
  it('T12620:C2 Finished guide keeps the highlight tiles (Share, Download) clear', () => {
    expect(home({ tab: 'finished', finished: 1 }).keepClear).toContain(t('published-tab-panel'));
  });
  it('T12620:C3 Games-after-finish guide anchors the Finished tab', () => {
    const g = home({ games: 1, gamesWithPlays: 1, finished: 1 });
    expect(g.id).toBe('home.games.finished');
    expect(g.anchor.target).toBe(t('home-tab-published'));
  });
  it('T12620:C4 play editor keeps the video, its controls, the green ends, rating and Tags and Notes clear', () => {
    const g = annotate({ rating: 3 }, { editorOpen: true });
    expect(g.id).toBe('annotate.editor');
    expect(g.keepClear).toEqual(expect.arrayContaining([
      t('annotate-coach-stage') + ' video', t('annotate-controls'),
      t('scrub-start-handle'), t('scrub-end-handle'), t('rating-input'), t('add-details-button'),
    ]));
    expect(g.message.title).toMatch(/Tap Play to confirm you have the full play/);
  });
  it('T12620:C5 selected play points at Make highlight, with Edit play also clear', () => {
    const g = annotate({ rating: 3 }, { playCount: 1 });
    expect(g.id).toBe('annotate.selected.none');
    expect(g.anchor.target).toBe(t('annotate-highlight-slots'));
    expect(g.keepClear).toContain(t('annotate-primary-cta'));
    expect(g.message.title).toMatch(/Make highlight/);
  });
});
