import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { getRatingCaption, getEditRatingCaption, getRatingLabel, getRatingDisplay, RATING_BADGE_COLORS, RATING_BACKGROUND_COLORS, RATING_GLYPH_COLORS } from './clipConstants';
import { RatingIcon } from './RatingIcon';

// T9520 N35: the ONE documented star-to-descriptor mapping ("4 stars · Good"),
// used for the rating title/aria across the play list, the play editor and the
// timeline markers. Asserted here as the single source; render sites reuse it.
describe('getRatingLabel (N35 star-to-descriptor mapping)', () => {
  it('pairs the star count (singular at 1) with the canonical adjective', () => {
    expect(getRatingLabel(1)).toBe('1 star · Mental Lapse');
    expect(getRatingLabel(2)).toBe('2 stars · Technical Lapse');
    expect(getRatingLabel(3)).toBe('3 stars · Interesting');
    expect(getRatingLabel(4)).toBe('4 stars · Good');
    expect(getRatingLabel(5)).toBe('5 stars · Highlight');
  });

});

// T11110: the 5-star rating is the gesture that makes a highlight, so its
// adjective is "Highlight" and its color is gold. Palette P2 (owner ruling
// 2026-09-24) also recolors 1/2/4 to keep the set color-blind distinguishable
// and the backgrounds are the same hue at 0.15 alpha. These maps are the single
// source; every consumer (timeline, play list, recap, share) reads them.
describe('rating palette P2 (T11110)', () => {
  it('badge colors: gold at 5, no clash with the recolored 1/2/4', () => {
    expect(RATING_BADGE_COLORS[1]).toBe('#D55E00');
    expect(RATING_BADGE_COLORS[2]).toBe('#AD1457');
    expect(RATING_BADGE_COLORS[3]).toBe('#1565C0');
    expect(RATING_BADGE_COLORS[4]).toBe('#009E73');
    expect(RATING_BADGE_COLORS[5]).toBe('#F5B700');
    // all five distinct
    expect(new Set(Object.values(RATING_BADGE_COLORS)).size).toBe(5);
  });

  it('background tints are the same hue at 0.15 alpha', () => {
    expect(RATING_BACKGROUND_COLORS[1]).toBe('rgba(213, 94, 0, 0.15)');
    expect(RATING_BACKGROUND_COLORS[2]).toBe('rgba(173, 20, 87, 0.15)');
    expect(RATING_BACKGROUND_COLORS[3]).toBe('rgba(21, 101, 192, 0.15)');
    expect(RATING_BACKGROUND_COLORS[4]).toBe('rgba(0, 158, 115, 0.15)');
    expect(RATING_BACKGROUND_COLORS[5]).toBe('rgba(245, 183, 0, 0.15)');
  });

  it('glyph color on the badge face is dark on gold, white elsewhere', () => {
    // Behavioral: render the actual rating-5 icon and check what color its
    // notation glyph is drawn in — must never be #ffffff on the gold face.
    const { container } = render(createElement(RatingIcon, { rating: 5, size: 24 }));
    const fills = [...container.querySelectorAll('svg g')].map((g) => g.getAttribute('fill'));
    expect(fills).not.toContain('#ffffff');
    expect(RATING_GLYPH_COLORS[5]).toBe('#1a1300');
    for (const r of [1, 2, 3, 4]) {
      expect(RATING_GLYPH_COLORS[r]).toBe('#ffffff');
    }
  });
});

// T10690/T10710: raw_clips.rating is nullable now — a play can genuinely have
// NO rating on record. `getRatingLabel(null)` must stop inventing "3 stars ·
// Interesting" (the old DEFAULT_RATING fallback) and instead say so plainly;
// `getRatingDisplay(null)` must not draw one of the five real rating colors
// for a rating that was never given.
describe('getRatingLabel / getRatingDisplay — genuinely unrated (T10710)', () => {
  it('getRatingLabel(null) says "Not rated", not a fabricated 3-star default', () => {
    expect(getRatingLabel(null)).toBe('Not rated');
  });

  it('getRatingDisplay(null) has no notation and uses a neutral color, not one of the 1-5 palettes', () => {
    const display = getRatingDisplay(null);
    expect(display.notation).toBe('');
    expect(Object.values(RATING_BADGE_COLORS)).not.toContain(display.badgeColor);
    expect(Object.values(RATING_BACKGROUND_COLORS)).not.toContain(display.backgroundColor);
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
      'Highlight play (!!) - this play will also become an editable clip.'
    );
    expect(getRatingCaption(5, true, false)).toBe(
      'Highlight play (!!) - this saves the play without creating a clip.'
    );
  });

  it('rating 5 + Team -> "Highlight team play" label, outcome still follows the toggle', () => {
    expect(getRatingCaption(5, false, true)).toBe(
      'Highlight team play (!!) - this play will also become an editable clip.'
    );
    expect(getRatingCaption(5, false, false)).toBe(
      'Highlight team play (!!) - this saves the play without creating a clip.'
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
  // T11110: the "create a clip below" control no longer exists, so that false
  // clause is dropped (the caption rewrite proper is T11150/T11160).
  it('rating 4 -> reads off hasReel, never demands another star', () => {
    expect(getEditRatingCaption(4, true, false)).toBe('Good play (!).');
    expect(getEditRatingCaption(4, true, true)).toBe('Good play (!) - clip already created from play.');
    expect(getEditRatingCaption(4, true, false)).not.toMatch(/one more star|another star|create a clip below/);
  });

  it('rating 5 + My Athlete + no clip yet -> Highlight label, no removed-control claim', () => {
    const caption = getEditRatingCaption(5, true, false);
    expect(caption).toBe('Highlight play (!!).');
    expect(caption).not.toMatch(/will be created|create a clip below/);
  });

  it('rating 5 + My Athlete + clip already exists -> says so, does not re-offer creation', () => {
    expect(getEditRatingCaption(5, true, true)).toBe('Highlight play (!!) - clip already created from play.');
  });

  // T11110: team plays CAN become highlights (H13), so the "clip already created"
  // clause applies to the Team label the same as the My Athlete label.
  it('rating 5 + Team -> Highlight team label, reflects hasReel like My Athlete does', () => {
    expect(getEditRatingCaption(5, false, false)).toBe('Highlight team play (!!).');
    expect(getEditRatingCaption(5, false, true)).toBe(
      'Highlight team play (!!) - clip already created from play.'
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
