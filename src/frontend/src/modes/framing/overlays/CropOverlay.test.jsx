import { useRef } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CropOverlay from './CropOverlay';

/**
 * T5380 — CropOverlay must not drop the FIRST drag gesture after mount.
 *
 * Root cause (fixed): the window mousemove/mouseup listeners used to be attached in
 * a useEffect gated on isDragging. The effect commits a tick AFTER the mousedown
 * state update, so a fast first down->move fired before the listeners existed and the
 * move was lost. The fix attaches the listeners synchronously inside the pointer-down
 * handler (transient state in refs, no gated effect), so the first move is captured.
 *
 * These tests exercise that directly by dispatching NATIVE events without an act()
 * flush between mousedown and mousemove — which is exactly the window in which the old
 * effect-gated attach had not yet run. On the old code the window 'mousemove' listener
 * would be absent at that moment (assert #1) and onCropChange would never fire on the
 * first move (assert #2). On the fixed code both hold.
 *
 * The video->screen transform is mocked to a unit-scale identity rect so the drag math
 * is deterministic (screen delta == video delta, scaleX/Y == 1).
 *
 * NOTE (skip context): the live regression proof is e2e/T4550-overlay-transform.qa.spec.js
 * with its warm-up prime removed — but that spec HONEST-SKIPS in the /dotask container
 * because this env has no framing-ready reel draft (openFramingDraft times out on the
 * "Reel Drafts" chip). This component test is the standing guard in that environment.
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
  it('attaches the window drag listeners synchronously on mousedown (not via a gated effect)', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    // render() flushes initial effects; no drag listeners exist yet.
    const { container } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);
    expect(cropBox).toBeTruthy();

    const addSpy = vi.spyOn(window, 'addEventListener');

    // Native mousedown, dispatched WITHOUT act() — so no passive effect runs between
    // this and the assert. The fix must attach the move/up listeners inside the
    // handler itself. (Old effect-gated code attaches nothing here.)
    cropBox.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200, clientY: 175 })
    );

    const events = addSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain('mousemove');
    expect(events).toContain('mouseup');

    // Clean up the drag so no window listeners leak into the next test.
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  it('moves the crop on the FIRST drag after mount, with no warm-up prime', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    const { container } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);

    // First gesture, no prior pointer activity: down at (200,175), then a +40,+30 move.
    cropBox.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200, clientY: 175 })
    );
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 240, clientY: 205 }));

    // The very first move must reach onCropChange (the dropped-gesture regression).
    expect(onCropChange).toHaveBeenCalled();
    const moved = onCropChange.mock.calls.at(-1)[0];
    // Unit-scale mock: +40,+30 screen delta -> +40,+30 in video space from (100,100).
    expect(moved.x).toBeCloseTo(140, 3);
    expect(moved.y).toBeCloseTo(130, 3);
    expect(moved.width).toBeCloseTo(200, 3);
    expect(moved.height).toBeCloseTo(150, 3);

    // Mouseup ends the drag and emits the completed crop exactly once.
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(onCropComplete).toHaveBeenCalledTimes(1);
  });

  it('detaches the window listeners on mouseup so a dropped move does nothing after release', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    const { container } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);

    cropBox.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200, clientY: 175 })
    );
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 220, clientY: 175 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    onCropChange.mockClear();
    // A stray move after release must be ignored (listeners removed).
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 175 }));
    expect(onCropChange).not.toHaveBeenCalled();
  });

  it('unmounting mid-drag removes the window listeners (no leak / no stale update)', () => {
    const onCropChange = vi.fn();
    const onCropComplete = vi.fn();
    const { container, unmount } = render(
      <Harness onCropChange={onCropChange} onCropComplete={onCropComplete} />
    );
    const cropBox = getCropBox(container);

    cropBox.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200, clientY: 175 })
    );
    act(() => { unmount(); });

    onCropChange.mockClear();
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 175 }));
    expect(onCropChange).not.toHaveBeenCalled();
  });
});
