import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { OverlayContainer } from './OverlayContainer';
import { EDITOR_MODES } from '../stores';

/**
 * T11570 BLOCKING-fix regression: entry-park must actually fire through the
 * REAL OverlayContainer wiring, not just the isolated useGuidedAthletePick
 * hook. On mount in the real app, `highlightRegions` starts empty
 * (`useHighlightRegions` initial state) and only gets populated once the
 * async `/overlay-data` fetch resolves (OverlayScreen's load effect calling
 * `restoreHighlightRegions`) -- these tests drive that EXACT prop evolution
 * through the container itself, mocking only the async boundary (the props
 * OverlayScreen would pass once its own fetch resolves), not the guided-pick
 * hook or the view.
 */

function makeRegion(overrides = {}) {
  return {
    id: 'r1', startTime: 0, endTime: 2, fps: 30, videoWidth: 1920, videoHeight: 1080,
    enabled: true,
    keyframes: [],
    detections: [
      { timestamp: 0.5, frame: 15, boxes: [{ x: 1 }] },
      { timestamp: 1.5, frame: 45, boxes: [{ x: 1 }] },
    ],
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    videoRef: { current: { src: 'blob:x', duration: 0 } },
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    isSeeking: false,
    seek: vi.fn(),
    togglePlay: vi.fn(),
    framingVideoUrl: null,
    framingMetadata: null,
    keyframes: [],
    segments: {},
    segmentSpeeds: {},
    segmentBoundaries: [],
    trimRange: null,
    selectedProjectId: 'proj-1',
    selectedProject: {},
    clips: [],
    hasClips: false,
    editorMode: EDITOR_MODES.OVERLAY,
    setEditorMode: vi.fn(),
    setSelectedLayer: vi.fn(),
    overlayVideoFile: null,
    overlayVideoUrl: 'blob:overlay',
    overlayVideoMetadata: { width: 1920, height: 1080, duration: 10 },
    overlayClipMetadata: null,
    isLoadingWorkingVideo: false,
    setOverlayClipMetadata: vi.fn(),
    setIsLoadingWorkingVideo: vi.fn(),
    dragHighlight: null,
    setDragHighlight: vi.fn(),
    selectedHighlightKeyframeTime: null,
    setSelectedHighlightKeyframeTime: vi.fn(),
    highlightEffectType: 'brightness_boost',
    setHighlightEffectType: vi.fn(),
    highlightColor: null,
    // Real app: BOTH start this way on mount, before /overlay-data resolves.
    overlaySyncState: 'loading',
    overlayLoadedProjectId: null,
    // Real app: useHighlightRegions' own useState([]) initial value.
    highlightRegions: [],
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    highlightRegionsFramerate: 30,
    initializeHighlightRegions: vi.fn(),
    resetHighlightRegions: vi.fn(),
    addHighlightRegion: vi.fn(),
    deleteHighlightRegion: vi.fn(),
    moveHighlightRegionStart: vi.fn(),
    moveHighlightRegionEnd: vi.fn(),
    commitHighlightRegionStart: vi.fn(),
    commitHighlightRegionEnd: vi.fn(),
    toggleHighlightRegion: vi.fn(),
    addHighlightRegionKeyframe: vi.fn(),
    removeHighlightRegionKeyframe: vi.fn(),
    getRegionAtTime: vi.fn(() => null),
    isTimeInEnabledRegion: vi.fn(() => false),
    getRegionHighlightAtTime: vi.fn(() => null),
    getRegionsForExport: vi.fn(() => []),
    restoreHighlightRegions: vi.fn(),
    initializeHighlightRegionsFromClips: vi.fn(),
    ...overrides,
  };
}

function drive(initialProps) {
  const { result, rerender } = renderHook((props) => OverlayContainer(props), {
    initialProps,
  });
  return { result, rerender };
}

