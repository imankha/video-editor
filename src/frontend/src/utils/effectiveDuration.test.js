import { describe, it, expect, vi } from 'vitest';
import {
  calculateEffectiveDuration,
  sumEffectiveDurations,
  buildClipMetadata,
} from './effectiveDuration';

describe('effectiveDuration', () => {
  describe('calculateEffectiveDuration', () => {
    it('no edits -> full source duration', () => {
      expect(calculateEffectiveDuration({ id: 1, duration: 6 })).toBe(6);
    });

    it('trim -> trimmed source length (no-speed clip equals trimmed source)', () => {
      const clip = { id: 1, duration: 10, segments: { trimRange: { start: 2, end: 7 } } };
      expect(calculateEffectiveDuration(clip)).toBe(5);
    });

    it('trimRange at clip level (no segments)', () => {
      expect(calculateEffectiveDuration({ id: 1, duration: 30, trimRange: { start: 5, end: 15 } })).toBe(10);
    });

    it('acceptance: 6s clip + 3s at 0.5x slow-mo -> 9s output', () => {
      // boundaries [0,3,6]; segment 0 (0-3s) at 0.5x doubles to 6s, segment 1 (3-6s) at 1x = 3s
      const clip = {
        id: 1,
        duration: 6,
        segments: { boundaries: [0, 3, 6], segmentSpeeds: { '0': 0.5 } },
      };
      expect(calculateEffectiveDuration(clip)).toBe(9);
    });

    it('speed change updates the value (full clip at 0.5x doubles)', () => {
      const clip = { id: 1, duration: 10, segments: { boundaries: [0, 10], segmentSpeeds: { '0': 0.5 } } };
      expect(calculateEffectiveDuration(clip)).toBe(20);
    });

    it('reads saved segments_data for a non-selected clip (same result as live segments)', () => {
      const clip = {
        id: 2,
        duration: 6,
        segments_data: { boundaries: [0, 3, 6], segmentSpeeds: { '0': 0.5 } },
      };
      expect(calculateEffectiveDuration(clip)).toBe(9);
    });

    it('live segments take precedence over stale segments_data', () => {
      const clip = {
        id: 3,
        duration: 6,
        // live edit: whole clip at 0.5x -> 12s
        segments: { boundaries: [0, 6], segmentSpeeds: { '0': 0.5 } },
        // stale saved state that should be ignored
        segments_data: { boundaries: [0, 6], segmentSpeeds: {} },
      };
      expect(calculateEffectiveDuration(clip)).toBe(12);
    });

    it('handles DB export format (segments array + trim_start/trim_end)', () => {
      const clip = {
        id: 4,
        duration: 10,
        segments: {
          trim_start: 0,
          trim_end: 10,
          segments: [
            { start: 0, end: 4, speed: 0.5 }, // 8s
            { start: 4, end: 10, speed: 1.0 }, // 6s
          ],
        },
      };
      expect(calculateEffectiveDuration(clip)).toBe(14);
    });

    it('clips speed segments to the trim range', () => {
      // 5s at 0.5x but only 0-2s survives the trim -> 4s output
      const clip = {
        id: 5,
        duration: 10,
        segments: { boundaries: [0, 5, 10], segmentSpeeds: { '0': 0.5 }, trimRange: { start: 0, end: 2 } },
      };
      expect(calculateEffectiveDuration(clip)).toBe(4);
    });

    it('missing duration warns (visible internal-data gap, no fabricated fallback)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = calculateEffectiveDuration({ id: 9 });
      expect(warn).toHaveBeenCalled();
      expect(Number.isNaN(result)).toBe(true); // end(undefined) - start(0) = NaN -> caller hides
      warn.mockRestore();
    });
  });

  describe('sumEffectiveDurations', () => {
    it('null for empty / null input', () => {
      expect(sumEffectiveDurations([])).toBeNull();
      expect(sumEffectiveDurations(null)).toBeNull();
    });

    it('multi-clip sum: live selected clip (segments) + saved rest (segments_data)', () => {
      const clips = [
        // selected clip, live: 6s + 3s @0.5x -> 9s
        { id: 1, duration: 6, segments: { boundaries: [0, 3, 6], segmentSpeeds: { '0': 0.5 } } },
        // other clip, saved: plain 10s
        { id: 2, duration: 10, segments_data: {} },
        // other clip, saved: trimmed to 4s
        { id: 3, duration: 8, segments_data: { trimRange: { start: 2, end: 6 } } },
      ];
      expect(sumEffectiveDurations(clips)).toBe(23);
    });

    it('fail-closed: returns null if ANY clip has unknown (NaN) duration', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const clips = [
        { id: 1, duration: 6 },
        { id: 2 }, // missing duration -> NaN -> whole total hides
      ];
      expect(sumEffectiveDurations(clips)).toBeNull();
      warn.mockRestore();
    });
  });

  describe('buildClipMetadata (moved, still works)', () => {
    it('returns null for empty', () => {
      expect(buildClipMetadata([])).toBeNull();
    });

    it('cumulative timings honor speed changes', () => {
      const clips = [
        { fileName: 'a.mp4', duration: 10, segments: { boundaries: [0, 5, 10], segmentSpeeds: { '0': 0.5 } } },
      ];
      const result = buildClipMetadata(clips);
      // 5s @0.5x = 10s + 5s @1x = 5s -> 15s
      expect(result.source_clips[0].end_time).toBe(15);
    });
  });
});
