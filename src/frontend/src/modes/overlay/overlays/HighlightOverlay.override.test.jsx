import { useRef, useState } from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line no-unused-vars -- rendered as JSX below; repo eslint lacks react/jsx-uses-vars (fixed by T5580)
import HighlightOverlay from './HighlightOverlay';

/**
 * T5610 — "tap the spotlight to edit" hit-priority + enter/exit state machine.
 *
 * The tracking-ON regime (OverlayModeView passes `onCircleTap`) makes a TAP inside the
 * circle toggle the ephemeral `circleEditActive` state, while a DRAG past the tap slop
 * still moves/resizes. The tracking-OFF regime (no `onCircleTap`) is byte-identical to
 * T5570 (drag-only, no tap-toggle, no enter target).
 *
 * Driven with REAL Pointer Events; the video->screen transform is mocked to unit scale so
 * drag math is deterministic (same mock as HighlightOverlay.touch.test.jsx). jsdom is
 * enough to pin the tap-vs-drag LOGIC and the render gating; the real-browser harness
 * (e2e/T5610-*) proves it survives real touch hit-testing.
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
const HIGHLIGHT = {
  x: 320, y: 180, radiusX: 40, radiusY: 60,
  strokeOpacity: 0.85, fillOpacity: 0.05, color: '#FFFFFF',
};

/**
 * Mirrors OverlayModeView's T5610 glue: `editable = !showPlayerBoxes || circleEditActive`
 * and `onCircleTap` wired only while tracking is on. The REAL HighlightOverlay is under
 * test — only the parent's trivial state wiring is replicated.
 */
// eslint-disable-next-line no-unused-vars -- rendered as JSX below; repo eslint lacks react/jsx-uses-vars (fixed by T5580)
function Harness({ showPlayerBoxes = true, onChange = () => {}, onComplete = () => {} }) {
  const videoRef = useRef(null);
  const [circleEditActive, setCircleEditActive] = useState(false);
  const editable = !showPlayerBoxes || circleEditActive;
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
        editable={editable}
        onCircleTap={showPlayerBoxes ? () => setCircleEditActive((v) => !v) : undefined}
      />
    </div>
  );
}

const body = () => screen.queryByTestId('highlight-body');
const enterHit = () => screen.queryByTestId('highlight-enter-hit');
const corner = (id) => screen.queryByTestId(`highlight-corner-${id}`);
const cornersShown = () => ['nw', 'ne', 'sw', 'se'].every((id) => corner(id));

/** Fire a stationary tap on an element (down + up, no move) -> counts as a TAP. */
function tap(el, pointerId = 1) {
  fireEvent.pointerDown(el, { pointerId, pointerType: 'touch', clientX: 320, clientY: 180 });
  fireEvent.pointerUp(el, { pointerId, pointerType: 'touch', clientX: 320, clientY: 180 });
}

/** Fire a drag (down, move past slop, up) -> counts as a DRAG, not a tap. */
function drag(el, pointerId, from, to) {
  fireEvent.pointerDown(el, { pointerId, pointerType: 'mouse', clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(el, { pointerId, pointerType: 'mouse', clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(el, { pointerId, pointerType: 'mouse', clientX: to.x, clientY: to.y });
}

beforeEach(() => {
  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
});
afterEach(() => cleanup());

describe('T5610 tracking-ON regime: tap the spotlight to edit', () => {
  it('display-only until tapped: enter target present, no edit controls', () => {
    render(<Harness showPlayerBoxes />);
    expect(body()).toBeTruthy();          // circle visible with tracking on
    expect(enterHit()).toBeTruthy();      // tap target present
    expect(cornersShown()).toBe(false);   // controls hidden until entered
  });

  it('tap inside the circle ENTERS edit (corner handles appear)', () => {
    render(<Harness showPlayerBoxes />);
    tap(enterHit());
    expect(cornersShown()).toBe(true);
    expect(enterHit()).toBeNull();        // enter target gone once editing
  });

  it('tap inside again EXITS edit (controls dismissed)', () => {
    render(<Harness showPlayerBoxes />);
    tap(enterHit());
    expect(cornersShown()).toBe(true);
    tap(body(), 2);                       // tap the body while editing -> exit
    expect(cornersShown()).toBe(false);
    expect(enterHit()).toBeTruthy();      // back to display-only
  });

  it('a DRAG in display-only does NOT enter edit and moves nothing', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<Harness showPlayerBoxes onChange={onChange} onComplete={onComplete} />);
    drag(enterHit(), 3, { x: 320, y: 180 }, { x: 380, y: 180 });
    expect(cornersShown()).toBe(false);   // a drag is not a tap -> no enter
    expect(onChange).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('once editing, a DRAG on the body MOVES the circle and does NOT exit', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<Harness showPlayerBoxes onChange={onChange} onComplete={onComplete} />);
    tap(enterHit());                      // enter
    expect(cornersShown()).toBe(true);
    drag(body(), 4, { x: 320, y: 180 }, { x: 350, y: 210 });
    expect(onChange.mock.calls.at(-1)[0].x).toBe(350);  // moved +30
    expect(onChange.mock.calls.at(-1)[0].y).toBe(210);
    expect(onComplete).toHaveBeenCalledTimes(1);         // committed, not a tap
    expect(cornersShown()).toBe(true);                   // still editing
  });
});

describe('T5610 tracking-OFF regime: byte-identical to T5570 (no tap-toggle)', () => {
  it('editable without any tap; no enter target', () => {
    render(<Harness showPlayerBoxes={false} />);
    expect(cornersShown()).toBe(true);    // editable via toggle-off path
    expect(enterHit()).toBeNull();        // no tap-to-toggle target
  });

  it('a stationary tap on the body commits geometry (old behavior), does not toggle', () => {
    const onComplete = vi.fn();
    render(<Harness showPlayerBoxes={false} onComplete={onComplete} />);
    tap(body());
    expect(onComplete).toHaveBeenCalledTimes(1);  // T5570 path still commits
    expect(cornersShown()).toBe(true);            // still editable (no exit toggle)
  });
});
