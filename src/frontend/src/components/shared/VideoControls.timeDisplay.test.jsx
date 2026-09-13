import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoControls } from './VideoControls';

/**
 * T9480 Stage D3 -- the shared player's DEFAULT time display switches from
 * bare decimal seconds (formatTimeCompact, "125.3") to clock notation
 * (formatInstant TENTH, "2:05.3"). Isolated commit: this is the shared
 * published-reel player (MediaPlayer/SharedVideoOverlay); TutorialVideoModal
 * already overrides `formatTime` with formatClock so it is unaffected.
 */

const baseProps = {
  isPlaying: false,
  onTogglePlay: () => {},
  onSeekForward: () => {},
  onSeekBackward: () => {},
  onSeek: () => {},
  onVolumeChange: () => {},
  onToggleMute: () => {},
  onToggleFullscreen: () => {},
};

describe('VideoControls default time display (T9480 Stage D3)', () => {
  it('shows clock notation "2:05.3", not bare decimal seconds "125.3"', () => {
    render(<VideoControls {...baseProps} currentTime={125.3} duration={200} />);
    expect(screen.getByText('2:05.3')).toBeTruthy();
    expect(screen.queryByText(/125\.3/)).toBeNull();
  });

  it('a custom formatTime override (e.g. TutorialVideoModal formatClock) still wins', () => {
    const formatClock = (s) => `clock:${Math.floor(s)}`;
    render(
      <VideoControls {...baseProps} currentTime={125.3} duration={200} formatTime={formatClock} />,
    );
    expect(screen.getByText(/clock:125/)).toBeTruthy();
  });
});
