import { useRef } from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CropOverlay from './CropOverlay';
import { MAX_ROT } from '../../../utils/rotationSafeArea';

/**
 * T5641 — the straighten line-drag tool + fine dial are HIDDEN by default and
 * revealed only when the parent-owned `straightenVisible` prop is true (toggled
 * from the Straighten button inline with the zoom controls). Hiding the controls
 * must NOT clear the rotation effect: a set angle keeps CSS-rotating the <video>
 * element even while the editing UI is hidden.
 *
 * The video->screen transform is mocked to a unit-scale identity rect (same as
 * CropOverlay.test.jsx) so rendering is deterministic without a real layout.
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
const CROP = { x: 100, y: 100, width: 200, height: 150 };

function Harness({ straightenVisible = false, rotation = 0, onSetRotation = () => {} }) {
  const videoRef = useRef(null);
  return (
    <div className="video-container" style={{ width: 640, height: 360 }}>
      <video ref={videoRef} data-testid="video-el" />
      <CropOverlay
        videoRef={videoRef}
        videoMetadata={VIDEO_METADATA}
        currentCrop={CROP}
        aspectRatio="free"
        rotation={rotation}
        onSetRotation={onSetRotation}
        straightenVisible={straightenVisible}
        onCropChange={() => {}}
        onCropComplete={() => {}}
      />
    </div>
  );
}

/** The fine dial's rotation slider (present only when the tool is revealed). */
const getDialSlider = (c) => c.querySelector('input[type="range"]');
/** The full-overlay straighten pointer-capture layer (cursor: crosshair). */
const getCaptureLayer = (c) => c.querySelector('div[style*="crosshair"]');
/** The ± nudge buttons + live readout on the fine dial. */
const getPlusBtn = (c) => c.querySelector('button[aria-label="Nudge rotation clockwise"]');
const getMinusBtn = (c) => c.querySelector('button[aria-label="Nudge rotation counter"]');
const getReadout = (c) => c.querySelector('span.tabular-nums');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('T5641 straighten tool visibility toggle', () => {
  it('hides the dial AND the capture layer by default (straightenVisible=false)', () => {
    const { container } = render(<Harness straightenVisible={false} />);
    expect(getDialSlider(container)).toBeNull();
    expect(getCaptureLayer(container)).toBeNull();
  });

  it('reveals the dial and the capture layer when straightenVisible=true', () => {
    const { container } = render(<Harness straightenVisible rotation={0} />);
    const slider = getDialSlider(container);
    expect(slider).toBeTruthy();
    expect(getCaptureLayer(container)).toBeTruthy();
    // MAX_ROT=20 range preserved.
    expect(Number(slider.min)).toBe(-MAX_ROT);
    expect(Number(slider.max)).toBe(MAX_ROT);
    expect(Number(slider.step)).toBe(0.1);
  });

  it('keeps the rotation effect applied while the tool is HIDDEN (controls, not effect)', () => {
    const { getByTestId } = render(<Harness straightenVisible={false} rotation={8} />);
    // The <video> element is CSS-rotated even though the editing UI is hidden.
    expect(getByTestId('video-el').style.transform).toBe('rotate(-8deg)');
  });

  it('applies the same rotation when the tool is shown (parity)', () => {
    const { getByTestId } = render(<Harness straightenVisible rotation={8} />);
    expect(getByTestId('video-el').style.transform).toBe('rotate(-8deg)');
  });
});

/**
 * T5690 — the ± nudge buttons support press-and-hold auto-repeat. The whole hold
 * previews via liveRotation and commits exactly ONE set_rotation on release
 * (gesture-based persistence, same as a slider drag) — never one per tick.
 */
describe('T5690 straighten nudge press-and-hold', () => {
  const down = (btn) => fireEvent.pointerDown(btn, { pointerId: 1 });
  const up = (btn) => fireEvent.pointerUp(btn, { pointerId: 1 });

  it('a quick tap nudges once and commits once (+0.1)', () => {
    const onSetRotation = vi.fn();
    const { container } = render(
      <Harness straightenVisible rotation={0} onSetRotation={onSetRotation} />,
    );
    const plus = getPlusBtn(container);
    act(() => { down(plus); }); // immediate preview step
    act(() => { up(plus); });   // release -> single commit
    expect(onSetRotation).toHaveBeenCalledTimes(1);
    expect(onSetRotation.mock.calls[0][0]).toBeCloseTo(0.1, 5);
  });

  it('holding + climbs continuously and commits ONE value on release (not per tick)', () => {
    vi.useFakeTimers();
    try {
      const onSetRotation = vi.fn();
      const { container } = render(
        <Harness straightenVisible rotation={0} onSetRotation={onSetRotation} />,
      );
      const plus = getPlusBtn(container);
      act(() => { down(plus); });            // immediate step -> 0.1
      expect(getReadout(container).textContent).toBe('0.1°');
      act(() => { vi.advanceTimersByTime(1000); }); // repeat ticks accumulate
      const held = parseFloat(getReadout(container).textContent);
      expect(held).toBeGreaterThan(0.1);     // climbed while held
      expect(onSetRotation).not.toHaveBeenCalled(); // NOTHING persisted mid-hold
      act(() => { up(plus); });              // release -> exactly one commit
      expect(onSetRotation).toHaveBeenCalledTimes(1);
      expect(onSetRotation.mock.calls[0][0]).toBeCloseTo(held, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holding − drops the value (mirror direction)', () => {
    vi.useFakeTimers();
    try {
      const onSetRotation = vi.fn();
      const { container } = render(
        <Harness straightenVisible rotation={0} onSetRotation={onSetRotation} />,
      );
      const minus = getMinusBtn(container);
      act(() => { down(minus); });
      act(() => { vi.advanceTimersByTime(1000); });
      act(() => { up(minus); });
      expect(onSetRotation).toHaveBeenCalledTimes(1);
      expect(onSetRotation.mock.calls[0][0]).toBeLessThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps the held value to +MAX_ROT and commits the clamp once', () => {
    vi.useFakeTimers();
    try {
      const onSetRotation = vi.fn();
      const { container } = render(
        <Harness straightenVisible rotation={MAX_ROT - 0.05} onSetRotation={onSetRotation} />,
      );
      const plus = getPlusBtn(container);
      act(() => { down(plus); });
      act(() => { vi.advanceTimersByTime(2000); }); // way past the ceiling
      expect(getReadout(container).textContent).toBe(`${MAX_ROT.toFixed(1)}°`);
      act(() => { up(plus); });
      expect(onSetRotation).toHaveBeenCalledTimes(1);
      expect(onSetRotation.mock.calls[0][0]).toBeCloseTo(MAX_ROT, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a leave firing after up does not double-commit', () => {
    const onSetRotation = vi.fn();
    const { container } = render(
      <Harness straightenVisible rotation={0} onSetRotation={onSetRotation} />,
    );
    const plus = getPlusBtn(container);
    act(() => { down(plus); });
    act(() => { up(plus); });
    act(() => { fireEvent.pointerLeave(plus, { pointerId: 1 }); }); // stray leave
    expect(onSetRotation).toHaveBeenCalledTimes(1);
  });
});
