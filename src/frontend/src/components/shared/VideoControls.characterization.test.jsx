import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { VideoControls } from './VideoControls';

// T6320 CHARACTERIZATION — pins VideoControls' current scrub-track rendering and
// seek behaviour BEFORE extracting the shared ProgressTrack / PlayheadHandle
// primitives. These must stay GREEN through the mechanical move (steps 4-5:
// "no visual change"). If the extraction changes any of these, the move was not
// mechanical. jsdom has no window.matchMedia, so IS_COARSE is falsy here — these
// assertions capture the fine-pointer (non-coarse) treatment.

const baseProps = {
  isPlaying: false,
  currentTime: 5,
  duration: 20, // 5/20 = 25% progress
  onTogglePlay: () => {},
  onSeekForward: () => {},
  onSeekBackward: () => {},
  onSeek: () => {},
  onVolumeChange: () => {},
  onToggleMute: () => {},
  onToggleFullscreen: () => {},
};

// The track background: bg-white/25 rounded-full, directly under the timeline.
const track = (c) => c.querySelector('.bg-white\\/25.rounded-full');
// The progress fill: bg-purple-500 but NOT rounded-full (that selector is the dot).
const fill = (c) => c.querySelector('.bg-purple-500:not(.rounded-full)');
// The plain purple dot handle.
const dot = (c) => c.querySelector('.rounded-full.bg-purple-500');

describe('VideoControls track rendering (T6320 characterization)', () => {
  it('renders the track as bg-white/25 rounded-full at 3px rest height', () => {
    const { container } = render(<VideoControls {...baseProps} />);
    const t = track(container);
    expect(t).not.toBeNull();
    expect(t.style.height).toBe('3px');
  });

  it('expands the track to 5px when hovering the timeline', () => {
    const { container, getByTestId } = render(<VideoControls {...baseProps} />);
    fireEvent.mouseEnter(getByTestId('scrub-timeline'));
    expect(track(container).style.height).toBe('5px');
  });

  it('renders the progress fill as bg-purple-500 at the current progress width', () => {
    const { container } = render(<VideoControls {...baseProps} />);
    const f = fill(container);
    expect(f).not.toBeNull();
    expect(f.style.width).toBe('25%');
  });

  it('renders NO hover fill until the timeline is hovered, then bg-white/20', () => {
    const { container, getByTestId } = render(<VideoControls {...baseProps} />);
    const timeline = getByTestId('scrub-timeline');
    timeline.getBoundingClientRect = () => ({
      left: 0, width: 200, top: 0, right: 200, bottom: 0, height: 10, x: 0, y: 0,
    });
    expect(container.querySelector('.bg-white\\/20')).toBeNull();
    fireEvent.mouseEnter(timeline);
    fireEvent.mouseMove(timeline, { clientX: 50 }); // 50/200 = 25% hover position
    expect(container.querySelector('.bg-white\\/20')).not.toBeNull();
  });

  it('renders the plain purple dot handle (12px rest) positioned at the progress %', () => {
    const { container } = render(<VideoControls {...baseProps} />);
    const d = dot(container);
    expect(d).not.toBeNull();
    expect(d.style.width).toBe('12px');
    expect(d.style.height).toBe('12px');
    // left is calc(progress% - halfWidth) so the dot centres on the progress edge.
    expect(d.style.left).toContain('25%');
    expect(d.style.left).toContain('6px');
  });
});

describe('VideoControls seek behaviour (T6320 characterization)', () => {
  it('seeks to the clicked fraction of duration on mousedown', () => {
    const onSeek = vi.fn();
    const { getByTestId } = render(<VideoControls {...baseProps} onSeek={onSeek} />);
    const timeline = getByTestId('scrub-timeline');
    timeline.getBoundingClientRect = () => ({
      left: 0, width: 200, top: 0, right: 200, bottom: 0, height: 10, x: 0, y: 0,
    });
    fireEvent.mouseDown(timeline, { clientX: 50 }); // 50/200 = 25% of 20s = 5s
    expect(onSeek).toHaveBeenCalledWith(5);
  });
});
