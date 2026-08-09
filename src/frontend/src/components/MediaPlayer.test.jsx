import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MediaPlayer } from './MediaPlayer';

// T5130: MediaPlayer resolves the sport-ball scrub handle from the publishing
// profile's sport and threads it to VideoControls. A genuinely-unknown sport
// must fall back to today's plain dot -- never a fabricated soccer ball.

const plainDot = (c) => c.querySelector('.rounded-full.bg-purple-500');
const glyph = (c) => c.querySelector('[data-testid="scrub-handle-glyph"]');

describe('MediaPlayer sport -> scrub handle (T5130)', () => {
  it('shows the soccer ball for a soccer profile', () => {
    const { container } = render(<MediaPlayer src="blob:x" autoPlay={false} sport="soccer" />);
    expect(glyph(container)?.textContent).toBe('⚽');
  });

  it('shows the football glyph for a football profile', () => {
    const { container } = render(
      <MediaPlayer src="blob:x" autoPlay={false} sport="american_football" />,
    );
    expect(glyph(container)?.textContent).toBe('🏈');
  });

  it('falls back to the plain dot when sport is unknown (no soccer fabrication)', () => {
    const { container } = render(<MediaPlayer src="blob:x" autoPlay={false} />);
    expect(glyph(container)).toBeNull();
    expect(plainDot(container)).not.toBeNull();
  });
});

// Bug found live-testing T5220 (2026-08-08): a share's intro pre-roll flips
// `autoPlay` false->true when it finishes, but toggling the `autoplay`
// attribute on an already-mounted <video> does nothing per the HTML spec --
// the video was left paused with no auto-continue. MediaPlayer must call
// play() explicitly on that transition instead of relying on the attribute.
describe('MediaPlayer autoPlay prop toggling after mount (T5220 intro pre-roll handoff)', () => {
  it('does not call play() on initial mount (the autoplay attribute handles that)', () => {
    window.HTMLMediaElement.prototype.play = vi.fn();
    window.HTMLMediaElement.prototype.pause = vi.fn();
    render(<MediaPlayer src="blob:x" autoPlay={true} />);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('calls play() when autoPlay flips false -> true after mount', () => {
    window.HTMLMediaElement.prototype.play = vi.fn();
    window.HTMLMediaElement.prototype.pause = vi.fn();
    const { rerender } = render(<MediaPlayer src="blob:x" autoPlay={false} />);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    rerender(<MediaPlayer src="blob:x" autoPlay={true} />);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('does not call play() when autoPlay flips true -> false (e.g. end card shown)', () => {
    window.HTMLMediaElement.prototype.play = vi.fn();
    window.HTMLMediaElement.prototype.pause = vi.fn();
    const { rerender } = render(<MediaPlayer src="blob:x" autoPlay={true} />);
    rerender(<MediaPlayer src="blob:x" autoPlay={false} />);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});
