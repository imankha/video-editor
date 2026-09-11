import { describe, it, expect } from 'vitest';
import { getRatingCaption, getEditRatingCaption, getRatingLabel } from './clipConstants';

// T9520 N35: the ONE documented star-to-descriptor mapping ("4 stars · Good"),
// used for the rating title/aria across the play list, the play editor and the
// timeline markers. Asserted here as the single source; render sites reuse it.
describe('getRatingLabel (N35 star-to-descriptor mapping)', () => {
  it('pairs the star count (singular at 1) with the canonical adjective', () => {
    expect(getRatingLabel(1)).toBe('1 star · Mental Lapse');
    expect(getRatingLabel(2)).toBe('2 stars · Technical Lapse');
    expect(getRatingLabel(3)).toBe('3 stars · Interesting');
    expect(getRatingLabel(4)).toBe('4 stars · Good');
    expect(getRatingLabel(5)).toBe('5 stars · Brilliant');
  });

  it('falls back to the default rating (3) when none is set', () => {
    expect(getRatingLabel(null)).toBe('3 stars · Interesting');
    expect(getRatingLabel(0)).toBe('3 stars · Interesting');
  });
});

// T8490 / T9320: the caption table (task file "Rating caption rewrite") as pure
// function tests — the render sites (AnnotateFullscreenOverlay, ClipDetailsEditor)
// are covered separately, but the branching logic itself is asserted here once.
// T9320 vocabulary rule: these captions never say "reel" - a five-star play
// produces a CLIP ("clip will be created from play").
describe('getRatingCaption (create mode)', () => {
  it('no rating yet -> explains the 1-5 scale and the 5-star clip default', () => {
    expect(getRatingCaption(null, true)).toBe(
      'How good was this play? Rate it 1 to 5 - five stars creates a clip from the play.'
    );
    expect(getRatingCaption(0, true)).toBe(
      'How good was this play? Rate it 1 to 5 - five stars creates a clip from the play.'
    );
  });

  it('rating 1 -> "Mental lapse" learn-from caption, regardless of layer', () => {
    expect(getRatingCaption(1, true)).toBe('Mental lapse (??) - a play to learn from.');
    expect(getRatingCaption(1, false)).toBe('Mental lapse (??) - a play to learn from.');
  });

  it('rating 2 -> "Technical lapse" learn-from caption, regardless of layer', () => {
    expect(getRatingCaption(2, true)).toBe('Technical lapse (?) - a play to learn from.');
    expect(getRatingCaption(2, false)).toBe('Technical lapse (?) - a play to learn from.');
  });

  it('rating 3 -> "Interesting play" second-look caption', () => {
    expect(getRatingCaption(3, true)).toBe('Interesting play (!?) - worth a second look.');
  });

  it('rating 4 -> "Good play" one-more-star caption, regardless of layer', () => {
    expect(getRatingCaption(4, true)).toBe('Good play (!) - one more star creates a clip.');
    expect(getRatingCaption(4, false)).toBe('Good play (!) - one more star creates a clip.');
  });

  it('rating 5 + My Athlete -> clip will be created from play', () => {
    expect(getRatingCaption(5, true)).toBe('Brilliant play (!!) - clip will be created from play.');
  });

  it('rating 5 + Team -> team plays do not create clips', () => {
    expect(getRatingCaption(5, false)).toBe(
      "Brilliant team play (!!) - team plays don't create clips."
    );
  });
});

describe('getEditRatingCaption (edit mode)', () => {
  it('no rating yet -> same as create mode', () => {
    expect(getEditRatingCaption(null, true, false)).toBe(
      'How good was this play? Rate it 1 to 5 - five stars creates a clip from the play.'
    );
  });

  it('rating 2 -> "Technical lapse" learn-from caption', () => {
    expect(getEditRatingCaption(2, true, false)).toBe('Technical lapse (?) - a play to learn from.');
  });

  it('rating 4 -> "Good play" one-more-star caption', () => {
    expect(getEditRatingCaption(4, true, false)).toBe('Good play (!) - one more star creates a clip.');
  });

  it('rating 5 + My Athlete + no clip yet -> points at the Clip control, never promises "will be created"', () => {
    const caption = getEditRatingCaption(5, true, false);
    expect(caption).toBe('Brilliant play (!!) - create a clip below.');
    expect(caption).not.toMatch(/will be created/);
  });

  it('rating 5 + My Athlete + clip already exists -> says so, does not re-offer creation', () => {
    expect(getEditRatingCaption(5, true, true)).toBe('Brilliant play (!!) - clip already created from play.');
  });

  it('rating 5 + Team -> team plays do not create clips, regardless of hasReel', () => {
    expect(getEditRatingCaption(5, false, false)).toBe(
      "Brilliant team play (!!) - team plays don't create clips."
    );
  });
});
