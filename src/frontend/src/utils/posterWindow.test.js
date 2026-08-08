import { describe, it, expect } from 'vitest';
import {
  openPlayWindow,
  selectPosterFrame,
  SPOTLIGHT_SKIP_SECONDS,
  END_MARGIN_SECONDS,
  MIN_WINDOW_SECONDS,
} from './posterWindow';

// T5410: client-side mirror of app/services/poster.py's open_play_window /
// select_poster_frame -- same cases as the backend suite, so the timeline
// marker's default preview never diverges from what export actually picks.

describe('posterWindow', () => {
  describe('openPlayWindow', () => {
    it('no slow-mo -> whole clip minus end margin', () => {
      expect(openPlayWindow(null, 10.0)).toEqual([0, 10.0 - END_MARGIN_SECONDS]);
    });

    it('no slow-mo, zero duration clamps at zero', () => {
      expect(openPlayWindow(null, 0)).toEqual([0, 0]);
    });

    it('slow-mo: skips the spotlight and clamps the end margin', () => {
      expect(openPlayWindow([1.0, 8.0], 10.0)).toEqual([3.0, 8.0]);
    });

    it('end margin binds when the section runs to duration', () => {
      expect(openPlayWindow([1.0, 10.0], 10.0)).toEqual([3.0, 9.7]);
    });

    it('too short after skip -> degrades to the whole section', () => {
      const section = [0.0, 2.2];
      expect(openPlayWindow(section, 10.0)).toEqual(section);
    });

    it('section past duration -> degrades to the whole section', () => {
      const section = [12.0, 14.0];
      expect(openPlayWindow(section, 10.0)).toEqual(section);
    });

    it('exact MIN_WINDOW boundary is NOT degraded', () => {
      const start = 0;
      const end = SPOTLIGHT_SKIP_SECONDS + MIN_WINDOW_SECONDS;
      expect(openPlayWindow([start, end], end + 100)).toEqual([SPOTLIGHT_SKIP_SECONDS, end]);
    });
  });

  describe('selectPosterFrame', () => {
    it('unset marker, no section -> 2s into the window (T6630 round 7; was the midpoint)', () => {
      // No slow-mo section -> window.start is the clip's literal frame 0
      // (never skip-adjusted), so the +2.0 "don't pick frame 0" push applies.
      // Window width 8.0 -- start+2.0 (4.0) and the midpoint (6.0) DIFFER
      // here, so this discriminates the two rules.
      expect(selectPosterFrame([2.0, 10.0], null, null)).toBe(4.0);
    });

    it('unset marker, no section, clamps to the window end when shorter than 2s', () => {
      expect(selectPosterFrame([2.0, 2.3], null, null)).toBe(2.3);
    });

    it('unset marker, WITH section -> the window\'s own start (T6630 round 8)', () => {
      // Section present -> window.start already IS section.start +
      // SPOTLIGHT_SKIP_SECONDS (past the contested/occluded opening
      // frames). Round 7 also added +2.0 here, stacking to ~4s past the
      // section's start; round 8 (live report: "6s instead of ~2s") drops
      // the second push.
      const section = [1.5, 20.0];
      const window = [3.5, 10.0]; // openPlayWindow(section, ...) would yield this
      expect(selectPosterFrame(window, null, section)).toBe(3.5);
    });

    it('marker honoured verbatim inside the window', () => {
      expect(selectPosterFrame([2.0, 6.0], 3.3, null)).toBe(3.3);
    });

    it('marker honoured verbatim OUTSIDE the window (not clamped)', () => {
      expect(selectPosterFrame([2.0, 6.0], 0.1, null)).toBe(0.1);
      expect(selectPosterFrame([2.0, 6.0], 99.0, null)).toBe(99.0);
    });

    it('marker 0.0 is honoured, not treated as unset (falsy trap)', () => {
      expect(selectPosterFrame([2.0, 6.0], 0.0, null)).toBe(0.0);
    });
  });
});
