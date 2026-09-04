import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { ClipScrubRegion } from './ClipScrubRegion';

/**
 * T8720 — Annotate add/edit-play playhead visibility + consistency.
 *
 * Regression cover for two reported symptoms:
 *   1. The playhead marker disappeared when playback was stopped.
 *   2. Stopping/starting via the transport play/pause button + spacebar behaved
 *      differently from the in-editor Preview button, because the marker was a
 *      preview-ONLY artifact that the main play path never drove.
 *
 * The fix makes the marker a single source of truth: it mirrors the video's
 * real current time (via `videoController.getCurrentTime()`), so it is always
 * visible and tracks playback identically no matter which path started it.
 */

// Controllable requestAnimationFrame so the follow-loop can be flushed frame by
// frame from the test.
let rafCallbacks;
let nextRafId;

function flushFrame() {
  const pending = rafCallbacks;
  rafCallbacks = new Map();
  act(() => {
    pending.forEach((cb) => cb());
  });
}

beforeEach(() => {
  rafCallbacks = new Map();
  nextRafId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    const id = nextRafId++;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A fake video controller whose current time / paused state the test drives.
 * `getActiveElement` returns a stub element so no code path throws.
 */
function makeController(initial = 100) {
  const state = { time: initial, paused: true };
  const el = { addEventListener: () => {}, removeEventListener: () => {}, paused: true };
  return {
    state,
    play: vi.fn(() => { state.paused = false; el.paused = false; }),
    pause: vi.fn(() => { state.paused = true; el.paused = true; }),
    seek: vi.fn((t) => { state.time = t; }),
    getCurrentTime: () => state.time,
    isPaused: () => state.paused,
    getActiveElement: () => el,
    setVolume: () => {},
    setMuted: () => {},
  };
}

const baseProps = (controller) => ({
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
});

function playheadLeftPercent() {
  const el = screen.queryByTestId('scrub-playhead');
  if (!el) return null;
  return parseFloat(el.style.left);
}

describe('ClipScrubRegion playhead (T8720)', () => {
  it('shows the playhead immediately while stopped (symptom 1)', () => {
    // Anchor 100, window is 70..130 -> currentTime 100 sits mid-window.
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} />);

    const marker = screen.getByTestId('scrub-playhead');
    expect(marker).toBeTruthy();
    // 100 is halfway through the 70..130 window -> ~50%.
    expect(playheadLeftPercent()).toBeCloseTo(50, 1);
  });

  it('tracks the video while playing started by the MAIN path (button/spacebar)', () => {
    // The transport button and spacebar drive the shared video element, NOT the
    // in-editor Preview button. Simulate that: mark the controller playing and
    // advance its time. The marker must follow.
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} />);

    controller.state.paused = false;
    controller.state.time = 112; // window 70..130 -> 112 is ~70%
    flushFrame();

    expect(parseFloat(screen.getByTestId('scrub-playhead').dataset.playheadTime)).toBeCloseTo(112, 3);
    expect(playheadLeftPercent()).toBeCloseTo(70, 1);
  });

  it('produces IDENTICAL playhead state for the Preview button and the main path (symptom 2)', () => {
    // Preview path: click the Preview button (seeks to startTime, plays, loops).
    const previewCtrl = makeController(100);
    const { unmount } = render(<ClipScrubRegion {...baseProps(previewCtrl)} />);
    const previewBtn = screen.getByTitle('Preview clip');
    fireEvent.click(previewBtn);
    // Preview seeks to startTime (98) and plays; advance to 102 (inside the clip
    // so the loop doesn't seek it back) as it runs.
    previewCtrl.state.time = 102;
    flushFrame();
    const previewLeft = playheadLeftPercent();
    const previewTime = parseFloat(screen.getByTestId('scrub-playhead').dataset.playheadTime);
    unmount();

    // Main path: no Preview click; the element just plays and advances to 102.
    const mainCtrl = makeController(100);
    render(<ClipScrubRegion {...baseProps(mainCtrl)} />);
    mainCtrl.state.paused = false;
    mainCtrl.state.time = 102;
    flushFrame();
    const mainLeft = playheadLeftPercent();
    const mainTime = parseFloat(screen.getByTestId('scrub-playhead').dataset.playheadTime);

    // Both paths land the playhead at the same time AND the same position.
    expect(previewTime).toBeCloseTo(mainTime, 3);
    expect(previewLeft).toBeCloseTo(mainLeft, 1);
  });

  it('keeps the playhead visible after playback stops (symptom 1)', () => {
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} />);

    // Play and advance.
    controller.state.paused = false;
    controller.state.time = 120;
    flushFrame();
    expect(playheadLeftPercent()).toBeCloseTo(((120 - 70) / 60) * 100, 1);

    // Stop (pause) — the marker must remain, pinned to the paused position.
    controller.state.paused = true;
    flushFrame();
    const marker = screen.queryByTestId('scrub-playhead');
    expect(marker).toBeTruthy();
    expect(parseFloat(marker.dataset.playheadTime)).toBeCloseTo(120, 3);
  });

  it('hides the marker only when the real playhead is outside the visible window', () => {
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} />);

    // Play far past the 70..130 window.
    controller.state.paused = false;
    controller.state.time = 400;
    flushFrame();
    expect(screen.queryByTestId('scrub-playhead')).toBeNull();

    // Come back into the window -> reappears.
    controller.state.time = 100;
    flushFrame();
    expect(screen.queryByTestId('scrub-playhead')).toBeTruthy();
  });
});
