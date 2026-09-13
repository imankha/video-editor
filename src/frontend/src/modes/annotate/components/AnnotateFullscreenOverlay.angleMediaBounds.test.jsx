import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

/**
 * T9480 review fix (MAJOR #5) -- when an angle is active, typed entry must
 * clamp to the ANGLE's own true media span (mediaBounds, threaded from
 * AnnotateModeView's buildGameTimeline().angles[].virtualStart/virtualEnd via
 * AnnotateContainer's angleData), NOT the whole backbone timeline
 * (videoDuration). Before this fix, every ClipScrubRegion instance hardcoded
 * {mediaStart: 0, mediaEnd: videoDuration} regardless of the active angle, so
 * a typed value past the angle's true end silently committed, then
 * AnnotateContainer's clampToSource moved it again at SAVE time -- what the
 * user saw/committed disagreed with what got stored.
 */

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => mockViewport(false)); // desktop

const baseProps = {
  isVisible: true,
  currentTime: 130,
  videoDuration: 6000, // the WHOLE backbone timeline -- must NOT be used when an angle is active
  existingClip: { id: 'c1', startTime: 120, endTime: 150 },
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'inline_desktop',
};

describe('ClipScrubRegion media bounds respect the active angle (T9480 review fix, MAJOR #5)', () => {
  it('clamps typed entry to the ANGLE span (mediaBounds), not the whole timeline (videoDuration)', () => {
    const onUpdateClip = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        activeSourceName="sideline"
        mediaBounds={{ mediaStart: 100, mediaEnd: 200 }}
        onUpdateClip={onUpdateClip}
      />,
    );

    fireEvent.click(screen.getByTestId('trim-field-end'));
    const input = screen.getByTestId('trim-field-input-end');
    // 250 is within the whole-timeline bound (6000) but PAST the angle's true
    // end (200) -- must clamp to 200, not commit 250.
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('trim-field-end').textContent).toBe('3:20.0');
    expect(screen.getByText(/past the end of the video/)).toBeTruthy();
  });

  it('falls back to the whole timeline when no angle is active (mediaBounds null -- byte-identical to before)', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        activeSourceName={null}
        mediaBounds={null}
      />,
    );

    fireEvent.click(screen.getByTestId('trim-field-end'));
    const input = screen.getByTestId('trim-field-input-end');
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 250 is well within videoDuration (6000) -- commits as typed, no clamp message.
    expect(screen.getByTestId('trim-field-end').textContent).toBe('4:10.0');
    expect(screen.queryByText(/past the end of the video/)).toBeNull();
  });
});
