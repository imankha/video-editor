import { describe, it, expect } from 'vitest';
import { defaultPlayName, isDefaultPlayName, BADGE_STATE } from './playProgress';

// T11130: the play-progress badge derivation (getPlayProgress / CLIP_BADGE /
// CLIP_NUDGE_RATING) is gone — T11150 dropped the named/noted/clip badges and
// T11130 removed the clip badge + its 5-star nudge entirely (a play becomes a
// highlight via the rating + Done -> Highlight popup, not a nudge). What
// survives this module is the default-play-name helpers and BADGE_STATE (the
// Disc primitive's visual states, still used by FramingHeaderStatus).

describe('defaultPlayName / isDefaultPlayName', () => {
  it('builds the one-tap default from a clip number', () => {
    expect(defaultPlayName(7)).toBe('Play 7');
  });
  it('recognizes the "Play N" default (any number, trimmed)', () => {
    expect(isDefaultPlayName('Play 7')).toBe(true);
    expect(isDefaultPlayName('  Play 12  ')).toBe(true);
    expect(isDefaultPlayName(defaultPlayName(3))).toBe(true);
  });
  it('rejects real names, blanks, and null', () => {
    expect(isDefaultPlayName('Banger')).toBe(false);
    expect(isDefaultPlayName("Ava's header")).toBe(false);
    expect(isDefaultPlayName('')).toBe(false);
    expect(isDefaultPlayName('   ')).toBe(false);
    expect(isDefaultPlayName(null)).toBe(false);
  });
});

describe('BADGE_STATE', () => {
  it('exposes the Disc primitive visual states', () => {
    expect(BADGE_STATE.UNDONE).toBe('undone');
    expect(BADGE_STATE.DONE).toBe('done');
  });
});
