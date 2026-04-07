import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { PlaybackControls } from './PlaybackControls';

const defaultProps = {
  isPlaying: false,
  virtualTime: 5,
  totalVirtualDuration: 30,
  segments: [
    { clipId: 'c1', virtualStart: 0, virtualEnd: 10, startTime: 20, endTime: 30, duration: 10 },
    { clipId: 'c2', virtualStart: 10, virtualEnd: 22, startTime: 5, endTime: 17, duration: 12 },
    { clipId: 'c3', virtualStart: 22, virtualEnd: 30, startTime: 0, endTime: 8, duration: 8 },
  ],
  activeClipId: 'c1',
  activeClipName: 'Assist',
  currentSegment: { clipId: 'c1', virtualStart: 0, virtualEnd: 10, startTime: 20, endTime: 30, duration: 10 },
  onTogglePlay: vi.fn(),
  onRestart: vi.fn(),
  onSeek: vi.fn(),
  onSeekWithinSegment: vi.fn(),
  onStartScrub: vi.fn(),
  onEndScrub: vi.fn(),
  onExitPlayback: vi.fn(),
  playbackRate: 1,
  onPlaybackRateChange: vi.fn(),
};

describe('PlaybackControls — Clip Scrub Bar', () => {
  it('renders clip scrub bar when currentSegment exists', () => {
    render(<PlaybackControls {...defaultProps} />);
    expect(screen.getByTestId('clip-scrub-bar')).toBeTruthy();
  });

  it('does not render clip scrub bar when currentSegment is null', () => {
    render(<PlaybackControls {...defaultProps} currentSegment={null} />);
    expect(screen.queryByTestId('clip-scrub-bar')).toBeNull();
  });

  it('displays clip name', () => {
    render(<PlaybackControls {...defaultProps} />);
    expect(screen.getByTestId('clip-scrub-bar').textContent).toContain('Assist');
  });

  it('displays clip-relative time', () => {
    // virtualTime=5, segment virtualStart=0 → clipElapsed=5, duration=10
    render(<PlaybackControls {...defaultProps} />);
    const barText = screen.getByTestId('clip-scrub-bar').textContent;
    expect(barText).toContain('0:05');
    expect(barText).toContain('0:10');
  });

  it('calls onSeekWithinSegment with correct actualTime on click', () => {
    const onSeekWithinSegment = vi.fn();
    const onStartScrub = vi.fn();
    const onEndScrub = vi.fn();
    render(
      <PlaybackControls
        {...defaultProps}
        onSeekWithinSegment={onSeekWithinSegment}
        onStartScrub={onStartScrub}
        onEndScrub={onEndScrub}
      />
    );

    const track = screen.getByTestId('clip-scrub-track');
    // Mock getBoundingClientRect for the track
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, right: 200, bottom: 10, height: 10 });

    // Click at 50% = startTime + 0.5 * duration = 20 + 0.5 * 10 = 25
    fireEvent.mouseDown(track, { clientX: 100 });

    expect(onStartScrub).toHaveBeenCalled();
    expect(onSeekWithinSegment).toHaveBeenCalledWith(25);
  });
});
