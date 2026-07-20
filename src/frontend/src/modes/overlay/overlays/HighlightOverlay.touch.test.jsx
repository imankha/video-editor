import { useRef } from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HighlightOverlay from './HighlightOverlay';

/**
 * T5450 — Overlay spotlight circle: levers gated on the player-tracking layer.
 *
 * The edit levers (rim resize handles + a center move grip) render when `editable`
 * (= player boxes OFF), consistently on mobile + desktop; there is no tap-to-select
 * and no deselect backdrop (supersedes T5390). When NOT editable the circle is
 * display-only and intercepts no pointer events.
 *
 * Driven with REAL Pointer Events. The video->screen transform is mocked to an
 * identity/unit-scale rect so the drag math is deterministic (video coords == screen
 * coords, scaleX/Y == 1). Coarse-ness is driven through window.matchMedia, which
 * useIsCoarsePointer reads, so the >=44px touch targets can be asserted.
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

/** Mirrors OverlayModeView: passes `editable` (= !showPlayerBoxes) to the overlay. */
function Harness({ onChange, onComplete, editable }) {
  const videoRef = useRef(null);
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
        editable={editable}
      />
    </div>
  );
}

function renderOverlay(editable) {
  const onChange = vi.fn();
  const onComplete = vi.fn();
  render(<Harness onChange={onChange} onComplete={onComplete} editable={editable} />);
  return { onChange, onComplete };
}

const body = () => screen.getByTestId('highlight-body');
const grip = () => screen.queryByTestId('highlight-move-grip');
const hHandle = () => screen.queryByTestId('highlight-handle-horizontal');
const vHandle = () => screen.queryByTestId('highlight-handle-vertical');

beforeEach(() => setCoarse(false));
afterEach(() => cleanup());

describe('HighlightOverlay — display-only when NOT editable (player boxes ON)', () => {
  it('renders no resize handles and no move grip (fine pointer)', () => {
    renderOverlay(false);
    expect(hHandle()).toBeNull();
    expect(vHandle()).toBeNull();
    expect(grip()).toBeNull();
  });

  it('renders no resize handles and no move grip (coarse pointer)', () => {
    setCoarse(true);
    renderOverlay(false);
    expect(hHandle()).toBeNull();
    expect(vHandle()).toBeNull();
    expect(grip()).toBeNull();
  });

  it('the body intercepts no pointer events (tap-nav can pass through)', () => {
    const { onChange, onComplete } = renderOverlay(false);
    expect(body().getAttribute('class')).toContain('pointer-events-none');
    // A drag on the display-only body must not move or commit anything.
    fireEvent.pointerDown(body(), { pointerId: 1, pointerType: 'mouse', clientX: 320, clientY: 180 });
    fireEvent.pointerMove(body(), { pointerId: 1, pointerType: 'mouse', clientX: 360, clientY: 180 });
    fireEvent.pointerUp(body(), { pointerId: 1, pointerType: 'mouse', clientX: 360, clientY: 180 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('HighlightOverlay — editable (player boxes OFF), desktop + touch', () => {
  it('shows resize handles AND the center move grip with no tap-to-select', () => {
    renderOverlay(true);
    expect(hHandle()).toBeTruthy();
    expect(vHandle()).toBeTruthy();
    expect(grip()).toBeTruthy();
  });

  it('drags the center move grip to MOVE the circle (mouse)', () => {
    const { onChange, onComplete } = renderOverlay(true);
    fireEvent.pointerDown(grip(), { pointerId: 1, pointerType: 'mouse', clientX: 320, clientY: 180 });
    fireEvent.pointerMove(grip(), { pointerId: 1, pointerType: 'mouse', clientX: 350, clientY: 210 });
    fireEvent.pointerUp(grip(), { pointerId: 1, pointerType: 'mouse', clientX: 350, clientY: 210 });
    expect(onChange.mock.calls.at(-1)[0].x).toBe(350); // moved +30 in x
    expect(onChange.mock.calls.at(-1)[0].y).toBe(210); // moved +30 in y
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].x).toBe(350);
  });

  it('drags the center move grip to MOVE the circle (touch)', () => {
    setCoarse(true);
    const { onChange, onComplete } = renderOverlay(true);
    fireEvent.pointerDown(grip(), { pointerId: 5, pointerType: 'touch', clientX: 320, clientY: 180 });
    fireEvent.pointerMove(grip(), { pointerId: 5, pointerType: 'touch', clientX: 320, clientY: 240 });
    fireEvent.pointerUp(grip(), { pointerId: 5, pointerType: 'touch', clientX: 320, clientY: 240 });
    expect(onChange.mock.calls.at(-1)[0].y).toBe(240); // moved +60 in y
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('drags the body to MOVE the circle immediately (no selection step)', () => {
    const { onChange, onComplete } = renderOverlay(true);
    fireEvent.pointerDown(body(), { pointerId: 2, pointerType: 'mouse', clientX: 320, clientY: 180 });
    fireEvent.pointerMove(body(), { pointerId: 2, pointerType: 'mouse', clientX: 340, clientY: 180 });
    fireEvent.pointerUp(body(), { pointerId: 2, pointerType: 'mouse', clientX: 340, clientY: 180 });
    expect(onChange.mock.calls.at(-1)[0].x).toBe(340);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('drags a rim handle to RESIZE', () => {
    const { onChange, onComplete } = renderOverlay(true);
    fireEvent.pointerDown(hHandle(), { pointerId: 3, pointerType: 'mouse', clientX: 360, clientY: 180 });
    fireEvent.pointerMove(hHandle(), { pointerId: 3, pointerType: 'mouse', clientX: 380, clientY: 180 });
    fireEvent.pointerUp(hHandle(), { pointerId: 3, pointerType: 'mouse', clientX: 380, clientY: 180 });
    expect(onChange.mock.calls.at(-1)[0].radiusX).toBe(60); // grew +20
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('desktop handle markers stay at the original 7px', () => {
    renderOverlay(true);
    expect(hHandle().getAttribute('r')).toBe('7');
  });

  it('exposes >=44px handle hit targets AND a >=44px move grip on coarse pointers', () => {
    setCoarse(true);
    renderOverlay(true);
    // radius 22 => 44px diameter hit target.
    expect(Number(hHandle().getAttribute('r'))).toBeGreaterThanOrEqual(22);
    expect(Number(vHandle().getAttribute('r'))).toBeGreaterThanOrEqual(22);
    expect(parseInt(grip().style.width, 10)).toBeGreaterThanOrEqual(44);
    expect(parseInt(grip().style.height, 10)).toBeGreaterThanOrEqual(44);
  });
});
