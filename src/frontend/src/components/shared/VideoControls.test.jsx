import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { VideoControls } from './VideoControls';
import { sportEmoji } from '../../modes/annotate/constants/tagRegistry';

// T5130: the scrub handle becomes the publishing profile's sport ball when a
// `handleGlyph` string is passed; absent, it stays the plain purple dot.

const baseProps = {
  isPlaying: false,
  currentTime: 5,
  duration: 20,
  onTogglePlay: () => {},
  onSeekForward: () => {},
  onSeekBackward: () => {},
  onSeek: () => {},
  onVolumeChange: () => {},
  onToggleMute: () => {},
  onToggleFullscreen: () => {},
};

// The plain purple dot: rounded-full + bg-purple-500 (the progress fill is
// bg-purple-500 but NOT rounded-full, so this selector is dot-specific).
const plainDot = (c) => c.querySelector('.rounded-full.bg-purple-500');

describe('VideoControls scrub handle (T5130)', () => {
  it('renders the soccer ball glyph when handleGlyph is ⚽', () => {
    const { getByTestId, container } = render(
      <VideoControls {...baseProps} handleGlyph={sportEmoji('soccer')} />,
    );
    const glyph = getByTestId('scrub-handle-glyph');
    expect(glyph.textContent).toBe('⚽');
    // The glyph replaces the plain dot.
    expect(plainDot(container)).toBeNull();
  });

  it('renders the football glyph for a football profile (not hardcoded ⚽)', () => {
    const { getByTestId } = render(
      <VideoControls {...baseProps} handleGlyph={sportEmoji('american_football')} />,
    );
    expect(getByTestId('scrub-handle-glyph').textContent).toBe('🏈');
  });

  it('renders the plain purple dot (no glyph) when handleGlyph is absent', () => {
    const { queryByTestId, container } = render(<VideoControls {...baseProps} />);
    expect(queryByTestId('scrub-handle-glyph')).toBeNull();
    expect(plainDot(container)).not.toBeNull();
  });

  it('rides the progress: the glyph is positioned by the current progress %', () => {
    // currentTime 5 / duration 20 = 25% -> left: calc(25% - ...px)
    const { getByTestId } = render(
      <VideoControls {...baseProps} handleGlyph="⚽" />,
    );
    expect(getByTestId('scrub-handle-glyph').style.left).toContain('25%');
  });
});
