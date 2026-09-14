import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { ANNOTATE } from '../../../config/displayNames';
import {
  DEFAULT_CLIP_BEFORE,
  DEFAULT_CLIP_AFTER,
  DEFAULT_CLIP_DURATION,
} from '../../../components/shared/clipConstants';

// T9840: the "Mark play" tap-to-range default is 6s before + 2s after the tap
// (8s total, was 9+3=12). The window straddles the tap on purpose — parents tap
// AFTER they see a good play, so the post-roll holds the end of it. Both clamps
// stay: max(0, ...) at the start and min(..., duration) at the end, and a
// zero-length save is never produced at the extremes.

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

beforeEach(() => {
  mockViewport(false); // desktop
});

const baseProps = {
  isVisible: true,
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'dock_fullscreen',
};

const saveButton = (container) => container.querySelector('button.bg-green-600');

// Save a fresh (create-mode) mark at `currentTime` in a video of `videoDuration`
// and return the {startTime, duration} the overlay produced for the new clip.
async function createdWindow({ currentTime, videoDuration }) {
  const onCreateClip = vi.fn();
  const { container } = render(
    <AnnotateFullscreenOverlay
      {...baseProps}
      currentTime={currentTime}
      videoDuration={videoDuration}
      onCreateClip={onCreateClip}
    />
  );
  await act(async () => {
    fireEvent.click(saveButton(container));
  });
  expect(onCreateClip).toHaveBeenCalledTimes(1);
  return onCreateClip.mock.calls[0][0];
}

describe('AnnotateFullscreenOverlay — default capture window (T9840, 6s before + 2s after)', () => {
  it('the shared constants express one 6+2=8 policy (duration is derived, not a separate literal)', () => {
    expect(DEFAULT_CLIP_BEFORE).toBe(6);
    expect(DEFAULT_CLIP_AFTER).toBe(2);
    expect(DEFAULT_CLIP_DURATION).toBe(DEFAULT_CLIP_BEFORE + DEFAULT_CLIP_AFTER);
    expect(DEFAULT_CLIP_DURATION).toBe(8);
  });

  it('mid-game (t=20, no clamping) captures exactly [t-6, t+2]', async () => {
    const clip = await createdWindow({ currentTime: 20, videoDuration: 6000 });
    expect(clip.startTime).toBe(14);           // 20 - 6
    expect(clip.duration).toBe(8);             // (20 + 2) - 14
  });

  it('near-start (t=3) clamps the start to 0 while still applying the 2s post-roll (0:00-0:05)', async () => {
    const clip = await createdWindow({ currentTime: 3, videoDuration: 6000 });
    expect(clip.startTime).toBe(0);            // max(0, 3 - 6)
    expect(clip.duration).toBe(5);             // (3 + 2) - 0, NOT 6
  });

  it('at the before-clamp boundary (t=6) the start lands exactly on 0', async () => {
    const clip = await createdWindow({ currentTime: 6, videoDuration: 6000 });
    expect(clip.startTime).toBe(0);            // max(0, 6 - 6)
    expect(clip.duration).toBe(8);             // (6 + 2) - 0
  });

  it('near the end clamps the end to the video duration (positive, non-zero-length)', async () => {
    const clip = await createdWindow({ currentTime: 99, videoDuration: 100 });
    expect(clip.startTime).toBe(93);           // 99 - 6
    expect(clip.duration).toBe(7);             // min(101, 100) - 93
    expect(clip.duration).toBeGreaterThan(0);
  });

  it('the MARK_PLAY_HELPER copy matches the constants (says "6" and "2", not "12")', () => {
    expect(ANNOTATE.MARK_PLAY_HELPER).toBe('Captures 6 seconds before and 2 after');
    expect(ANNOTATE.MARK_PLAY_HELPER).toContain(String(DEFAULT_CLIP_BEFORE));
    expect(ANNOTATE.MARK_PLAY_HELPER).toContain(String(DEFAULT_CLIP_AFTER));
    expect(ANNOTATE.MARK_PLAY_HELPER).not.toContain('12');
    expect(ANNOTATE.MARK_PLAY_HELPER).not.toMatch(/previous/i);
  });
});
