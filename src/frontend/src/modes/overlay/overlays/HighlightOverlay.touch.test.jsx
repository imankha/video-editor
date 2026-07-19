import { useRef, useState } from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HighlightOverlay from './HighlightOverlay';

/**
 * T5390 — Overlay spotlight circle: touch select-then-manipulate.
 *
 * Maps each acceptance criterion to a named test, driving REAL Pointer Events:
 *  - Desktop (fine pointer) is byte-identical: no selection step, direct drag/resize.
 *  - Touch (coarse pointer): one tap SELECTS (ephemeral, no persist), then the body
 *    drags to move and the handles drag to resize; handles are >=44px; tap-elsewhere
 *    deselects. Selection is controlled by the parent so the tap-nav owner can yield.
 *
 * The video->screen transform is mocked to an identity/unit-scale rect so the drag
 * math is deterministic (video coords == screen coords, scaleX/Y == 1). Coarse-ness
 * is driven through window.matchMedia, which useIsCoarsePointer reads.
 */

vi.mock('../../../hooks/useVideoDisplayRect', () => {
  const round3 = (v) => Math.round(v * 1000) / 1000;
  return {
    __esModule: true,
    round3,
    default: () => ({
      rect: {
        offsetX: 0, offsetY: 0, width: 640, height: 360,
        scaleX: 1, scaleY: 1, zoom: 1, panOffset: { x: 0, y: 0 },
      },
      videoToScreen: (x, y, w, h) => ({ x, y, width: w, height: h }),
      screenToVideo: (x, y, w, h) => ({ x, y, width: w, height: h }),
    }),
  };
});

const VIDEO_METADATA = { width: 640, height: 360 };
const PAN_OFFSET = { x: 0, y: 0 };
// Center 320,180; radii 40x60. Room to move/resize without hitting bounds clamps.
const HIGHLIGHT = {
  x: 320, y: 180, radiusX: 40, radiusY: 60,
  strokeOpacity: 0.85, fillOpacity: 0.05, color: '#FFFFFF',
};

let coarse = false;

