import { describe, it, expect } from 'vitest';
import { resolveGuide, GUIDE_STATES } from './resolveGuide';
import { homeFacts } from './catalog';
import { GUIDE } from '../../config/displayNames';

const base = { tab: 'games', modal: null, games: 0, gamesWithPlays: 0, uploading: 0, failed: 0, drafts: 0, finished: 0 };
const id = (over) => resolveGuide(homeFacts({ ...base, ...over }))?.id;

describe('home + upload guide states (T12250)', () => {
  const cases = [
    ['upload modal, no file', { modal: 'choose' }, 'upload.choose'],
    ['upload modal, file picked', { modal: 'submit' }, 'upload.submit'],
    ['upload failed', { games: 1, failed: 1 }, 'upload.failed'],
    ['games: none', {}, 'home.games.empty'],
    ['games: uploading', { games: 1, uploading: 1 }, 'home.games.uploading'],
    ['games: no plays', { games: 1 }, 'home.games.no-plays'],
    ['games: plays', { games: 1, gamesWithPlays: 1 }, 'home.games.plays'],
    ['games: finished exists', { games: 1, gamesWithPlays: 1, finished: 1 }, 'home.games.finished'],
    ['clips: none', { tab: 'clips' }, 'home.clips.empty'],
    ['clips: unfinished', { tab: 'clips', drafts: 2 }, 'home.clips.unfinished'],
    ['clips: all done', { tab: 'clips', finished: 1 }, 'home.clips.all-done'],
    ['finished: first', { tab: 'finished', finished: 1 }, 'home.finished.first'],
    ['finished: empty', { tab: 'finished' }, 'home.finished.empty'],
  ];
  it.each(cases)('%s -> %s', (_n, over, expected) => {
    expect(id(over)).toBe(expected);
  });

  it('enumeration fixtures cover all 13 home/upload rules', () => {
    const ids = new Set(GUIDE_STATES.map((s) => s.expectId));
    for (const [, , expected] of cases) expect(ids.has(expected), expected).toBe(true);
  });

  it('never says Press on a game with zero games', () => {
    const g = resolveGuide(homeFacts({ ...base }));
    expect(g.message.title).toBe(GUIDE.home.gamesEmpty.title);
    expect(JSON.stringify(GUIDE.home)).not.toMatch(/Press on a game/);
  });

  it('upload failed uses the error tone', () => {
    expect(resolveGuide(homeFacts({ ...base, games: 1, failed: 1 })).tone).toBe('strong');
  });

  it('no-plays and plays guides avoid the Upload button', () => {
    const g = resolveGuide(homeFacts({ ...base, games: 1 }));
    expect(g.avoid).toContain('[data-testid="home-upload-game"]');
  });
});
