import { render, screen, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { useGuidedAthletePick } from '../hooks/useGuidedAthletePick';
import { GUIDE } from '../../../config/displayNames';

// T12790: opening Overlay on a clip whose spotlight has NO detection markers showed no
// guide at all. The walk's phase was null whenever total === 0, so the existing
// overlay.pick.none rule ("Drag the circle onto your athlete.") could never fire.
const regionNoDetections = {
  id: 'r1', startTime: 0, endTime: 3, fps: 30, videoWidth: 1920, videoHeight: 1080,
  keyframes: [{ frame: 0 }, { frame: 90 }], detections: [],
};

const drive = (over) => renderHook(() => useGuidedAthletePick({
  active: true, canPark: true, sessionKey: 's1', showPlayerBoxes: true,
  highlightRegions: [regionNoDetections], isPlaying: false, clickedDetection: null,
  parkOnDetection: vi.fn(), currentTime: 0, ...over,
}));

describe('Overlay with no detected athletes (T12790)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the walk reports the none phase once the clip has loaded', () => {
    expect(drive().result.current.phase).toBe('none');
  });

  it('stays silent until the clip has loaded (no flash while regions arrive)', () => {
    expect(drive({ canPark: false }).result.current.phase).toBeNull();
    expect(drive({ highlightRegions: [] }).result.current.phase).toBeNull();
  });

  it('the guide tells the user to drag the circle', () => {
    render(<SpotlightPickGuide phase="none" step={null} total={0} assignedCount={0} boxed noBoxes />);
    expect(screen.getByTestId('spotlight-pick-guide').getAttribute('data-guide-id')).toBe('overlay.pick.none');
    expect(screen.getByTestId('pick-guide-text').textContent).toBe(GUIDE.overlay.pick.none.title);
  });
});
