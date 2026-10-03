import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { OverlayContainer } from './OverlayContainer';
import HighlightOverlay from '../modes/overlay/overlays/HighlightOverlay';
import { EDITOR_MODES } from '../stores';

// Unit-scale video->screen transform (video coords == screen coords) so the
// real HighlightOverlay's drag/resize math in the round-4 regression test
// below is deterministic -- same mock as HighlightOverlay.touch.test.jsx.
vi.mock('../hooks/useVideoDisplayRect', () => {
  const round3 = (v) => Math.round(v * 1000) / 1000;
  return {
    __esModule: true,
    round3,
    default: () => ({
      rect: {
        offsetX: 0, offsetY: 0, width: 1920, height: 1080,
        scaleX: 1, scaleY: 1, zoom: 1, panOffset: { x: 0, y: 0 },
      },
      videoToScreen: (x, y, w, h) => ({ x, y, width: w, height: h }),
      screenToVideo: (x, y, w, h) => ({ x, y, width: w, height: h }),
    }),
  };
});

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

  describe('handleHighlightComplete does not trigger an unwanted guided-pick advance (review round 2 MAJOR fix, through the real container)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('an ordinary drag-release at a time with NO marker does not confirm or seek anywhere -- no invisible playhead jump', () => {
      const seek = vi.fn();
      const region = makeRegion();
      const ready = baseProps({
        seek, duration: 10, currentTime: 0.5,
        highlightRegions: [region],
        overlaySyncState: 'ready',
        overlayLoadedProjectId: 'proj-1',
        isTimeInEnabledRegion: vi.fn(() => true),
        getRegionAtTime: vi.fn(() => region),
      });
      const { result, rerender } = drive(ready);
      rerender(ready); // settle entry-park (parked on marker 1 @ 0.5s)
      expect(result.current.pickGuidePhase).toBe('parked');
      expect(seek).toHaveBeenCalledTimes(1);

      // The user scrubs away from the marker (far enough that OverlayContainer's
      // own scrub-away-clear effect nulls clickedDetection) to an ORDINARY time
      // with no detection marker (1.0s -- markers are at 0.5s/1.5s), then drags
      // the highlight circle there and releases.
      const scrubbed = baseProps({
        seek, duration: 10, currentTime: 1.0,
        highlightRegions: [region],
        overlaySyncState: 'ready',
        overlayLoadedProjectId: 'proj-1',
        isTimeInEnabledRegion: vi.fn(() => true),
        getRegionAtTime: vi.fn(() => region),
      });
      rerender(scrubbed);
      expect(result.current.pickGuidePhase).toBe('away'); // clickedDetection cleared, nothing picked here

      act(() => {
        result.current.handleHighlightComplete({ x: 10, y: 10, radiusX: 5, radiusY: 5, opacity: 0.3, color: null });
      });
      // Never shows "Got it" for an edit that isn't a marker pick.
      expect(result.current.pickGuidePhase).not.toBe('confirm');

      act(() => { vi.advanceTimersByTime(700); });
      // No second seek -- the playhead never got yanked to another marker.
      expect(seek).toHaveBeenCalledTimes(1);
    });

    it('a real marker pick via handleHighlightComplete does not advance while showPlayerBoxes is false (tap-the-circle override with boxes hidden)', () => {
      const seek = vi.fn();
      const parkOnDetectionCallsBefore = () => seek.mock.calls.length;
      const region = makeRegion();
      const ready = baseProps({
        seek, duration: 10, currentTime: 0.5,
        highlightRegions: [region],
        overlaySyncState: 'ready',
        overlayLoadedProjectId: 'proj-1',
        isTimeInEnabledRegion: vi.fn(() => true),
        getRegionAtTime: vi.fn(() => region),
      });
      const { result, rerender } = drive(ready);
      rerender(ready);
      expect(result.current.pickGuidePhase).toBe('parked');

      act(() => { result.current.togglePlayerBoxes(); }); // hide boxes
      rerender({ ...ready, showPlayerBoxes: result.current.showPlayerBoxes });
      expect(result.current.pickGuidePhase).toBeNull(); // suspended output

      const callsBefore = parkOnDetectionCallsBefore();
      act(() => {
        // Picks the ACTUAL parked marker (0.5s) via the tap-the-circle
        // override -- still must not advance while boxes are hidden.
        result.current.handleHighlightComplete({ x: 1, y: 1, radiusX: 1, radiusY: 1, opacity: 0.3, color: null });
      });
      act(() => { vi.advanceTimersByTime(700); });
      expect(seek.mock.calls.length).toBe(callsBefore); // no further seek fired
    });
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

  describe('a drag re-grab cancels a pending guided-pick advance at POINTERDOWN, not first move (review round 4 MAJOR, through the real container + REAL HighlightOverlay)', () => {
    // Round 3 fixed this bug's FIRST-MOVE case (cancel inside
    // handleHighlightChange, which HighlightOverlay only calls from its
    // pointer-MOVE handler). That left a gap: HighlightOverlay's pointerdown
    // handlers (beginDrag/beginResize) call no parent callback at all, so a
    // press-and-hold (ordinary "deciding where to drag" behavior, no move
    // yet) does not cancel anything -- the pending timer can still fire while
    // the pointer is already captured. Calling handleHighlightChange directly
    // (as the round-3 test did) cannot distinguish "cancels on move" from
    // "cancels on pointerdown", so this test drives the REAL HighlightOverlay
    // through real Pointer Events instead.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.useRealTimers(); cleanup(); });

    const VIDEO_METADATA = { width: 1920, height: 1080 };

    // Mirrors OverlayModeView's live wiring: OverlayContainer's state/handlers
    // feed a REAL HighlightOverlay. `stateBoxRef` smuggles the container's
    // latest return value out to the test body (it's written on every
    // render, which React runs synchronously inside the act() each
    // fireEvent/act call below is already wrapped in).
    function DriveWithHighlightOverlay({ containerProps, stateBoxRef }) {
      const videoRef = useRef(null);
      const overlay = OverlayContainer(containerProps);
      stateBoxRef.current = overlay;
      return (
        <div>
          <video ref={videoRef} />
          {overlay.currentHighlightState && (
            <HighlightOverlay
              videoRef={videoRef}
              videoMetadata={VIDEO_METADATA}
              currentHighlight={overlay.currentHighlightState}
              onHighlightChange={overlay.handleHighlightChange}
              onHighlightComplete={overlay.handleHighlightComplete}
              onDragStart={overlay.handleHighlightDragStart}
              isEnabled
              editable
            />
          )}
        </div>
      );
    }

    it('pressing the circle again (no move yet) before the confirm timer fires still cancels it -- the eventual release writes marker N not N+1', () => {
      const seek = vi.fn();
      const addHighlightRegionKeyframe = vi.fn();
      const region = makeRegion();
      const stateBoxRef = { current: null };
      const liveHighlight = { x: 960, y: 540, radiusX: 40, radiusY: 60, opacity: 0.3, color: null };
      const ready = baseProps({
        seek, duration: 10, currentTime: 0.5,
        highlightRegions: [region],
        overlaySyncState: 'ready',
        overlayLoadedProjectId: 'proj-1',
        isTimeInEnabledRegion: vi.fn(() => true),
        getRegionAtTime: vi.fn(() => region),
        getRegionHighlightAtTime: vi.fn(() => liveHighlight),
        addHighlightRegionKeyframe,
      });
      const { rerender } = render(<DriveWithHighlightOverlay containerProps={ready} stateBoxRef={stateBoxRef} />);
      rerender(<DriveWithHighlightOverlay containerProps={ready} stateBoxRef={stateBoxRef} />); // settle entry-park
      expect(stateBoxRef.current.pickGuidePhase).toBe('parked');
      expect(stateBoxRef.current.pickGuideStep).toBe(1);
      expect(seek).toHaveBeenCalledTimes(1);

      // Release 1: the user drags and releases at marker 1 (clickedDetection
      // is still 0.5s) -- schedules the 650ms confirm/advance to marker 2.
      act(() => {
        stateBoxRef.current.handleHighlightComplete({ x: 10, y: 10, radiusX: 5, radiusY: 5, opacity: 0.3, color: null });
      });
      expect(stateBoxRef.current.pickGuidePhase).toBe('confirm');
      expect(addHighlightRegionKeyframe).toHaveBeenCalledTimes(1);
      expect(addHighlightRegionKeyframe.mock.calls[0][0]).toBe(0.5);

      // The user presses the circle body again -- POINTERDOWN ONLY, no move
      // yet (ordinary mouse behavior: deciding where to drag before moving).
      const body = screen.getByTestId('highlight-body');
      fireEvent.pointerDown(body, { pointerId: 9, pointerType: 'mouse', clientX: 960, clientY: 540 });

      // The confirm timer fires WHILE the pointer is captured but hasn't
      // moved. Must already be cancelled by the pointerdown above -- no
      // second seek, no advance onto marker 2.
      act(() => { vi.advanceTimersByTime(700); });
      rerender(<DriveWithHighlightOverlay
        containerProps={{ ...ready, currentTime: seek.mock.calls[seek.mock.calls.length - 1][0] }}
        stateBoxRef={stateBoxRef}
      />);
      expect(seek).toHaveBeenCalledTimes(1); // no second seek onto marker 2
      expect(stateBoxRef.current.pickGuideStep).toBe(1); // still tracking marker 1, not 2

      // Now the user actually moves and releases -- the real drag this press
      // was for.
      fireEvent.pointerMove(body, { pointerId: 9, pointerType: 'mouse', clientX: 965, clientY: 545 });
      fireEvent.pointerUp(body, { pointerId: 9, pointerType: 'mouse', clientX: 965, clientY: 545 });

      expect(addHighlightRegionKeyframe).toHaveBeenCalledTimes(2);
      // The second edit's recorded time must still be marker 1 (0.5s), never
      // marker 2 (1.5s) -- the bug this guards against writes the dragged
      // geometry onto the WRONG (next) marker's keyframe.
      expect(addHighlightRegionKeyframe.mock.calls[1][0]).toBe(0.5);
    });
  });
});
