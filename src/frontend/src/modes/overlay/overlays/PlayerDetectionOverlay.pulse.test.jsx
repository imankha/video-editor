import { useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PlayerDetectionOverlay from './PlayerDetectionOverlay';

// T12340: while the pick guide is waiting for a pick, every selectable box carries the
// shared coach pulse (class coach-target-pulse); a pick or any other state removes it.
const DETECTIONS = [
  { x: 150, y: 170, width: 90, height: 200, confidence: 0.73 },
  { x: 330, y: 150, width: 80, height: 190, confidence: 0.61 },
];
const PAN_OFFSET = { x: 0, y: 0 };
const VIDEO_METADATA = { width: 560, height: 320 };

function Harness({ pulse }) {
  const videoRef = useRef(null);
  return (
    <div className="video-container" style={{ width: 560, height: 320 }}>
      <video ref={videoRef} />
      <PlayerDetectionOverlay
        videoRef={videoRef}
        videoMetadata={VIDEO_METADATA}
        detections={DETECTIONS}
        detectionVideoWidth={560}
        detectionVideoHeight={320}
        panOffset={PAN_OFFSET}
        pulse={pulse}
      />
    </div>
  );
}

describe('PlayerDetectionOverlay pick pulse (T12340)', () => {
  it('pulses one halo per box with the shared primitive and never blocks clicks', () => {
    const { container } = render(<Harness pulse />);
    const halos = container.querySelectorAll('.coach-target-pulse');
    expect(halos.length).toBe(DETECTIONS.length);
    halos.forEach((h) => expect(h.className).toContain('pointer-events-none'));
  });

  it('does not pulse by default', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('.coach-target-pulse').length).toBe(0);
  });
});
