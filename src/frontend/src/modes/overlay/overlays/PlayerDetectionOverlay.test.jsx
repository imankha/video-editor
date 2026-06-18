import { useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PlayerDetectionOverlay from './PlayerDetectionOverlay';

// T3780: the per-player confidence % badge ("73%") was removed outright — it made
// the tool look unsure to a soccer parent. The box outline and the "N players
// detected" count must still render. This test locks in that contract.

const DETECTIONS = [
  { x: 150, y: 170, width: 90, height: 200, confidence: 0.73 },
  { x: 330, y: 150, width: 80, height: 190, confidence: 0.61 },
  { x: 470, y: 190, width: 85, height: 180, confidence: 0.88 },
];

// Stable references: the overlay's display-rect effect depends on panOffset, so a
// fresh object each render would re-trigger it forever. The app passes a stable
// prop; mirror that here.
const PAN_OFFSET = { x: 0, y: 0 };
const VIDEO_METADATA = { width: 560, height: 320 };

// The overlay reads videoRef.current.closest('.video-container'), so render it
// inside a matching container with a real <video> the ref points at.
function Harness({ detections = DETECTIONS }) {
  const videoRef = useRef(null);
  return (
    <div className="video-container" style={{ width: 560, height: 320 }}>
      <video ref={videoRef} />
      <PlayerDetectionOverlay
        videoRef={videoRef}
        videoMetadata={VIDEO_METADATA}
        detections={detections}
        detectionVideoWidth={560}
        detectionVideoHeight={320}
        panOffset={PAN_OFFSET}
      />
    </div>
  );
}

describe('PlayerDetectionOverlay (T3780)', () => {
  it('does not render any confidence % badge', () => {
    const { container } = render(<Harness />);
    const svgTexts = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
    expect(svgTexts.some((t) => /%/.test(t))).toBe(false);
    expect(container.textContent).not.toMatch(/\d+%/);
  });

  it('still renders one box outline per detection (no extra label rects)', () => {
    const { container } = render(<Harness />);
    // One <rect> per detection box. Previously each box also had a label
    // background rect; removing the badge means rect count == detection count.
    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBe(DETECTIONS.length);
  });

  it('keeps the "N players detected" count badge', () => {
    const { container } = render(<Harness />);
    expect(container.textContent).toContain('3 players detected');
  });
});
