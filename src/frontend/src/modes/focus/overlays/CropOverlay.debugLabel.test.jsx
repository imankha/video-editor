import { useRef } from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CropOverlay from './CropOverlay';

/**
 * T11960 — the WxH @ (x, y) crop debug label is a local-dev aid. It used to be gated
 * on version.json environment !== 'production', so staging (the QA environment)
 * showed it to users. It must be gated on import.meta.env.DEV instead.
 */

// Staging build: environment is NOT 'production', which is what leaked the label.
vi.mock('../../../version.json', () => ({ default: { environment: 'staging' } }));

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

const CROP = { x: 100, y: 100, width: 200, height: 150 };

function Harness() {
  const videoRef = useRef(null);
  return (
    <div className="video-container" style={{ width: 640, height: 360 }}>
      <video ref={videoRef} />
      <CropOverlay
        videoRef={videoRef}
        videoMetadata={{ width: 640, height: 360 }}
        currentCrop={CROP}
        aspectRatio="free"
        selectedKeyframeIndex={0}
        onCropChange={vi.fn()}
        onCropComplete={vi.fn()}
      />
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('T11960 CropOverlay debug label', () => {
  it('is absent when DEV is false (staging build) with a keyframe selected', () => {
    vi.stubEnv('DEV', false);
    const { container } = render(<Harness />);
    expect(container.textContent).not.toContain('@ (');
  });

  it('is shown in local dev (DEV true) with a keyframe selected', () => {
    vi.stubEnv('DEV', true);
    const { container } = render(<Harness />);
    expect(container.textContent).toContain('200x150 @ (100, 100)');
  });
});
