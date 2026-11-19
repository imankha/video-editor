import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SegmentLayer from './SegmentLayer';

/**
 * T17650 (owner ruling 2026-11-18): the split that IS a trim edge offers no
 * Delete split -- the Undo trim control is the one control there, so nothing
 * sits under it. Splits that are not a trim edge keep Delete split.
 */

function seg(index, start, end, extra = {}) {
  return {
    index, start, end, speed: 1, actualDuration: end - start, visualDuration: end - start,
    isFirst: false, isLast: false, isTrimmed: false, ...extra,
  };
}

function renderLayer({ boundaries, segments, trimRange }) {
  const visible = segments.filter((s) => !s.isTrimmed);
  const visibleDuration = visible.reduce((sum, s) => sum + s.visualDuration, 0);
  let cursor = 0;
  return render(
    <SegmentLayer
      segments={segments}
      boundaries={boundaries}
      duration={boundaries[boundaries.length - 1]}
      visualDuration={visibleDuration}
      currentTime={0}
      onAddBoundary={vi.fn()}
      onRemoveBoundary={vi.fn()}
      onSegmentSpeedChange={vi.fn()}
      onSegmentTrim={vi.fn()}
      trimRange={trimRange}
      isActive
      segmentVisualLayout={visible.map((segment) => {
        const visualStartPercent = (cursor / visibleDuration) * 100;
        cursor += segment.visualDuration;
        return { segment, visualStartPercent, visualWidthPercent: (segment.visualDuration / visibleDuration) * 100 };
      })}
    />
  );
}

describe('SegmentLayer trim edge (T17650)', () => {
  it('offers no Delete split on the split that is the end-trim edge', () => {
    renderLayer({
      boundaries: [0, 5.25, 7.5],
      segments: [seg(0, 0, 5.25, { isFirst: true, isLast: true }), seg(1, 5.25, 7.5, { isTrimmed: true })],
      trimRange: { start: 0, end: 5.25 },
    });
    expect(screen.queryByTitle('Delete split')).toBeNull();
  });

  it('offers no Delete split on the split that is the start-trim edge', () => {
    renderLayer({
      boundaries: [0, 2, 7.5],
      segments: [seg(0, 0, 2, { isTrimmed: true }), seg(1, 2, 7.5, { isFirst: true, isLast: true })],
      trimRange: { start: 2, end: 7.5 },
    });
    expect(screen.queryByTitle('Delete split')).toBeNull();
  });

  it('keeps Delete split on a split that is not a trim edge', () => {
    renderLayer({
      boundaries: [0, 3, 5.25, 7.5],
      segments: [
        seg(0, 0, 3, { isFirst: true }),
        seg(1, 3, 5.25, { isLast: true }),
        seg(2, 5.25, 7.5, { isTrimmed: true }),
      ],
      trimRange: { start: 0, end: 5.25 },
    });
    const buttons = screen.getAllByTitle('Delete split');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('[title^="Split at"]')?.getAttribute('title')).toContain('3.00');
  });
});
