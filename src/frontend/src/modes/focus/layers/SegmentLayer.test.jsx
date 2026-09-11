import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SegmentLayer from './SegmentLayer';

/**
 * T9610: the current playback speed reads as a STATE (a settled readout on the
 * segment) rather than only as an action button. The readout is always present —
 * "Normal speed" at 1x, "0.5x slow-mo" when slowed — while the buttons below CHANGE it.
 */

function seg(index, speed, extra = {}) {
  return {
    index,
    speed,
    actualDuration: 4,
    visualDuration: speed === 1 ? 4 : 8,
    isFirst: true,
    isLast: true,
    isTrimmed: false,
    ...extra,
  };
}

function renderSegments(segments) {
  return render(
    <SegmentLayer
      segments={segments}
      boundaries={[0, 4]}
      duration={4}
      visualDuration={segments[0].visualDuration}
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
    />
  );
}

describe('SegmentLayer speed-as-state (T9610)', () => {
  it('shows "Normal speed" as a settled state for a 1x segment', () => {
    renderSegments([seg(0, 1)]);
    expect(screen.queryByText('Normal speed')).not.toBeNull();
  });

  it('shows the current slow-mo speed as a state for a slowed segment', () => {
    renderSegments([seg(0, 0.5)]);
    expect(screen.queryByText('0.5x slow-mo')).not.toBeNull();
  });

  it('keeps the change-speed action button distinct from the state readout', () => {
    renderSegments([seg(0, 1)]);
    // The action to switch to slow-mo is present as a button with a "Set speed" title.
    expect(screen.getByTitle('Set speed to 0.5x')).toBeTruthy();
  });
});
