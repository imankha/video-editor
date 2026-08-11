// T6880 -- the ONE predicate the canvas burn-in (TextOverlayPreview) and the
// Text settings panel (OverlayModeView) both use to decide "is this region
// under the playhead", so the two surfaces can never disagree. The
// selected-region editing ghost is layered on TOP of this, not inside it.

import { describe, it, expect } from 'vitest';
import { isRegionUnderPlayhead, PLAYHEAD_EPSILON } from './textRegionPlayhead';

const region = (startTime, endTime) => ({ startTime, endTime });

describe('isRegionUnderPlayhead (T6880 shared predicate)', () => {
  it('true inside the half-open [start, end) window', () => {
    expect(isRegionUnderPlayhead(region(2, 5), 3)).toBe(true);
    expect(isRegionUnderPlayhead(region(2, 5), 2)).toBe(true); // start inclusive
  });

  it('false past the region end (the reported bug: playhead dragged past end)', () => {
    expect(isRegionUnderPlayhead(region(2, 5), 5.1)).toBe(false);
    // end is EXCLUSIVE (± epsilon): a full 0.1s past the end is outside
    expect(isRegionUnderPlayhead(region(2, 5), 5 + 0.1)).toBe(false);
  });

  it('absorbs a sub-millisecond seek quantization just below start (T6630 round 7 item 1)', () => {
    expect(isRegionUnderPlayhead(region(2, 5), 2 - 0.0000007)).toBe(true);
  });

  it('EPSILON stays far below one video frame (~0.033s at 30fps)', () => {
    expect(PLAYHEAD_EPSILON).toBeLessThan(0.033);
    // a real 0.1s gap outside the range is NOT tolerated
    expect(isRegionUnderPlayhead(region(2, 5), 2 - 0.1)).toBe(false);
  });
});
