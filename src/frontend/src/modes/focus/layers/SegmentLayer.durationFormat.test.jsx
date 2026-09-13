import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import SegmentLayer from './SegmentLayer';

/**
 * T9480 Stage D5 -- the segment title's inline toFixed(1) duration text moves
 * to the shared formatLength(TENTH) (a span, rounds half-up), matching the
 * one time-format rule instead of a private toFixed call.
 */
function seg(index, extra = {}) {
  return {
    index,
    speed: 0.5,
    actualDuration: 6.027,
    visualDuration: 12.05,
    isFirst: true,
    isLast: true,
    isTrimmed: false,
    ...extra,
  };
}

describe('SegmentLayer duration formatting in the title (T9480 Stage D5)', () => {
  it('renders the title using formatLength round-half-up, not raw toFixed', () => {
    const segments = [seg(0)];
    const { container } = render(
      <SegmentLayer
        segments={segments}
        boundaries={[0, 6.027]}
        duration={6.027}
        visualDuration={12.05}
        currentTime={0}
        onAddBoundary={vi.fn()}
        onRemoveBoundary={vi.fn()}
        onSegmentSpeedChange={vi.fn()}
        onSegmentTrim={vi.fn()}
        isActive
        segmentVisualLayout={segments.map((segment) => ({
          segment,
          visualStartPercent: 0,
          visualWidthPercent: 100,
        }))}
      />,
    );
    const titled = container.querySelector('[title*="Segment 1"]');
    expect(titled).toBeTruthy();
    expect(titled.title).toBe('Segment 1: 0.5x (6.0s → 12.1s)');
  });
});