describe('OverlayContainer guided-pick wiring (T11570 BLOCKING fix)', () => {
  beforeEach(() => {
    // recordAchievement fire-and-forgets a real fetch; stub it so an
    // accidental all-picked state in these tests doesn't hit the network.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('does NOT entry-park on mount (zero regions, sync still loading, duration unknown) -- the exact real-app mount shape', () => {
    const seek = vi.fn();
    const { result } = drive(baseProps({ seek }));
    expect(seek).not.toHaveBeenCalled();
    expect(result.current.pickGuidePhase).toBeNull();
  });

  it('entry-parks via the REAL seek() once /overlay-data resolves (regions load + sync ready + duration known)', () => {
    const seek = vi.fn();
    const props = baseProps({ seek, duration: 0 });
    const { result, rerender } = drive(props);

    // Nothing yet: mount shape (loading, zero regions, unknown duration).
    expect(seek).not.toHaveBeenCalled();
    expect(result.current.pickGuidePhase).toBeNull();

    // The async /overlay-data fetch resolves: OverlayScreen's load effect
    // calls restoreHighlightRegions (-> highlightRegions populated),
    // setOverlaySyncState('ready'), setOverlayLoadedProjectId(projectId) --
    // and by this point the video's duration is also known. `currentTime:
    // 0.5` here is the marker-1 time entry-park is about to seek to:
    // `parkOnDetection` calls `setClickedDetection` + `seek()` (which calls
    // useVideo's OWN `setCurrentTime` synchronously, useVideo.js ~L456)
    // inside the SAME effect execution, and React 18 batches both -- in
    // production `currentTime` and `clickedDetection` land consistent in
    // ONE commit, never a render with one updated and not the other.
    rerender(baseProps({
      seek, duration: 10, currentTime: 0.5,
      highlightRegions: [makeRegion()],
      overlaySyncState: 'ready',
      overlayLoadedProjectId: 'proj-1',
    }));

    expect(result.current.pickGuidePhase).toBe('parked');
    expect(result.current.pickGuideStep).toBe(1);
    expect(result.current.pickGuideTotal).toBe(2);
    // The REAL seek() was actually invoked with the first marker's time.
    expect(seek).toHaveBeenCalledWith(0.5);
  });

  it('does NOT entry-park while sync is ready but duration is still unknown (seek() would no-op, T10750)', () => {
    const seek = vi.fn();
    const { result, rerender } = drive(baseProps({ seek }));
    rerender(baseProps({
      seek, duration: 0, // still unknown
      highlightRegions: [makeRegion()],
      overlaySyncState: 'ready',
      overlayLoadedProjectId: 'proj-1',
    }));
    expect(seek).not.toHaveBeenCalled();
    expect(result.current.pickGuidePhase).toBeNull();
  });

  it('does NOT entry-park while duration is known but sync state is not yet "ready" for THIS project', () => {
    const seek = vi.fn();
    const { result, rerender } = drive(baseProps({ seek }));
    rerender(baseProps({
      seek, duration: 10,
      highlightRegions: [makeRegion()],
      overlaySyncState: 'ready',
      overlayLoadedProjectId: 'some-other-project', // stale/wrong project
    }));
    expect(seek).not.toHaveBeenCalled();
    expect(result.current.pickGuidePhase).toBeNull();
  });

  it('does not re-park on a later highlightRegions change (e.g. a pick) once already entry-parked for this project', () => {
    const seek = vi.fn();
    // currentTime: 0.5 matches marker-1's seek target -- see the batching
    // note on the first test above for why this is the realistic value.
    const ready = baseProps({
      seek, duration: 10, currentTime: 0.5,
      highlightRegions: [makeRegion()],
      overlaySyncState: 'ready',
      overlayLoadedProjectId: 'proj-1',
    });
    const { result, rerender } = drive(ready);
    rerender(ready); // settle
    expect(seek).toHaveBeenCalledTimes(1);

    const picked = makeRegion({ keyframes: [{ frame: 15, fromDetection: true }] });
    rerender(baseProps({
      seek, duration: 10, currentTime: 0.5,
      highlightRegions: [picked],
      overlaySyncState: 'ready',
      overlayLoadedProjectId: 'proj-1',
    }));
    expect(seek).toHaveBeenCalledTimes(1); // no second entry-park
    expect(result.current.pickGuideStep).toBe(1); // untouched by the regions change
  });

  it('a new project load (different overlayLoadedProjectId) entry-parks again for the new clip', () => {
    const seek = vi.fn();
    const first = baseProps({
      seek, duration: 10, currentTime: 0.5,
      highlightRegions: [makeRegion()],
      overlaySyncState: 'ready',
      overlayLoadedProjectId: 'proj-1',
    });
    const { rerender } = drive(first);
    rerender(first);
    expect(seek).toHaveBeenCalledTimes(1);

    const secondRegion = makeRegion({ id: 'r2', detections: [{ timestamp: 5.0, frame: 150, boxes: [{ x: 1 }] }] });
    rerender(baseProps({
      seek, duration: 8, currentTime: 5.0,
      highlightRegions: [secondRegion],
      overlaySyncState: 'ready',
      overlayLoadedProjectId: 'proj-2',
      selectedProjectId: 'proj-2',
    }));
    expect(seek).toHaveBeenCalledTimes(2);
    expect(seek).toHaveBeenLastCalledWith(5.0);
  });

  describe('showPlayerBoxes toggle suspends the guide (MAJOR 4, through the real container)', () => {
    it('togglePlayerBoxes() hides the guide, toggling again resumes it where it left off', () => {
      const seek = vi.fn();
      const ready = baseProps({
        seek, duration: 10, currentTime: 0.5,
        highlightRegions: [makeRegion()],
        overlaySyncState: 'ready',
        overlayLoadedProjectId: 'proj-1',
      });
      const { result, rerender } = drive(ready);
      rerender(ready);
      expect(result.current.pickGuidePhase).toBe('parked');
      expect(result.current.showPlayerBoxes).toBe(true);

      act(() => { result.current.togglePlayerBoxes(); });
      rerender(ready);
      expect(result.current.showPlayerBoxes).toBe(false);
      expect(result.current.pickGuidePhase).toBeNull();
      expect(result.current.pickGuideStep).toBe(1); // tracked underneath, not reset

      act(() => { result.current.togglePlayerBoxes(); });
      rerender(ready);
      expect(result.current.showPlayerBoxes).toBe(true);
      expect(result.current.pickGuidePhase).toBe('parked');
      expect(result.current.pickGuideStep).toBe(1); // same marker, walk not restarted
    });
  });
});
