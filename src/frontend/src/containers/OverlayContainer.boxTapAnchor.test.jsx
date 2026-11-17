import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { OverlayContainer } from './OverlayContainer';
import { EDITOR_MODES } from '../stores';
import { detectionAssignmentStates } from '../modes/overlay/utils/detectionAssignment';

/**
 * T16740: entering Spotlight from Finished's "Add spotlight" leaves the playhead
 * at 0:00, not parked on marker 1. The boxes drawn there come from the nearest
 * detection WITH boxes (0.5 s here; the 0 s sample is empty), so a tap on one
 * must write its keyframe at THAT detection's time, or the guide never counts it.
 */
function region(overrides = {}) {
  return {
    id: 'r1', startTime: 0, endTime: 2, fps: 30, videoWidth: 1920, videoHeight: 1080,
    enabled: true,
    keyframes: [{ frame: 0 }, { frame: 60 }],
    detections: [
      { timestamp: 0, frame: 0, boxes: [] },
      { timestamp: 0.5, frame: 15, boxes: [{ x: 100, y: 200, width: 40, height: 80 }] },
      { timestamp: 1.5, frame: 45, boxes: [{ x: 300, y: 200, width: 40, height: 80 }] },
    ],
    ...overrides,
  };
}

function props(overrides = {}) {
  const r = region();
  return {
    videoRef: { current: { src: 'blob:x', duration: 2 } },
    currentTime: 0, duration: 2, isPlaying: false, isSeeking: false,
    seek: vi.fn(), togglePlay: vi.fn(),
    selectedProjectId: 'proj-1', selectedProject: {}, clips: [], hasClips: false,
    editorMode: EDITOR_MODES.OVERLAY, setSelectedLayer: vi.fn(),
    effectiveOverlayVideoUrl: 'blob:overlay', overlayClipMetadata: null,
    isLoadingWorkingVideo: false, setOverlayClipMetadata: vi.fn(),
    dragHighlight: null, setDragHighlight: vi.fn(),
    selectedHighlightKeyframeTime: null, setSelectedHighlightKeyframeTime: vi.fn(),
    highlightEffectType: 'brightness_boost', setHighlightEffectType: vi.fn(),
    highlightColor: null,
    // Not parked: the entry-park has not landed (the Finished -> Add spotlight path).
    overlaySyncState: 'loading', overlayLoadedProjectId: null,
    highlightRegions: [r], highlightBoundaries: [], highlightRegionKeyframes: [],
    highlightRegionsFramerate: 30,
    initializeHighlightRegions: vi.fn(), resetHighlightRegions: vi.fn(),
    addHighlightRegion: vi.fn(), deleteHighlightRegion: vi.fn(),
    moveHighlightRegionStart: vi.fn(), moveHighlightRegionEnd: vi.fn(),
    commitHighlightRegionStart: vi.fn(), commitHighlightRegionEnd: vi.fn(),
    toggleHighlightRegion: vi.fn(),
    addHighlightRegionKeyframe: vi.fn(), removeHighlightRegionKeyframe: vi.fn(),
    getRegionAtTime: vi.fn(() => r),
    isTimeInEnabledRegion: vi.fn(() => true),
    getRegionHighlightAtTime: vi.fn(() => null),
    getRegionsForExport: vi.fn(() => []),
    restoreHighlightRegions: vi.fn(),
    ...overrides,
  };
}

describe('T16740: a tap on a drawn box counts for the detection those boxes came from', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('at 0:00 (not parked) the boxes are marker 1\'s, and tapping one writes marker 1\'s keyframe', () => {
    const p = props();
    const { result } = renderHook((pp) => OverlayContainer(pp), { initialProps: p });
    expect(result.current.playerDetections).toEqual(region().detections[1].boxes);

    act(() => {
      result.current.handlePlayerSelect({ x: 100, y: 200, radiusX: 26, radiusY: 52 });
    });

    expect(p.addHighlightRegionKeyframe).toHaveBeenCalledTimes(1);
    const [time] = p.addHighlightRegionKeyframe.mock.calls[0];
    expect(time).toBe(0.5);
    // The guide's checklist (same derivation the panel uses) ticks Tap 1 once stored.
    const stored = region({ keyframes: [{ frame: 0 }, { frame: Math.round(time * 30), fromDetection: true }, { frame: 60 }] });
    expect(detectionAssignmentStates([stored])).toEqual([true, false]);
  });
});
