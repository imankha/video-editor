import { useRef } from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CropOverlay from './CropOverlay';

/**
 * T5380 — CropOverlay must not drop the FIRST drag gesture after mount.
 *
 * Root cause (fixed): the window mousemove/mouseup listeners used to be attached in
 * a useEffect gated on isDragging. The effect commits a tick AFTER the mousedown
 * state update, so a fast first down->move fired before the listeners existed and the
 * move was lost. The original fix attached the listeners synchronously inside the
 * pointer-down handler (transient state in refs, no gated effect).
 *
 * T7390 — window mouse/touch listeners replaced by Pointer Events + setPointerCapture
 * (matches the straighten tool's established pattern, T5640/T5644/T5450): the old
 * `onTouchStart` binding is passive-by-default at React's root listener, so
 * `e.preventDefault()` inside it silently no-opped (real bug, not just a console
 * warning — the browser's own touch scroll/bounce was never actually blocked).
 * `onPointerDown` is not part of that passive-by-default set. Pointer capture routes
 * all subsequent pointermove/pointerup/pointercancel for that pointerId to the
 * capturing element itself (armed synchronously in the pointerdown handler, same
 * "no gated effect" guarantee T5380 required) — so these tests now dispatch Pointer
 * Events directly on the crop box element instead of Mouse Events on window.
 *
 * The video->screen transform is mocked to a unit-scale identity rect so the drag math
 * is deterministic (screen delta == video delta, scaleX/Y == 1).
 *
 * NOTE (skip context): the live regression proof is e2e/T4550-overlay-transform.qa.spec.js
 * with its warm-up prime removed — but that spec HONEST-SKIPS in the /dotask container
 * because this env has no framing-ready reel draft (openFramingDraft times out on the
 * "Clips" chip). This component test is the standing guard in that environment.
 * Per this project's real-browser-for-pointer-fixes rule, jsdom does not simulate true
 * pointer-capture event REROUTING — these tests dispatch events on the same element
 * pointerdown captured, which is sufficient to prove the synchronous-arming and
 * guard-state behavior but not a substitute for the live e2e proof above.
 */

vi.mock('../../../hooks/useVideoDisplayRect', () => {
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const rect = {
    offsetX: 0, offsetY: 0, width: 640, height: 360,
    scaleX: 1, scaleY: 1, zoom: 1, panOffset: { x: 0, y: 0 },
  };
  return {
    __esModule: true,
    round3,
    default: () => ({
      rect,
      videoToScreen: (x, y, w, h) => ({ x, y, width: w, height: h }),
      screenToVideo: (x, y, w, h) => ({ x, y, width: w, height: h }),
    }),
  };
});

const VIDEO_METADATA = { width: 640, height: 360 };
// Room to move without hitting the constrainCrop bounds clamp (x in [0, 440]).
const CROP = { x: 100, y: 100, width: 200, height: 150 };

function Harness({ onCropChange, onCropComplete }) {
  const videoRef = useRef(null);
  return (
    <div className="video-container" style={{ width: 640, height: 360 }}>
      <video ref={videoRef} />
      <CropOverlay
        videoRef={videoRef}
        videoMetadata={VIDEO_METADATA}
        currentCrop={CROP}
        aspectRatio="free"
        onCropChange={onCropChange}
        onCropComplete={onCropComplete}
      />
    </div>
  );
}

/** The draggable/movable crop rectangle (border-2 + cursor-move). */
function getCropBox(container) {
  return container.querySelector('div.cursor-move.border-2');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('T5380 CropOverlay first-drag gesture', () => {
  it('arms pointer capture synchronously on pointerdown (not via a gated effect)', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    // render() flushes initial effects; nothing is captured yet.
    const { container } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);
    expect(cropBox).toBeTruthy();

    // jsdom does not define setPointerCapture at all (unlike a real browser) — the
    // component guards the call with optional chaining for exactly this reason. Define
    // it here so the spy has something to attach to.
    HTMLElement.prototype.setPointerCapture = vi.fn();
    const captureSpy = vi.spyOn(HTMLElement.prototype, 'setPointerCapture');

    // Pointerdown dispatched WITHOUT an act() flush between this and the assert —
    // capture must be requested inside the handler itself, not a gated effect.
    fireEvent.pointerDown(cropBox, { pointerId: 1, clientX: 200, clientY: 175 });

    expect(captureSpy).toHaveBeenCalledWith(1);

    // Clean up the drag so state doesn't leak into the next test.
    fireEvent.pointerUp(cropBox, { pointerId: 1 });
  });

  it('moves the crop on the FIRST drag after mount, with no warm-up prime', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    const { container } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);

    // First gesture, no prior pointer activity: down at (200,175), then a +40,+30 move.
    // Pointer capture routes both to the SAME element in a real browser; dispatching on
    // cropBox directly here matches that routing.
    fireEvent.pointerDown(cropBox, { pointerId: 1, clientX: 200, clientY: 175 });
    fireEvent.pointerMove(cropBox, { pointerId: 1, clientX: 240, clientY: 205 });

    // The very first move must reach onCropChange (the dropped-gesture regression).
    expect(onCropChange).toHaveBeenCalled();
    const moved = onCropChange.mock.calls.at(-1)[0];
    // Unit-scale mock: +40,+30 screen delta -> +40,+30 in video space from (100,100).
    expect(moved.x).toBeCloseTo(140, 3);
    expect(moved.y).toBeCloseTo(130, 3);
    expect(moved.width).toBeCloseTo(200, 3);
    expect(moved.height).toBeCloseTo(150, 3);

    // Pointerup ends the drag and emits the completed crop exactly once.
    fireEvent.pointerUp(cropBox, { pointerId: 1 });
    expect(onCropComplete).toHaveBeenCalledTimes(1);
  });

  it('ignores a stray move after pointerup releases the drag', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    const { container } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);

    fireEvent.pointerDown(cropBox, { pointerId: 1, clientX: 200, clientY: 175 });
    fireEvent.pointerMove(cropBox, { pointerId: 1, clientX: 220, clientY: 175 });
    fireEvent.pointerUp(cropBox, { pointerId: 1 });

    onCropChange.mockClear();
    // A stray move after release must be ignored (draggingRef cleared on pointerup).
    fireEvent.pointerMove(cropBox, { pointerId: 1, clientX: 300, clientY: 175 });
    expect(onCropChange).not.toHaveBeenCalled();
  });

  it('unmounting mid-drag does not throw (pointer capture is released by the browser, no manual listener cleanup needed)', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    const { container, unmount } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);

    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
    fireEvent.pointerDown(cropBox, { pointerId: 1, clientX: 200, clientY: 175 });

    expect(() => act(() => { unmount(); })).not.toThrow();
  });
});