function setCoarse(value) {
  coarse = value;
  window.matchMedia = (query) => ({
    matches: query.includes('coarse') ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

/** Mirrors OverlayModeView: owns the ephemeral selection state, passes it controlled. */
function Harness({ onChange, onComplete, onSelectedSpy }) {
  const videoRef = useRef(null);
  const [selected, setSelected] = useState(false);
  return (
    <div className="video-container" style={{ width: 640, height: 360 }}>
      <video ref={videoRef} />
      <HighlightOverlay
        videoRef={videoRef}
        videoMetadata={VIDEO_METADATA}
        currentHighlight={HIGHLIGHT}
        onHighlightChange={onChange}
        onHighlightComplete={onComplete}
        isEnabled
        panOffset={PAN_OFFSET}
        isSelected={selected}
        onSelectedChange={(v) => { onSelectedSpy?.(v); setSelected(v); }}
      />
    </div>
  );
}

function renderOverlay() {
  const onChange = vi.fn();
  const onComplete = vi.fn();
  const onSelectedSpy = vi.fn();
  render(<Harness onChange={onChange} onComplete={onComplete} onSelectedSpy={onSelectedSpy} />);
  return { onChange, onComplete, onSelectedSpy };
}

const body = () => screen.getByTestId('highlight-body');
const hHandle = () => screen.queryByTestId('highlight-handle-horizontal');
const vHandle = () => screen.queryByTestId('highlight-handle-vertical');
const backdrop = () => screen.queryByTestId('highlight-backdrop');

beforeEach(() => setCoarse(false));
afterEach(() => cleanup());

describe('HighlightOverlay — desktop (fine pointer) byte-identical', () => {
  it('drags the body immediately with no selection step', () => {
    const { onChange, onComplete, onSelectedSpy } = renderOverlay();

    fireEvent.pointerDown(body(), { pointerId: 1, pointerType: 'mouse', clientX: 320, clientY: 180 });
    fireEvent.pointerMove(body(), { pointerId: 1, pointerType: 'mouse', clientX: 340, clientY: 180 });
    fireEvent.pointerUp(body(), { pointerId: 1, pointerType: 'mouse', clientX: 340, clientY: 180 });

    // Moved +20 in x (unit scale), committed once, and NO selection step occurred.
    expect(onChange.mock.calls.at(-1)[0].x).toBe(340);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].x).toBe(340);
    expect(onSelectedSpy).not.toHaveBeenCalled();
  });

  it('shows resize handles without any selection (7px, as before)', () => {
    renderOverlay();
    expect(hHandle()).toBeTruthy();
    expect(vHandle()).toBeTruthy();
    expect(hHandle().getAttribute('r')).toBe('7');
    // No touch backdrop on desktop.
    expect(backdrop()).toBeNull();
  });

  it('resizes via the horizontal handle immediately', () => {
    const { onChange, onComplete } = renderOverlay();
    fireEvent.pointerDown(hHandle(), { pointerId: 2, pointerType: 'mouse', clientX: 360, clientY: 180 });
    fireEvent.pointerMove(hHandle(), { pointerId: 2, pointerType: 'mouse', clientX: 380, clientY: 180 });
    fireEvent.pointerUp(hHandle(), { pointerId: 2, pointerType: 'mouse', clientX: 380, clientY: 180 });
    // radiusX grew by +20.
    expect(onChange.mock.calls.at(-1)[0].radiusX).toBe(60);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('HighlightOverlay — touch (coarse pointer) select-then-manipulate', () => {
  beforeEach(() => setCoarse(true));

  it('hides the resize handles until the circle is selected', () => {
    renderOverlay();
    expect(hHandle()).toBeNull();
    expect(vHandle()).toBeNull();
  });

  it('one tap selects (handles appear) and persists NOTHING', () => {
    const { onChange, onComplete, onSelectedSpy } = renderOverlay();

    fireEvent.pointerDown(body(), { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 180 });
    fireEvent.pointerUp(body(), { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 180 });

    expect(onSelectedSpy).toHaveBeenCalledWith(true);
    // Ephemeral selection: no geometry change, no commit.
    expect(onChange).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    // Handles now visible.
    expect(hHandle()).toBeTruthy();
    expect(vHandle()).toBeTruthy();
  });

  it('exposes >=44px handle hit targets once selected', () => {
    renderOverlay();
    fireEvent.pointerDown(body(), { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 180 });
    // radius 22 => 44px diameter touch target.
    expect(Number(hHandle().getAttribute('r'))).toBeGreaterThanOrEqual(22);
    expect(Number(vHandle().getAttribute('r'))).toBeGreaterThanOrEqual(22);
  });

  it('drags the body to MOVE once selected', () => {
    const { onChange, onComplete } = renderOverlay();
    // First tap selects (no move).
    fireEvent.pointerDown(body(), { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 180 });
    expect(onChange).not.toHaveBeenCalled();
    // Second gesture drags.
    fireEvent.pointerDown(body(), { pointerId: 2, pointerType: 'touch', clientX: 320, clientY: 180 });
    fireEvent.pointerMove(body(), { pointerId: 2, pointerType: 'touch', clientX: 320, clientY: 210 });
    fireEvent.pointerUp(body(), { pointerId: 2, pointerType: 'touch', clientX: 320, clientY: 210 });
    expect(onChange.mock.calls.at(-1)[0].y).toBe(210); // moved +30 in y
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('drags a handle to RESIZE once selected', () => {
    const { onChange, onComplete } = renderOverlay();
    fireEvent.pointerDown(body(), { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 180 });
    fireEvent.pointerDown(vHandle(), { pointerId: 2, pointerType: 'touch', clientX: 320, clientY: 240 });
    fireEvent.pointerMove(vHandle(), { pointerId: 2, pointerType: 'touch', clientX: 320, clientY: 270 });
    fireEvent.pointerUp(vHandle(), { pointerId: 2, pointerType: 'touch', clientX: 320, clientY: 270 });
    expect(onChange.mock.calls.at(-1)[0].radiusY).toBe(90); // grew +30
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('tap elsewhere (backdrop) deselects and hides the handles', () => {
    const { onSelectedSpy } = renderOverlay();
    fireEvent.pointerDown(body(), { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 180 });
    expect(backdrop()).toBeTruthy();
    fireEvent.pointerDown(backdrop(), { pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 50 });
    expect(onSelectedSpy).toHaveBeenLastCalledWith(false);
    expect(hHandle()).toBeNull();
    expect(backdrop()).toBeNull();
  });
});
