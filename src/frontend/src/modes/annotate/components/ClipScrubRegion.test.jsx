import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
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
 * T8960 item 8 — click INSIDE the green span seeks the playhead there.
 *
 * jsdom has no layout, so the track's getBoundingClientRect is stubbed to give
 * pixelToTime a real mapping. This proves the click-vs-drag + inside-vs-outside
 * gating logic; the real-browser pointer behavior is verified separately via
 * dev-verify (T5380/T8900 jsdom-pointer landmine).
 */
describe('ClipScrubRegion click-to-seek (T8960 item 8)', () => {
  // Window is anchor(100) ± 30 = 70..130 over a 300px-wide track, so
  // clientX = (t - 70) / 60 * 300. Span is [98, 104].
  const RECT = { left: 0, top: 0, width: 300, height: 40, right: 300, bottom: 40 };
  const xForTime = (t) => ((t - 70) / 60) * 300;

  function renderTrack(extra = {}) {
    const onSeek = vi.fn();
    const controller = makeController(100);
    render(
      <ClipScrubRegion
        {...baseProps(controller)}
        clipEditorActive
        startTime={98}
        endTime={104}
        onSeek={onSeek}
        {...extra}
      />,
    );
    const track = screen.getByTestId('scrub-track');
    track.getBoundingClientRect = () => RECT;
    track.setPointerCapture = () => {};
    return { onSeek, track };
  }

  it('a click BETWEEN the handles seeks the playhead to that time', () => {
    const { onSeek, track } = renderTrack();
    const x = xForTime(101); // mid-span
    fireEvent.pointerDown(track, { clientX: x, clientY: 20 });
    fireEvent.pointerUp(track, { clientX: x, clientY: 20 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(101, 1);
  });

  it('a click OUTSIDE the span does nothing (today\'s behavior preserved)', () => {
    const { onSeek, track } = renderTrack();
    const x = xForTime(120); // right of the span (end 104)
    fireEvent.pointerDown(track, { clientX: x, clientY: 20 });
    fireEvent.pointerUp(track, { clientX: x, clientY: 20 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('a drag (moved past the threshold) inside the span does NOT seek', () => {
    const { onSeek, track } = renderTrack();
    const x = xForTime(101);
    fireEvent.pointerDown(track, { clientX: x, clientY: 20 });
    fireEvent.pointerUp(track, { clientX: x + 40, clientY: 20 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('does NOT seek on click when clipEditorActive is false (sidebar unchanged)', () => {
    const { onSeek, track } = renderTrack({ clipEditorActive: false });
    const x = xForTime(101);
    fireEvent.pointerDown(track, { clientX: x, clientY: 20 });
    fireEvent.pointerUp(track, { clientX: x, clientY: 20 });
    expect(onSeek).not.toHaveBeenCalled();
  });
});

/**
 * T9490 — coalesced drag-seek. The regression this guards: handlePointerMove
 * used to call onSeek on EVERY pointermove, so a trim drag issued one
 * `video.currentTime =` per move. The browser collapses those into a single
 * completed seek, so the preview frame stays frozen for the whole drag and only
 * catches up at release (measured 1.2-2.4s of preview lag on a long/streaming
 * file, real-Chromium harness). The fix keeps the HANDLE immediate (onStart/
 * EndTimeChange still fires every move) but coalesces the SEEK to at most one in
 * flight (a RAF pump issues the newest target only when el.seeking is false),
 * and settles exactly on release.
 *
 * jsdom has no real seek timing (T5380 landmine), so this asserts the COALESCING
 * LOGIC deterministically -- how many times onSeek is called and with what -- by
 * driving the controllable RAF and a settable `el.seeking` flag. The felt
 * latency itself is measured separately in the real-browser harness.
 */
describe('ClipScrubRegion coalesced drag-seek (T9490)', () => {
  const RECT = { left: 0, top: 0, width: 300, height: 40, right: 300, bottom: 40 };
  // create-mode window is anchor(100) +/- 30 = 70..130 over 300px.
  const xForTime = (t) => ((t - 70) / 60) * 300;

  // A controller whose media element exposes a settable `seeking` flag (the
  // native "a seek is still in flight" signal the pump gates on).
  function makeSeekingController() {
    const el = { addEventListener: () => {}, removeEventListener: () => {}, paused: true, seeking: false };
    const state = { time: 100, paused: true };
    return {
      el, state,
      play: vi.fn(), pause: vi.fn(() => { state.paused = true; }),
      seek: vi.fn((t) => { state.time = t; }),
      getCurrentTime: () => state.time,
      isPaused: () => state.paused,
      getActiveElement: () => el,
      setVolume: () => {}, setMuted: () => {},
    };
  }

  // Controlled parent: mirrors the real MVC owner so startTime/endTime props
  // (and thus the internal startTimeRef the release settle reads) actually move
  // as the handle is dragged.
  function Harness({ controller, onSeek, onStartTimeChange }) {
    const [s, setS] = useState(98);
    const [en] = useState(104);
    return (
      <ClipScrubRegion
        {...baseProps(controller)}
        clipEditorActive
        startTime={s}
        endTime={en}
        onStartTimeChange={(t) => { onStartTimeChange(t); setS(t); }}
        onSeek={onSeek}
      />
    );
  }

  it('renders the handle every move but coalesces seeks to one in flight, settling on release', () => {
    const controller = makeSeekingController();
    const onSeek = vi.fn();
    const onStartTimeChange = vi.fn();
    render(<Harness controller={controller} onSeek={onSeek} onStartTimeChange={onStartTimeChange} />);

    const handle = document.querySelectorAll('.cursor-col-resize')[0]; // start handle
    handle.setPointerCapture = () => {};
    const track = screen.getByTestId('scrub-track');
    track.getBoundingClientRect = () => RECT;

    // Grab the start handle at t=98 -> immediate grab seek, pump starts.
    fireEvent.pointerDown(handle, { clientX: xForTime(98), clientY: 20, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(98, 1);

    // A seek is now in flight.
    controller.el.seeking = true;

    // Two moves while the seek is in flight: the handle follows both, but NO new
    // seek is issued (coalesced).
    fireEvent.pointerMove(window, { clientX: xForTime(100), clientY: 20 });
    flushFrame();
    fireEvent.pointerMove(window, { clientX: xForTime(102), clientY: 20 });
    flushFrame();
    expect(onStartTimeChange).toHaveBeenCalledTimes(2);      // handle immediate every move
    expect(onStartTimeChange.mock.calls.map((c) => Math.round(c[0]))).toEqual([100, 102]);
    expect(onSeek).toHaveBeenCalledTimes(1);                 // still only the grab seek

    // The in-flight seek completes: the pump issues ONLY the newest target
    // (102), never the superseded 100.
    controller.el.seeking = false;
    flushFrame();
    expect(onSeek).toHaveBeenCalledTimes(2);
    expect(onSeek.mock.calls[1][0]).toBeCloseTo(102, 1);
    expect(onSeek.mock.calls.some((c) => Math.round(c[0]) === 100)).toBe(false);

    // Release settles exactly on the final handle position and stops the pump.
    fireEvent.pointerUp(window, { clientX: xForTime(102), clientY: 20 });
    expect(onSeek).toHaveBeenCalledTimes(3);
    expect(onSeek.mock.calls[2][0]).toBeCloseTo(102, 1);

    // Pump is stopped: further frames issue no more seeks.
    flushFrame();
    expect(onSeek).toHaveBeenCalledTimes(3);
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

  it('does NOT loop when clipEditorActive is false (normal game playback) — the non-leak guard', () => {
    // Regression proof that the clip-scoped loop cannot leak into normal game
    // playback: with the primary editor NOT active, playing past the region
    // never seeks. (T8960 kept clipEditorActive as the structural leak guard.)
    const controller = makeController(100);
    render(<ClipScrubRegion {...baseProps(controller)} />); // clipEditorActive false
    controller.state.paused = false;
    controller.state.time = 300; // far past endTime (104)
    flushFrame();
    expect(controller.seek).not.toHaveBeenCalled();
    expect(controller.state.time).toBe(300);
  });

  // T8960 item 1: the loop + seed now fire in CREATE mode too (clipEditorActive
  // with NO existingClip) — reversing the T8760 create-mode exclusion for the
  // primary editor. The clipEditorActive leak guard is unchanged.
  it('seeds the playhead to the start handle when opened in CREATE mode (T8960)', () => {
    const controller = makeController(200);
    render(<ClipScrubRegion {...baseProps(controller)} clipEditorActive startTime={98} endTime={104} />);
    // On open, create mode seeds to the current start handle (98), not left at 200.
    expect(controller.seek).toHaveBeenCalledWith(98);
    expect(controller.state.time).toBe(98);
  });

  it('loops back to the start in CREATE mode when playback runs past the end (T8960)', () => {
    const controller = makeController(98);
    render(<ClipScrubRegion {...baseProps(controller)} clipEditorActive startTime={98} endTime={104} />);
    controller.seek.mockClear();

    controller.state.paused = false;
    controller.state.time = 105; // past endTime 104
    flushFrame();

    expect(controller.seek).toHaveBeenLastCalledWith(98);
    expect(controller.state.time).toBe(98);
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
