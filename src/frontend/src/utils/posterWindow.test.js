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
    it('unset marker -> midpoint', () => {
      expect(selectPosterFrame([2.0, 6.0], null)).toBe(4.0);
    });

    it('marker honoured verbatim inside the window', () => {
      expect(selectPosterFrame([2.0, 6.0], 3.3)).toBe(3.3);
    });

    it('marker honoured verbatim OUTSIDE the window (not clamped)', () => {
      expect(selectPosterFrame([2.0, 6.0], 0.1)).toBe(0.1);
      expect(selectPosterFrame([2.0, 6.0], 99.0)).toBe(99.0);
    });

    it('marker 0.0 is honoured, not treated as unset (falsy trap)', () => {
      expect(selectPosterFrame([2.0, 6.0], 0.0)).toBe(0.0);
    });
  });
});
