import { useRef } from 'react';
import { render, cleanup } from '@testing-library/react';
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
