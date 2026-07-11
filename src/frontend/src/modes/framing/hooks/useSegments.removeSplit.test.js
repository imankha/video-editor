/**
 * T4220: removing a split must re-index segment speeds, not drop them, and must
 * produce the SAME result as the backend remove_segment_split handler.
 *
 * Rule (k = sorted index of the removed split; splits-only list):
 *   - i < k     -> keep speeds[i]
 *   - merged k  -> keep only if speeds[k] === speeds[k+1], else omit (plays 1x)
 *   - i > k + 1 -> speeds[i] moves to key (i - 1)
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSegments, reindexSegmentSpeedsOnRemove } from './useSegments';

describe('reindexSegmentSpeedsOnRemove (T4220 pure rule, backend parity)', () => {
  it('remove middle split between different speeds -> merged omitted, later shifts down', () => {
    // splits [10,20,30], k=1 (remove 20). seg1=0.5 merges with seg2=1x -> omit.
    // seg3=0.25 shifts to index 2.
    expect(reindexSegmentSpeedsOnRemove({ '0': 1, '1': 0.5, '3': 0.25 }, 1))
      .toEqual({ '0': 1, '2': 0.25 });
  });

  it('remove split between two equal speeds -> merged keeps the speed', () => {
    // splits [10,20], k=1. seg1=0.5 merges with seg2=0.5 -> keep 0.5 at index 1.
    expect(reindexSegmentSpeedsOnRemove({ '1': 0.5, '2': 0.5 }, 1))
      .toEqual({ '1': 0.5 });
  });

  it('remove first split -> merged omitted, later shifts down', () => {
    // splits [10,20], k=0. seg0=0.5 merges with seg1=1x -> omit. seg2=0.25 -> index 1.
    expect(reindexSegmentSpeedsOnRemove({ '0': 0.5, '1': 1, '2': 0.25 }, 0))
      .toEqual({ '1': 0.25 });
  });

  it('remove last split -> earlier speed untouched, merged omitted', () => {
    // splits [10,20], k=1. seg1(default) merges with seg2=0.25 -> omit. seg0=0.5 kept.
    expect(reindexSegmentSpeedsOnRemove({ '0': 0.5, '2': 0.25 }, 1))
      .toEqual({ '0': 0.5 });
  });
});

describe('useSegments.removeBoundary re-indexes speeds (T4220)', () => {
  it('preserves unrelated slow-mo speeds when an unrelated split is removed', () => {
    const { result } = renderHook(() => useSegments());
    act(() => {
      result.current.initializeWithDuration(40.0);
    });
    act(() => {
      result.current.restoreState(
        { boundaries: [10, 20, 30], segmentSpeeds: { '0': 1, '1': 0.5, '3': 0.25 } },
        40.0,
      );
    });

    act(() => {
      result.current.removeBoundary(20); // k=1
    });

    // 0.5 (merged with a default segment) drops; 0.25 shifts from seg3 -> seg2.
    expect(result.current.segmentSpeeds).toEqual({ '0': 1, '2': 0.25 });
    expect(result.current.userSplits).toEqual([10, 30]);
  });
});
