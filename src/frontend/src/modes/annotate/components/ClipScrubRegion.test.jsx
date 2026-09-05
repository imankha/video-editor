import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
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

  it('does not render a Preview button in the fullscreen editor (T8760 single play control)', () => {
    // T8760 item 5: in the fullscreen edit overlay (clipEditorActive), the small
    // in-editor play/preview button stays gone — the main transport bar is the
    // single playback control there.
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} clipEditorActive existingClip={{ id: 1, startTime: 98, endTime: 104 }} />);
    expect(screen.queryByTitle('Preview clip')).toBeNull();
    expect(screen.queryByTitle('Stop preview')).toBeNull();
  });

  it('renders a Preview button in the sidebar, where there is no main transport (T8780)', () => {
    // T8780: the clips-sidebar ClipDetailsEditor instance (clipEditorActive
    // false, the baseProps default) has no main transport of its own, so it
    // keeps its own Preview control to play back just this clip's span.
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} />);
    expect(screen.getByTitle('Preview clip')).toBeTruthy();
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

/**
 * T8760 — clip-scoped looping playback + defaults, while EDITING a clip.
 *
 * The loop lives in the same playhead-follow RAF and is gated on `existingClip`
 * (edit mode). Because the loop code only exists while this component is
 * mounted (only while the clip editor is open), it cannot leak into normal game
 * playback.
 */
const editProps = (controller, clip) => ({
  ...baseProps(controller),
  existingClip: clip,
  startTime: clip.startTime,
  endTime: clip.endTime,
  // Primary editor (Add/Edit overlay) — the only surface where clip-scoped
  // playback is active. The clips-sidebar scrub region omits this.
  clipEditorActive: true,
});

describe('ClipScrubRegion clip-scoped loop (T8760)', () => {
  it('seeds the playhead to the clip start when opened for editing (item 7)', () => {
    const controller = makeController(200);
    const clip = { id: 'c1', startTime: 98, endTime: 104 };
    render(<ClipScrubRegion {...editProps(controller, clip)} />);
    // On open, the video is seeked to the clip start (not left at 200).
    expect(controller.seek).toHaveBeenCalledWith(98);
    expect(controller.state.time).toBe(98);
  });

  it('loops playback back to the clip start when it runs past the clip end (item 6)', () => {
    const controller = makeController(98);
    const clip = { id: 'c1', startTime: 98, endTime: 104 };
    render(<ClipScrubRegion {...editProps(controller, clip)} />);
    controller.seek.mockClear();

    // Playing, advance past the end -> the follow RAF seeks back to start.
    controller.state.paused = false;
    controller.state.time = 105;
    flushFrame();

    expect(controller.seek).toHaveBeenLastCalledWith(98);
    expect(controller.state.time).toBe(98);
  });

  it('does NOT loop while paused, even past the clip end', () => {
    const controller = makeController(98);
    const clip = { id: 'c1', startTime: 98, endTime: 104 };
    render(<ClipScrubRegion {...editProps(controller, clip)} />);
    controller.seek.mockClear();

    controller.state.paused = true;
    controller.state.time = 105;
    flushFrame();

    expect(controller.seek).not.toHaveBeenCalled();
  });

  it('does NOT loop in create mode (no existingClip) — the loop is edit-scoped', () => {
    // Regression proof that the clip-scoped loop cannot leak into normal game
    // playback: with no clip being edited, playing past the region never seeks.
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} />); // existingClip: null
    controller.state.paused = false;
    controller.state.time = 300; // far past endTime (104)
    flushFrame();
    expect(controller.seek).not.toHaveBeenCalled();
    expect(controller.state.time).toBe(300);
  });

  it('does NOT loop or seed in the clips SIDEBAR (existingClip set, clipEditorActive false)', () => {
    // The sidebar ClipDetailsEditor mounts ClipScrubRegion with a clip but WITHOUT
    // clipEditorActive — the merely-SELECTED state keeps whole-game playback and
    // no seed-to-start. This is the exact non-leak the reviewer flagged.
    const controller = makeController(200);
    const clip = { id: 'c1', startTime: 98, endTime: 104 };
    render(
      <ClipScrubRegion
        {...baseProps(controller)}
        existingClip={clip}
        startTime={clip.startTime}
        endTime={clip.endTime}
        // clipEditorActive intentionally omitted (defaults false)
      />,
    );
    // No seed-to-start on mount.
    expect(controller.seek).not.toHaveBeenCalled();
    expect(controller.state.time).toBe(200);
    // No loop while playing past the clip end.
    controller.state.paused = false;
    controller.state.time = 300;
    flushFrame();
    expect(controller.seek).not.toHaveBeenCalled();
    expect(controller.state.time).toBe(300);
  });
});
