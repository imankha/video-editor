import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipScrubRegion } from './ClipScrubRegion';

/**
 * T9480 Stage D1 -- the trim detail readout FLOORS at the shown precision
 * (it's an instant, a position), matching the rest of the app instead of
 * rounding. Fixes the reported bug (2.973 read "00:03.0") and the "00:60.0"
 * overflow (59.97 rounded its seconds component up past 60).
 */
function makeController(initial = 0) {
  const state = { time: initial, paused: true };
  const el = { addEventListener: () => {}, removeEventListener: () => {}, paused: true };
  return {
    state,
    play: () => { state.paused = false; },
    pause: () => { state.paused = true; },
    seek: (t) => { state.time = t; },
    getCurrentTime: () => state.time,
    isPaused: () => state.paused,
    getActiveElement: () => el,
    setVolume: () => {},
    setMuted: () => {},
  };
}

const baseProps = (controller, overrides = {}) => ({
  currentTime: 100,
  videoDuration: 600,
  existingClip: null,
  startTime: 98,
  endTime: 104,
  onStartTimeChange: () => {},
  onEndTimeChange: () => {},
  onSeek: () => {},
  onDragStart: () => {},
  onDragEnd: () => {},
  videoController: controller,
  ...overrides,
});

describe('ClipScrubRegion trim readout (T9480 Stage D1 -- floors, does not round)', () => {
  it('reads 0:02.9 for a 2.973 start, not 00:03.0 (the reported bug)', () => {
    const controller = makeController(2.973);
    render(<ClipScrubRegion {...baseProps(controller, { startTime: 2.973, endTime: 9 })} />);
    expect(screen.getByText('0:02.9')).toBeTruthy();
    expect(screen.queryByText('00:03.0')).toBeNull();
  });

  it('never renders 00:60.0 for a 59.97 boundary (the overflow bug)', () => {
    const controller = makeController(59.97);
    render(<ClipScrubRegion {...baseProps(controller, { startTime: 59.97, endTime: 70 })} />);
    expect(screen.getByText('0:59.9')).toBeTruthy();
    expect(screen.queryByText('00:60.0')).toBeNull();
  });

  it('reads 0:09.0 for an exact whole-second end (9.000)', () => {
    const controller = makeController(2.973);
    render(<ClipScrubRegion {...baseProps(controller, { startTime: 2.973, endTime: 9 })} />);
    expect(screen.getByText('0:09.0')).toBeTruthy();
  });

  it('compact layout also floors (same shared formatter)', () => {
    const controller = makeController(2.973);
    render(<ClipScrubRegion {...baseProps(controller, { startTime: 2.973, endTime: 9, compact: true })} />);
    expect(screen.getByText('0:02.9')).toBeTruthy();
    expect(screen.getByText('0:09.0')).toBeTruthy();
  });

  it('the span readout carries data-testid="clip-length" and names no cost (T9480 Stage E4 -- Annotate charges nothing)', () => {
    const controller = makeController(2.973);
    render(<ClipScrubRegion {...baseProps(controller, { startTime: 2.973, endTime: 9 })} />);
    const lengthEl = screen.getByTestId('clip-length');
    expect(lengthEl.textContent).toBe('6.0s');
    expect(lengthEl.textContent).not.toMatch(/credit/i);
  });
});
