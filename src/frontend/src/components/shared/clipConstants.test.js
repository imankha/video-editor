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

// T8490 / T9320 / T9820: the caption table as pure function tests. The render
// sites (AnnotateFullscreenOverlay, ClipDetailsEditor) are covered separately;
// the branching logic itself is asserted here once.
// T9320 vocabulary rule: these captions never say "reel" - a play produces a CLIP.
// T9820 rule: the creation clause is driven by the LIVE create-clip intent
// (`createIntent` in create mode, `hasReel` in edit mode), NEVER by a star count.
// No branch may claim "one more star" / "five stars creates a clip" - that false
// threshold (E47: 4 stars, creation ON, "one more star" still shown) is the bug.
describe('getRatingCaption (create mode)', () => {
  it('no rating yet -> asks for a rating, outcome follows the create intent', () => {
    expect(getRatingCaption(null, true, false)).toBe(
      'How good was this play? Rate it 1 to 5 - this saves the play without creating a clip.'
    );
    expect(getRatingCaption(null, true, true)).toBe(
      'How good was this play? Rate it 1 to 5 - this play will also become an editable clip.'
    );
    expect(getRatingCaption(0, true, false)).toBe(
      'How good was this play? Rate it 1 to 5 - this saves the play without creating a clip.'
    );
  });

  it('rating 1 -> "Mental lapse" learn-from caption, regardless of layer or intent', () => {
    expect(getRatingCaption(1, true, false)).toBe('Mental lapse (??) - a play to learn from.');
    expect(getRatingCaption(1, false, true)).toBe('Mental lapse (??) - a play to learn from.');
  });

  it('rating 2 -> "Technical lapse" learn-from caption, regardless of layer or intent', () => {
    expect(getRatingCaption(2, true, false)).toBe('Technical lapse (?) - a play to learn from.');
    expect(getRatingCaption(2, false, true)).toBe('Technical lapse (?) - a play to learn from.');
  });

  it('rating 3 -> "Interesting play" second-look caption, regardless of intent', () => {
    expect(getRatingCaption(3, true, false)).toBe('Interesting play (!?) - worth a second look.');
    expect(getRatingCaption(3, true, true)).toBe('Interesting play (!?) - worth a second look.');
  });

  // E47 regression pin: 4 stars with creation toggled ON must NOT ask for another star.
  it('rating 4 -> outcome follows the toggle, never demands another star', () => {
    expect(getRatingCaption(4, true, true)).toBe(
      'Good play (!) - this play will also become an editable clip.'
    );
    expect(getRatingCaption(4, true, false)).toBe(
      'Good play (!) - this saves the play without creating a clip.'
    );
    expect(getRatingCaption(4, true, true)).not.toMatch(/one more star|another star/);
  });

  it('rating 5 + My Athlete -> outcome follows the toggle, not the star count', () => {
    expect(getRatingCaption(5, true, true)).toBe(
      'Brilliant play (!!) - this play will also become an editable clip.'
    );
    expect(getRatingCaption(5, true, false)).toBe(
      'Brilliant play (!!) - this saves the play without creating a clip.'
    );
  });

  it('rating 5 + Team -> "Brilliant team play" label, outcome still follows the toggle', () => {
    expect(getRatingCaption(5, false, true)).toBe(
      'Brilliant team play (!!) - this play will also become an editable clip.'
    );
    expect(getRatingCaption(5, false, false)).toBe(
      'Brilliant team play (!!) - this saves the play without creating a clip.'
    );
  });

  it('no create-clip claim ever depends on a star count (all ratings x intent)', () => {
    for (const rating of [null, 1, 2, 3, 4, 5]) {
      for (const mine of [true, false]) {
        for (const intent of [true, false]) {
          expect(getRatingCaption(rating, mine, intent)).not.toMatch(/star.*creates a clip|one more star|another star/);
        }
      }
    }
  });
});

describe('getEditRatingCaption (edit mode)', () => {
  it('no rating yet -> asks for a rating, makes no creation promise', () => {
    const caption = getEditRatingCaption(null, true, false);
    expect(caption).toBe('How good was this play? Rate it 1 to 5.');
    expect(caption).not.toMatch(/star.*creates a clip/);
  });

  it('rating 2 -> "Technical lapse" learn-from caption', () => {
    expect(getEditRatingCaption(2, true, false)).toBe('Technical lapse (?) - a play to learn from.');
  });

  // E47 in edit mode: creation is a manual control, never rating-gated - the
  // rating===4 branch must read off hasReel, never demand another star.
  it('rating 4 -> reads off hasReel, never demands another star', () => {
    expect(getEditRatingCaption(4, true, false)).toBe('Good play (!) - create a clip below.');
    expect(getEditRatingCaption(4, true, true)).toBe('Good play (!) - clip already created from play.');
    expect(getEditRatingCaption(4, true, false)).not.toMatch(/one more star|another star/);
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
    expect(getEditRatingCaption(5, false, true)).toBe(
      "Brilliant team play (!!) - team plays don't create clips."
    );
  });

  it('no create-clip claim ever depends on a star count (all ratings x hasReel)', () => {
    for (const rating of [null, 1, 2, 3, 4, 5]) {
      for (const mine of [true, false]) {
        for (const hasReel of [true, false]) {
          expect(getEditRatingCaption(rating, mine, hasReel)).not.toMatch(/star.*creates a clip|one more star|another star/);
        }
      }
    }
  });
});
