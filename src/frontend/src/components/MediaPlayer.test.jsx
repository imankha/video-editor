import { describe, it, expect } from 'vitest';
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
