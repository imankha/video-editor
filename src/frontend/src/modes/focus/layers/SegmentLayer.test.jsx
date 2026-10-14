import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SegmentLayer from './SegmentLayer';
import { GuideScope } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE } from '../../../components/instructions/guideTargets';
import { useSettingsStore } from '../../../stores/settingsStore';

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

describe('SegmentLayer guide pulses (T12770: trim goes through useGuidePulse)', () => {
  const withScope = (pulse) => {
    useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } }));
    const segments = [seg(0, 1, { isLast: false }), seg(1, 1, { isFirst: false })];
    return render(
      <GuideScope guides={[{ pulse }]}>
        <SegmentLayer
          segments={segments}
          boundaries={[0, 2, 4]}
          duration={4}
          visualDuration={8}
          currentTime={0}
          onAddBoundary={vi.fn()}
          onRemoveBoundary={vi.fn()}
          onSegmentSpeedChange={vi.fn()}
          onSegmentTrim={vi.fn()}
          isActive
          segmentVisualLayout={segments.map((segment, i) => ({ segment, visualStartPercent: i * 50, visualWidthPercent: 50 }))}
        />
      </GuideScope>
    );
  };

  it('TRIM_TRACK pulses the track and no button', () => {
    const { container } = withScope(GUIDE_PULSE.TRIM_TRACK);
    expect(container.querySelector('.segment-track').className).toContain('coach-target-pulse');
    expect(container.querySelectorAll('.segment-track button.coach-target-pulse')).toHaveLength(0);
  });

  it('TRIM_ADJUST pulses the speed buttons and not the track', () => {
    const { container } = withScope(GUIDE_PULSE.TRIM_ADJUST);
    expect(container.querySelector('.segment-track').className).not.toContain('coach-target-pulse');
    expect(container.querySelectorAll('.segment-track button.coach-target-pulse').length).toBeGreaterThan(0);
  });

  it('pulses nothing for another target', () => {
    const { container } = withScope(GUIDE_PULSE.PLAY);
    expect(container.querySelectorAll('.coach-target-pulse')).toHaveLength(0);
  });
});
