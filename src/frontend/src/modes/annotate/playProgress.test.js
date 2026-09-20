import { describe, it, expect } from 'vitest';
import { getPlayProgress, isDefaultPlayName, CLIP_BADGE } from './playProgress';

// T10410: the play-progress badge derivation. Pins the 2026-09-18 rulings.
// T10610 revision: the editor is ALWAYS editing an already-created play now
// (create-at-tap) — the create-mode "touched this session" tracking
// (isRatingManuallyEdited/isNameManuallyEdited) is gone — named is derived
// purely from the current/loaded name values. T10690 revised `rated` again:
// see the rule-history comment in playProgress.js.

const base = {
  rating: 4,
  clipName: '',
  loadedName: null,
  loadedHasCustomName: false,
  notes: '',
  hasProject: false,
  creating: false,
};

describe('getPlayProgress — rated', () => {
  // T10690/T10710: raw_clips.rating is now NULLABLE — a freshly Marked play
  // has NO rating on record until the user picks one, so `rated` must go back
  // to being a real read of `rating != null` instead of the T10610-era
  // unconditional `true`. `!=` (not `!==`) is deliberate: it must cover BOTH
  // `null` (loaded from the backend) and `undefined` (a create-at-tap payload
  // that omits the field).
  it('is false when the play genuinely has no rating on record (null/undefined), true for any real 1-5 value', () => {
    expect(getPlayProgress({ ...base, rating: null }).rated).toBe(false);
    expect(getPlayProgress({ ...base, rating: undefined }).rated).toBe(false);
    expect(getPlayProgress({ ...base, rating: 1 }).rated).toBe(true);
    expect(getPlayProgress({ ...base, rating: 2 }).rated).toBe(true);
    expect(getPlayProgress({ ...base, rating: 3 }).rated).toBe(true);
    expect(getPlayProgress({ ...base, rating: 4 }).rated).toBe(true);
    expect(getPlayProgress({ ...base, rating: 5 }).rated).toBe(true);
  });
});

describe('getPlayProgress — named', () => {
  it('is false for the one-tap "Play N" default even though it is stored as a name', () => {
    expect(isDefaultPlayName('Play 7')).toBe(true);
    expect(getPlayProgress({
      ...base, clipName: 'Play 7', loadedName: 'Play 7', loadedHasCustomName: true,
    }).named).toBe(false);
  });
  it('is true when the current draft is a real user-typed name', () => {
    expect(getPlayProgress({ ...base, clipName: 'Banger' }).named).toBe(true);
  });
  it('is false when the name is blank', () => {
    expect(getPlayProgress({ ...base, clipName: '   ' }).named).toBe(false);
  });
  it('a loaded DERIVED name (has_custom_name false, unchanged) is not "named"', () => {
    expect(getPlayProgress({
      ...base, clipName: 'Good Goal', loadedName: 'Good Goal', loadedHasCustomName: false,
    }).named).toBe(false);
  });
  it('a loaded CUSTOM name (has_custom_name true, unchanged) is "named"', () => {
    expect(getPlayProgress({
      ...base, clipName: "Ava's header", loadedName: "Ava's header", loadedHasCustomName: true,
    }).named).toBe(true);
  });
  it('retyping over a derived name counts as named', () => {
    expect(getPlayProgress({
      ...base, clipName: 'Renamed', loadedName: 'Good Goal', loadedHasCustomName: false,
    }).named).toBe(true);
  });
});

describe('getPlayProgress — noted', () => {
  it('follows non-blank notes', () => {
    expect(getPlayProgress({ ...base, notes: '  ' }).noted).toBe(false);
    expect(getPlayProgress({ ...base, notes: 'great run' }).noted).toBe(true);
  });
});

describe('getPlayProgress — clip badge', () => {
  it('is dormant below 5 stars with no project', () => {
    expect(getPlayProgress({ ...base, rating: 4 }).clip).toBe(CLIP_BADGE.DORMANT);
  });
  it('nudges at 5 stars with no project', () => {
    expect(getPlayProgress({ ...base, rating: 5 }).clip).toBe(CLIP_BADGE.NUDGE);
  });
  it('is pending while a create is in flight, regardless of rating', () => {
    expect(getPlayProgress({ ...base, rating: 3, creating: true }).clip).toBe(CLIP_BADGE.PENDING);
  });
  it('is done once the play has a project, and done wins over pending', () => {
    expect(getPlayProgress({ ...base, hasProject: true }).clip).toBe(CLIP_BADGE.DONE);
    expect(getPlayProgress({ ...base, hasProject: true, creating: true }).clip).toBe(CLIP_BADGE.DONE);
  });

  // T10710: an unrated play (`rating: null`) must not be mistaken for a
  // 5-star play by `rating === CLIP_NUDGE_RATING` (`null === 5` is already
  // false, so this pins the "no change needed" verdict from the design doc's
  // B table as a real regression guard, not just an assertion by inspection).
  it('stays dormant (never nudges) when the play has no rating on record', () => {
    expect(getPlayProgress({ ...base, rating: null }).clip).toBe(CLIP_BADGE.DORMANT);
  });
});
