import { describe, it, expect } from 'vitest';
import { getPlayProgress, isDefaultPlayName, CLIP_BADGE } from './playProgress';

// T10410: the play-progress badge derivation. Pins the 2026-09-18 rulings:
// rated = rating differs from the default; named = a real user-typed name
// (never "Play N", never a backend-derived name); clip badge dormant below 5
// stars, nudging at 5, pending while creating, done once a project exists.

const base = {
  rating: 4,
  defaultRating: 4,
  clipName: '',
  isNameManuallyEdited: false,
  loadedName: null,
  loadedHasCustomName: false,
  notes: '',
  hasProject: false,
  creating: false,
};

describe('getPlayProgress — rated', () => {
  it('is false at the untouched default rating', () => {
    expect(getPlayProgress(base).rated).toBe(false);
  });
  it('is true for any rating other than the default (ruling 1b)', () => {
    expect(getPlayProgress({ ...base, rating: 5 }).rated).toBe(true);
    expect(getPlayProgress({ ...base, rating: 1 }).rated).toBe(true);
  });
});

describe('getPlayProgress — named', () => {
  it('is false for the one-tap "Play N" default even though it is stored as a name', () => {
    expect(isDefaultPlayName('Play 7')).toBe(true);
    expect(getPlayProgress({
      ...base, clipName: 'Play 7', isNameManuallyEdited: true, loadedName: 'Play 7', loadedHasCustomName: true,
    }).named).toBe(false);
  });
  it('is true when the user typed a name this session (create mode)', () => {
    expect(getPlayProgress({ ...base, clipName: 'Banger', isNameManuallyEdited: true }).named).toBe(true);
  });
  it('is false when the name is blank even if flagged manually edited', () => {
    expect(getPlayProgress({ ...base, clipName: '   ', isNameManuallyEdited: true }).named).toBe(false);
  });
  it('edit mode: a loaded DERIVED name (has_custom_name false, unchanged) is not "named"', () => {
    expect(getPlayProgress({
      ...base, clipName: 'Good Goal', isNameManuallyEdited: true, loadedName: 'Good Goal', loadedHasCustomName: false,
    }).named).toBe(false);
  });
  it('edit mode: a loaded CUSTOM name (has_custom_name true, unchanged) is "named"', () => {
    expect(getPlayProgress({
      ...base, clipName: "Ava's header", isNameManuallyEdited: true, loadedName: "Ava's header", loadedHasCustomName: true,
    }).named).toBe(true);
  });
  it('edit mode: retyping over a derived name counts as named', () => {
    expect(getPlayProgress({
      ...base, clipName: 'Renamed', isNameManuallyEdited: true, loadedName: 'Good Goal', loadedHasCustomName: false,
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
});
