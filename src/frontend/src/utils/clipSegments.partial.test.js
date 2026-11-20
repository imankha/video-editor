import { describe, it, expect } from 'vitest';
import { clipSegments } from './clipSelectors';
import { nextSegments } from './segmentsMirror';

/**
 * T17890: the backend stores segments_data with only the keys a gesture wrote
 * (clear_trim_range on an untouched clip writes {trimRange: null}); its handlers
 * read a missing key as empty. The Frame screen's split mirror
 * (FocusContainer.mirrorSegments) then threw "boundaries is not iterable" before
 * the split_segment save was sent, so the split showed but was never saved.
 */
describe('clipSegments with a partial stored cut list (T17890)', () => {
  it('a split on a clip whose stored cut list is {trimRange: null} composes', () => {
    const clip = { id: 48, segments_data: { trimRange: null } };
    const next = nextSegments(clipSegments(clip, 8), { type: 'split', time: 4 });
    expect(next.boundaries).toEqual([0, 4, 8]);
    expect(next.segmentSpeeds).toEqual({});
    expect(next.trimRange).toBeNull();
  });

  it('keeps every stored key', () => {
    const clip = { id: 1, segments_data: { segmentSpeeds: { 0: 0.5 }, trimRange: { start: 1, end: 7 } } };
    expect(clipSegments(clip, 8)).toEqual({
      boundaries: [0, 8], userSplits: [], segmentSpeeds: { 0: 0.5 }, trimRange: { start: 1, end: 7 },
    });
  });
});
