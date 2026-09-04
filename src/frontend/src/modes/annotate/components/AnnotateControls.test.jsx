import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AnnotateControls } from './AnnotateControls';

// T8760 item 10: while a clip is open for editing, the transport readout shows
// clip-relative time (elapsed / clip-duration). Outside clip-edit mode the
// absolute game-time readout is unchanged.

afterEach(cleanup);

const baseProps = {
  isPlaying: false,
  currentTime: 100,
  duration: 3600,
  onTogglePlay: () => {},
  onStepForward: () => {},
  onStepBackward: () => {},
  onSeekBackward: () => {},
  onRestart: () => {},
  onSpeedChange: () => {},
  onToggleFullscreen: () => {},
};

describe('AnnotateControls time readout (T8760)', () => {
  it('shows absolute game time when NOT editing a clip (clipEditBounds null)', () => {
    render(<AnnotateControls {...baseProps} clipEditBounds={null} />);
    // 100s -> 1:40, 3600s -> 60:00 (formatTime HH:MM:SS style).
    expect(screen.queryByTestId('clip-relative-time')).toBeNull();
    expect(screen.getByText(/1:40/)).toBeTruthy();
  });

  it('shows clip-relative elapsed / clip-duration when editing a clip', () => {
    // Clip [97.8, 105.1] -> length 7.3s; playhead 101 -> elapsed 3.2s.
    render(
      <AnnotateControls
        {...baseProps}
        currentTime={101}
        clipEditBounds={{ start: 97.8, end: 105.1 }}
      />,
    );
    const readout = screen.getByTestId('clip-relative-time');
    expect(readout.textContent).toBe('3.2s / 7.3s');
  });

  it('clamps clip-relative elapsed to [0, clip-length]', () => {
    // Playhead before the clip start -> elapsed floored at 0.0s.
    render(
      <AnnotateControls
        {...baseProps}
        currentTime={90}
        clipEditBounds={{ start: 97.8, end: 105.1 }}
      />,
    );
    expect(screen.getByTestId('clip-relative-time').textContent).toBe('0.0s / 7.3s');
  });
});
