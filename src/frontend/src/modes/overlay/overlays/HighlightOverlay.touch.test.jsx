import { useRef } from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HighlightOverlay from './HighlightOverlay';

/**
 * T5570c — Overlay spotlight circle: bounding-box editing model.
 *
 * The circle + its editing UI render ONLY when `editable` (= player boxes OFF). While
 * editable it shows a selection frame and FOUR corner resize handles (outside the
 * ellipse, so they never occlude it); the ellipse INTERIOR drags to move. There is no
 * center move grip and no rim handles (supersedes T5450). When NOT editable nothing
 * renders at all (circle hidden while the tracking layer is on).
 *
 * Driven with REAL Pointer Events. The video->screen transform is mocked to unit scale
 * (video coords == screen coords, scaleX/Y == 1) so drag math is deterministic. Coarse
 * pointer is driven through window.matchMedia (read by useIsCoarsePointer).
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

const body = () => screen.queryByTestId('highlight-body');
const grip = () => screen.queryByTestId('highlight-move-grip');
const corner = (id) => screen.queryByTestId(`highlight-corner-${id}`);

beforeEach(() => setCoarse(false));
afterEach(() => cleanup());

describe('HighlightOverlay — hidden when NOT editable (player boxes ON)', () => {
  it('renders nothing at all (fine pointer)', () => {
    renderOverlay(false);
    expect(body()).toBeNull();
    expect(corner('se')).toBeNull();
    expect(corner('nw')).toBeNull();
  });

  it('renders nothing at all (coarse pointer)', () => {
    setCoarse(true);
    renderOverlay(false);
    expect(body()).toBeNull();
    expect(corner('se')).toBeNull();
  });
});

describe('HighlightOverlay — editable (player boxes OFF): bounding-box model', () => {
  it('shows the body + four corner handles, and no grip / no rim handles', () => {
    renderOverlay(true);
    expect(body()).toBeTruthy();
    for (const id of ['nw', 'ne', 'sw', 'se']) expect(corner(id)).toBeTruthy();
    expect(grip()).toBeNull(); // center move grip removed
    expect(screen.queryByTestId('highlight-handle-horizontal')).toBeNull();
    expect(screen.queryByTestId('highlight-handle-vertical')).toBeNull();
  });

  it('drags the ellipse interior to MOVE the circle (mouse)', () => {
    const { onChange, onComplete } = renderOverlay(true);
    fireEvent.pointerDown(body(), { pointerId: 2, pointerType: 'mouse', clientX: 320, clientY: 180 });
    fireEvent.pointerMove(body(), { pointerId: 2, pointerType: 'mouse', clientX: 350, clientY: 210 });
    fireEvent.pointerUp(body(), { pointerId: 2, pointerType: 'mouse', clientX: 350, clientY: 210 });
    expect(onChange.mock.calls.at(-1)[0].x).toBe(350); // +30 x
    expect(onChange.mock.calls.at(-1)[0].y).toBe(210); // +30 y
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('the move surface is hit-testable (pointerEvents:all, not none)', () => {
    renderOverlay(true);
    expect(body().style.pointerEvents).toBe('all');
  });

  it('drags the SE corner to RESIZE both radii around the center', () => {
    const { onChange, onComplete } = renderOverlay(true);
    fireEvent.pointerDown(corner('se'), { pointerId: 3, pointerType: 'mouse', clientX: 372, clientY: 252 });
    fireEvent.pointerMove(corner('se'), { pointerId: 3, pointerType: 'mouse', clientX: 392, clientY: 272 });
    fireEvent.pointerUp(corner('se'), { pointerId: 3, pointerType: 'mouse', clientX: 392, clientY: 272 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.radiusX).toBe(60); // 40 + 20 (drag east grows x)
    expect(last.radiusY).toBe(80); // 60 + 20 (drag south grows y)
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('drags the NW corner outward to also GROW (sign follows the corner)', () => {
    const { onChange } = renderOverlay(true);
    fireEvent.pointerDown(corner('nw'), { pointerId: 4, pointerType: 'mouse', clientX: 268, clientY: 108 });
    fireEvent.pointerMove(corner('nw'), { pointerId: 4, pointerType: 'mouse', clientX: 248, clientY: 88 });
    fireEvent.pointerUp(corner('nw'), { pointerId: 4, pointerType: 'mouse', clientX: 248, clientY: 88 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.radiusX).toBe(60); // 40 + 20 (drag west grows x)
    expect(last.radiusY).toBe(80); // 60 + 20 (drag north grows y)
  });

  it('corner hit targets are >=44px on coarse pointers', () => {
    setCoarse(true);
    renderOverlay(true);
    for (const id of ['nw', 'ne', 'sw', 'se']) {
      expect(Number(corner(id).getAttribute('r'))).toBeGreaterThanOrEqual(22); // r22 => 44px
    }
  });
});
