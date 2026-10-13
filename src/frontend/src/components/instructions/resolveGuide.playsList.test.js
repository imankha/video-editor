import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';

const t = (id) => `[data-testid="${id}"]`;
const annotate = (local) => resolveGuide({ screen: 'annotate', progress: { selectedPlay: null, portrait: null }, local });

describe('T12620:C6 "tap a play" guides anchor the plays list and keep Mark play clear', () => {
  it('one and many marked plays', () => {
    for (const playCount of [1, 4]) {
      const g = annotate({ playCount });
      expect(g.id).toMatch(/^annotate\.has-plays\./);
      expect(g.anchor.target).toBe(t('annotate-plays-list'));
      expect(g.keepClear).toContain(t('annotate-mark-play-button'));
    }
  });
});
