import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9950 Slice 1: `showSegments` gates the segment/speed/trim track (both the
 * SegmentLayer block and its layer label). Default `true` keeps every existing
 * caller/test byte-identical (design doc §5 Slice 1).
 */

vi.mock('../../components/timeline/TimelineBase', () => ({
  TimelineBase: ({ layerLabels, children }) => (
    <div data-testid="timeline-base">
      <div data-testid="layer-labels">{layerLabels}</div>
      <div data-testid="layer-children">{children}</div>
    </div>
  ),
  EDGE_PADDING: 0,
}));
vi.mock('./layers/CropLayer', () => ({ default: () => <div data-testid="crop-layer" /> }));
vi.mock('./layers/SegmentLayer', () => ({ default: () => <div data-testid="segment-layer" /> }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { FocusTimeline } from './FocusTimeline';

const segments = [{ start: 0, end: 10, speed: 1 }];

function renderTimeline(overrides = {}) {
  return render(
    <FocusTimeline
      currentTime={0}
      duration={10}
      visualDuration={10}
      onSeek={() => {}}
      segments={segments}
      segmentBoundaries={[0, 10]}
      {...overrides}
    />
  );
}

describe('FocusTimeline showSegments gate (T9950 Slice 1)', () => {
  it('shows the segment track by default (unchanged for existing callers)', () => {
    renderTimeline();
    expect(screen.getByTestId('segment-layer')).toBeTruthy();
    expect(screen.getByTitle(/Speed & trim/i)).toBeTruthy();
  });

  it('hides the segment track when showSegments is false', () => {
    renderTimeline({ showSegments: false });
    expect(screen.queryByTestId('segment-layer')).toBeNull();
    expect(screen.queryByTitle(/Speed & trim/i)).toBeNull();
  });

  it('hides the segment track when there are no segments, regardless of showSegments', () => {
    renderTimeline({ segments: [], showSegments: true });
    expect(screen.queryByTestId('segment-layer')).toBeNull();
  });

  it('shows the segment track when showSegments is explicitly true and segments exist', () => {
    renderTimeline({ showSegments: true });
    expect(screen.getByTestId('segment-layer')).toBeTruthy();
  });
});
