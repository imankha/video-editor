import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import DetectionMarkerLayer from '../modes/overlay/layers/DetectionMarkerLayer';
import { DETECTION } from './displayNames';

// T14520: the parent picks the athlete; the AI only proposes boxes. No user copy
// may say the app "tracks" players.
const region = {
  id: 'r1', startTime: 0, endTime: 2, fps: 30, videoWidth: 1920, videoHeight: 1080,
  keyframes: [],
  detections: [{ timestamp: 0.5, frame: 15, boxes: [{ x: 1 }] }],
};

describe('detection copy never claims tracking (T14520)', () => {
  it('disabled marker title does not say tracking', () => {
    const { container } = render(<DetectionMarkerLayer regions={[region]} duration={2} isDisabled />);
    const titles = [...container.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).join('|');
    expect(titles).toMatch(/\S/);
    expect(titles).not.toMatch(/track/i);
  });

  it('canonical detection strings avoid tracking and are used by the components', () => {
    expect(Object.values(DETECTION).join(' ')).not.toMatch(/track/i);
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
    expect(read('../modes/overlay/overlays/PlayerDetectionOverlay.jsx')).not.toContain('Detecting players...');
    expect(read('../components/BuyCreditsModal.jsx')).not.toContain('<li>Player detection</li>');
  });
});
