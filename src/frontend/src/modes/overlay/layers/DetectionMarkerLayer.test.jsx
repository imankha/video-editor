import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DetectionMarkerLayer from './DetectionMarkerLayer';

/**
 * T9620 (UX-10): the per-frame detected-player COUNT on a timeline marker must
 * not read as a jersey number. It is paired with a Users glyph (people, not
 * identity) until that frame is assigned, at which point it becomes a check.
 */
describe('DetectionMarkerLayer count badge (T9620)', () => {
  const region = (keyframes = []) => ({
    id: 'r1',
    startTime: 0,
    endTime: 2,
    fps: 30,
    videoWidth: 1920,
    videoHeight: 1080,
    keyframes,
    detections: [
      { timestamp: 0.5, frame: 15, boxes: [{ x: 1 }, { x: 2 }, { x: 3 }] }, // 3 players
    ],
  });

  it('pairs the count with a Users glyph while unassigned', () => {
    const { container } = render(
      <DetectionMarkerLayer regions={[region()]} duration={2} onSeek={() => {}} />
    );
    // The count is rendered...
    expect(screen.getByText('3')).toBeTruthy();
    // ...alongside a Users glyph so it reads as a count, not a jersey number.
    expect(container.querySelector('svg.lucide-users')).toBeTruthy();
  });

  it('replaces the count with a check once the frame is assigned', () => {
    const assigned = region([
      { frame: 15, origin: 'user', fromDetection: true, x: 0, y: 0, radiusX: 1, radiusY: 1 },
    ]);
    const { container } = render(
      <DetectionMarkerLayer regions={[assigned]} duration={2} onSeek={() => {}} />
    );
    expect(screen.queryByText('3')).toBeNull();
    expect(container.querySelector('svg.lucide-users')).toBeNull();
    expect(container.querySelector('svg.lucide-check')).toBeTruthy();
  });
});
