import { describe, it, expect } from 'vitest';
import { resolveGuide, homeFacts } from './resolveGuide';

const t = (id) => `[data-testid="${id}"]`;
const home = (over) => resolveGuide(homeFacts(over));

// T12620: a Home guide pulses only the control its sentence tells the user to press.
describe('T12620:C1 Home guide pulse and anchor name the control the sentence says to press', () => {
  it('"Open Finished" anchors and pulses the Finished tab, not the first game', () => {
    const g = home({ games: 1, gamesWithPlays: 1, finished: 1 });
    expect(g.id).toBe('home.games.finished');
    expect(g.anchor.target).toBe(t('home-tab-published'));
    expect(g.pulse).toBe('tab-published');
  });
  it('"Open your game" guides pulse the first game', () => {
    for (const over of [{ games: 1 }, { games: 1, gamesWithPlays: 1 }, { games: 1, uploading: 1 }]) {
      const g = home(over);
      expect(g.anchor.target).toBe(t('home-first-game'));
      expect(g.pulse).toBe('first-game');
    }
  });
  it('guides that do not tell the user to press a game or tab pulse nothing', () => {
    for (const over of [{ tab: 'clips' }, { tab: 'finished', finished: 2 }, { tab: 'finished' }]) {
      expect(home(over).pulse).toBeNull();
    }
  });
});
