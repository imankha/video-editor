import { describe, it, expect } from 'vitest';
import { getRatingCaption, getEditRatingCaption } from './clipConstants';

// T8490: the 5-state caption table (task file "What to build" Step 1) as pure
// function tests — the render sites (AnnotateFullscreenOverlay, ClipDetailsEditor)
// are covered separately, but the branching logic itself is asserted here once.
describe('getRatingCaption (create mode)', () => {
  it('no rating yet -> explains the 1-5 scale and the 5-star reel default', () => {
    expect(getRatingCaption(null, true)).toBe(
      '1-5: how big was this play? 5 starts a reel automatically.'
    );
    expect(getRatingCaption(0, true)).toBe(
      '1-5: how big was this play? 5 starts a reel automatically.'
    );
  });

  it('rating 1-3 -> "Saved to your library." regardless of layer', () => {
    expect(getRatingCaption(1, true)).toBe('Saved to your library.');
    expect(getRatingCaption(2, false)).toBe('Saved to your library.');
    expect(getRatingCaption(3, true)).toBe('Saved to your library.');
  });

  it('rating 4 -> "Big play (!) - saved to your library." regardless of layer', () => {
    expect(getRatingCaption(4, true)).toBe('Big play (!) - saved to your library.');
    expect(getRatingCaption(4, false)).toBe('Big play (!) - saved to your library.');
  });

  it('rating 5 + My Athlete -> reel will be created', () => {
    expect(getRatingCaption(5, true)).toBe("Can't-miss play (!!) - reel will be created.");
  });

  it('rating 5 + Team -> team clips do not start reels', () => {
    expect(getRatingCaption(5, false)).toBe(
      "Can't-miss team play (!!) - team clips don't start reels."
    );
  });
});

describe('getEditRatingCaption (edit mode)', () => {
  it('no rating yet -> same as create mode', () => {
    expect(getEditRatingCaption(null, true, false)).toBe(
      '1-5: how big was this play? 5 starts a reel automatically.'
    );
  });

  it('rating 1-3 -> "Saved to your library."', () => {
    expect(getEditRatingCaption(2, true, false)).toBe('Saved to your library.');
  });

  it('rating 4 -> "Big play (!) - saved to your library."', () => {
    expect(getEditRatingCaption(4, true, false)).toBe('Big play (!) - saved to your library.');
  });

  it('rating 5 + My Athlete + no reel yet -> points at the Reel control, never promises "will be created"', () => {
    const caption = getEditRatingCaption(5, true, false);
    expect(caption).toBe("Can't-miss play (!!) - create a reel below.");
    expect(caption).not.toMatch(/will be created/);
  });

  it('rating 5 + My Athlete + reel already exists -> says so, does not re-offer creation', () => {
    expect(getEditRatingCaption(5, true, true)).toBe("Can't-miss play (!!) - reel already created.");
  });

  it('rating 5 + Team -> team clips do not start reels, regardless of hasReel', () => {
    expect(getEditRatingCaption(5, false, false)).toBe(
      "Can't-miss team play (!!) - team clips don't start reels."
    );
  });
});
