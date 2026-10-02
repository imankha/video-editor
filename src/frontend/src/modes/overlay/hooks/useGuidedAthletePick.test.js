import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGuidedAthletePick, PICK_CONFIRM_MS } from './useGuidedAthletePick';

// Keyframes are authored in 30fps space (frame -> time at 30fps).
const boundary = (frame) => ({ frame });
const userKf = (frame) => ({ frame, fromDetection: true });

// One region, two detection markers at 1.0s (frame 30) and 2.0s (frame 60).
const regionWith = (keyframes, overrides = {}) => ({
  id: 'r1',
  startTime: 0,
  endTime: 3,
  fps: 30,
  videoWidth: 1920,
  videoHeight: 1080,
  keyframes,
  detections: [
    { timestamp: 1.0, frame: 30, boxes: [{ x: 1 }] },
    { timestamp: 2.0, frame: 60, boxes: [{ x: 2 }] },
  ],
  ...overrides,
});

function drive(props) {
  const parkOnDetection = vi.fn();
  const { result, rerender } = renderHook(
    (p) => useGuidedAthletePick({
      parkOnDetection,
      canPark: true,
      sessionKey: 'session-1',
      showPlayerBoxes: true,
      ...p,
    }),
    { initialProps: props }
  );
  return { parkOnDetection, result, rerender };
}

describe('useGuidedAthletePick', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('entry-parks on the first unpicked marker when becoming active', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    const { parkOnDetection, result } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null,
    });
    expect(parkOnDetection).toHaveBeenCalledTimes(1);
    expect(parkOnDetection).toHaveBeenCalledWith(
      expect.objectContaining({ regionId: 'r1', frame: 30, fps: 30, timestamp: 1.0 })
    );
    expect(result.current.step).toBe(1);
    expect(result.current.total).toBe(2);
  });

  it('does not entry-park (or crash) when there are no markers', () => {
    const { parkOnDetection, result } = drive({
      active: true, highlightRegions: [], isPlaying: false, clickedDetection: null,
    });
    expect(parkOnDetection).not.toHaveBeenCalled();
    expect(result.current.phase).toBeNull();
    expect(result.current.step).toBeNull();
  });

  describe('entry-park waits for canPark (BLOCKING fix: regions load async, seek() needs a known duration)', () => {
    it('does NOT entry-park while canPark is false, even with markers already present', () => {
      const region = regionWith([boundary(0), boundary(90)]);
      const { parkOnDetection, result } = drive({
        active: true, canPark: false, sessionKey: 'proj-1',
        highlightRegions: [region], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).not.toHaveBeenCalled();
      expect(result.current.phase).toBeNull();
    });

    it('fires the entry-park the moment canPark flips true -- the real OverlayContainer shape: mount with zero regions/unknown duration, THEN the async /overlay-data fetch resolves', () => {
      const { parkOnDetection, result, rerender } = drive({
        active: true, canPark: false, sessionKey: 'proj-1',
        highlightRegions: [], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).not.toHaveBeenCalled();

      const region = regionWith([boundary(0), boundary(90)]);
      rerender({
        active: true, canPark: true, sessionKey: 'proj-1',
        highlightRegions: [region], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(1);
      expect(parkOnDetection).toHaveBeenCalledWith(
        expect.objectContaining({ regionId: 'r1', frame: 30, timestamp: 1.0 })
      );
      expect(result.current.step).toBe(1);
    });

    it('fires AT MOST ONCE per sessionKey -- does not re-park after a pick changes highlightRegions', () => {
      const region = regionWith([boundary(0), boundary(90)]);
      const { parkOnDetection, rerender } = drive({
        active: true, canPark: true, sessionKey: 'proj-1',
        highlightRegions: [region], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(1);

      // Same sessionKey, regions changed (as if a pick just landed) -- must
      // NOT re-fire entry-park (that would yank the user back to marker 1
      // mid-walk).
      const picked = regionWith([boundary(0), userKf(30), boundary(90)]);
      rerender({
        active: true, canPark: true, sessionKey: 'proj-1',
        highlightRegions: [picked], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(1);
    });

    it('a new sessionKey (a different clip/project loaded) allows exactly one more entry-park', () => {
      const regionA = regionWith([boundary(0), boundary(90)]);
      const { parkOnDetection, rerender } = drive({
        active: true, canPark: true, sessionKey: 'proj-1',
        highlightRegions: [regionA], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(1);

      const regionB = { ...regionWith([boundary(0), boundary(90)]), id: 'r2' };
      rerender({
        active: true, canPark: true, sessionKey: 'proj-2',
        highlightRegions: [regionB], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(2);
      expect(parkOnDetection).toHaveBeenLastCalledWith(
        expect.objectContaining({ regionId: 'r2' })
      );
    });

    it('becoming inactive then active again re-arms the SAME sessionKey only if it actually changed -- going inactive clears the latch entirely', () => {
      const region = regionWith([boundary(0), boundary(90)]);
      const { parkOnDetection, rerender } = drive({
        active: true, canPark: true, sessionKey: 'proj-1',
        highlightRegions: [region], isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(1);

      rerender({
        active: false, canPark: true, sessionKey: 'proj-1',
        highlightRegions: [region], isPlaying: false, clickedDetection: null,
      });
      rerender({
        active: true, canPark: true, sessionKey: 'proj-1',
        highlightRegions: [region], isPlaying: false, clickedDetection: null,
      });
      // Re-entering Overlay mode (active false->true) on the SAME clip parks again --
      // this mirrors the real app (OverlayScreen fully unmounts/remounts on mode
      // switch, so the hook itself remounts too; this proves the in-hook latch
      // doesn't ALSO suppress a legitimate re-mount park).
      expect(parkOnDetection).toHaveBeenCalledTimes(2);
    });
  });

  it('clears tracked state and cancels any pending advance when becoming inactive', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    const { result, rerender } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null,
    });
    expect(result.current.step).toBe(1);
    rerender({ active: false, highlightRegions: [region], isPlaying: false, clickedDetection: null });
    expect(result.current.step).toBeNull();
    expect(result.current.phase).toBeNull();
  });

  it('schedules a "confirm" phase after a pick, then auto-advances to the next unpicked marker after PICK_CONFIRM_MS', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    const { parkOnDetection, result, rerender } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 1.0 },
    });
    expect(result.current.phase).toBe('parked');

    act(() => { result.current.scheduleGuidedAdvance('r1', 1.0); });
    expect(result.current.phase).toBe('confirm');
    expect(parkOnDetection).toHaveBeenCalledTimes(1); // only the entry-park so far

    act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS); });
    // Advance landed on marker 2 (2.0s) -- marker 1 now counts assigned via justAssigned.
    expect(parkOnDetection).toHaveBeenCalledTimes(2);
    expect(parkOnDetection).toHaveBeenLastCalledWith(
      expect.objectContaining({ regionId: 'r1', frame: 60, timestamp: 2.0 })
    );
    expect(result.current.step).toBe(2);

    // Re-render with the region reflecting both picks (marker 1 persisted) --
    // parked on marker 2, confirm cleared.
    const bothPicked = regionWith([boundary(0), userKf(30), boundary(90)]);
    rerender({ active: true, highlightRegions: [bothPicked], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 2.0 } });
    expect(result.current.phase).toBe('parked');
  });

  it('wraps forward-then-wrap: picking the last marker advances back to marker 1', () => {
    // Marker 1 (1.0s) already picked; parked on marker 2 (2.0s, index 1).
    const region = regionWith([boundary(0), userKf(30), boundary(90)]);
    const { parkOnDetection, result } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 2.0 },
    });
    expect(result.current.step).toBe(2); // entry-park found marker 2 as the only unpicked one

    act(() => { result.current.scheduleGuidedAdvance('r1', 2.0); });
    act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS); });
    // Both markers now picked -- walk is done, no further park call.
    expect(parkOnDetection).toHaveBeenCalledTimes(1); // only the entry-park
    expect(result.current.step).toBeNull();
  });

  it('reaches "done" once every marker is assigned', () => {
    const region = regionWith([boundary(0), userKf(30), userKf(60), boundary(90)]);
    const { result } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null,
    });
    expect(result.current.phase).toBe('done');
    expect(result.current.total).toBe(2);
  });

  it('Done -> tap a marker re-opens Picking for it only, then falls back to Done (no re-pick)', () => {
    const region = regionWith([boundary(0), userKf(30), userKf(60), boundary(90)]);
    const { result, rerender } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null,
    });
    expect(result.current.phase).toBe('done');

    // Direct tap on marker 1 to revisit it -- shows Picking for that marker,
    // even though the walk as a whole is already done.
    act(() => {
      result.current.handleDetectionMarkerTap({ regionId: 'r1', frame: 30, fps: 30, timestamp: 1.0, boxes: [] });
    });
    rerender({ active: true, highlightRegions: [region], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 1.0 } });
    expect(result.current.phase).toBe('parked');
    expect(result.current.step).toBe(1);

    // Scrubbing/playing away WITHOUT re-picking falls back to Done, not Away --
    // nothing is actually missing.
    rerender({ active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null });
    expect(result.current.phase).toBe('done');
  });

  it('Done -> tap a marker -> re-pick it -> returns to Done (Confirming -> Done, no unpicked left)', () => {
    const region = regionWith([boundary(0), userKf(30), userKf(60), boundary(90)]);
    const { result, rerender } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null,
    });
    act(() => {
      result.current.handleDetectionMarkerTap({ regionId: 'r1', frame: 30, fps: 30, timestamp: 1.0, boxes: [] });
    });
    rerender({ active: true, highlightRegions: [region], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 1.0 } });

    act(() => { result.current.scheduleGuidedAdvance('r1', 1.0); });
    expect(result.current.phase).toBe('confirm');
    act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS); });
    // Every marker still assigned (the re-pick didn't unassign anything else) --
    // nextUnpickedMarker finds nothing, walk returns to Done.
    expect(result.current.phase).toBe('done');
    expect(result.current.step).toBeNull();
  });

  it('cancels the pending auto-advance when the user starts playing during the confirm window', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    const { parkOnDetection, result, rerender } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 1.0 },
    });
    act(() => { result.current.scheduleGuidedAdvance('r1', 1.0); });
    expect(result.current.phase).toBe('confirm');

    // Real integration: OverlayContainer's own effect nulls clickedDetection
    // the moment isPlaying flips true -- both change together.
    rerender({ active: true, highlightRegions: [region], isPlaying: true, clickedDetection: null });
    expect(result.current.phase).toBe('away'); // confirm cancelled, no longer parked (playing)

    act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS); });
    expect(parkOnDetection).toHaveBeenCalledTimes(1); // the advance never fired
  });

  it('cancels the pending auto-advance when the user scrubs away (clickedDetection clears) during the confirm window', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    const { parkOnDetection, result, rerender } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 1.0 },
    });
    act(() => { result.current.scheduleGuidedAdvance('r1', 1.0); });

    rerender({ active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null });
    expect(result.current.phase).toBe('away');

    act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS); });
    expect(parkOnDetection).toHaveBeenCalledTimes(1); // the advance never fired
  });

  it('a direct marker tap cancels any pending advance, re-parks, and tracks the tapped step', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    const { parkOnDetection, result } = drive({
      active: true, highlightRegions: [region], isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 1.0 },
    });
    act(() => { result.current.scheduleGuidedAdvance('r1', 1.0); }); // pending advance to marker 2

    act(() => {
      result.current.handleDetectionMarkerTap({ regionId: 'r1', frame: 60, fps: 30, timestamp: 2.0, boxes: [] });
    });
    expect(result.current.step).toBe(2); // tapped marker 2 directly
    expect(result.current.phase).not.toBe('confirm');

    act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS); });
    // The pending advance from the pick was cancelled by the tap -- only
    // the entry-park + the direct tap's own park calls happened.
    expect(parkOnDetection).toHaveBeenCalledTimes(2);
  });

  it('"Go to step N" (resumeTrackedMarker) re-parks on the tracked marker while away', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    const { parkOnDetection, result, rerender } = drive({
      active: true, highlightRegions: [region], isPlaying: true, clickedDetection: null,
    });
    // isPlaying=true from the start means the entry-park's clickedDetection
    // (owned by the caller, not this hook) would be cleared by the caller;
    // simulate "away" directly.
    rerender({ active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null });
    expect(result.current.phase).toBe('away');

    act(() => { result.current.resumeTrackedMarker(); });
    expect(parkOnDetection).toHaveBeenCalledTimes(2); // entry-park + resume
  });

  describe('scheduleGuidedAdvance derives the step from the ACTUAL picked marker (MAJOR 1 fix)', () => {
    it('advances from the picked marker, not a stale trackedMarkerIndex, when they genuinely diverge', () => {
      // 4 markers, 2 regions. idx0=r1@0.5 (A, unpicked), idx1=r1@1.5 (the
      // marker about to be ACTUALLY picked), idx2=r2@10.5 (already picked),
      // idx3=r2@11.5 (B, unpicked).
      const r1 = {
        id: 'r1', startTime: 0, endTime: 2, fps: 30, videoWidth: 100, videoHeight: 100,
        keyframes: [boundary(0), boundary(60)],
        detections: [{ timestamp: 0.5, frame: 15, boxes: [{ x: 1 }] }, { timestamp: 1.5, frame: 45, boxes: [{ x: 1 }] }],
      };
      const r2 = {
        id: 'r2', startTime: 10, endTime: 12, fps: 30, videoWidth: 100, videoHeight: 100,
        keyframes: [boundary(300), userKf(315), boundary(360)], // idx2 (10.5s=frame315) already picked
        detections: [{ timestamp: 10.5, frame: 315, boxes: [{ x: 1 }] }, { timestamp: 11.5, frame: 345, boxes: [{ x: 1 }] }],
      };
      const { result } = drive({
        active: true, highlightRegions: [r1, r2], isPlaying: false, clickedDetection: null,
      });
      expect(result.current.step).toBe(1); // entry-park found the first unpicked (idx0, A)

      // Simulate the guide having drifted to tracking marker 4 (idx3, B) --
      // e.g. a direct tap while "away" -- WITHOUT picking it.
      act(() => {
        result.current.handleDetectionMarkerTap({ regionId: 'r2', frame: 345, fps: 30, timestamp: 11.5, boxes: [] });
      });
      expect(result.current.step).toBe(4); // tracked on B (idx3), nothing picked yet

      // Now the user actually picks marker 2 (idx1, r1@1.5) instead --
      // independent of what's tracked (boxes can show near the playhead
      // regardless of the guide's own tracked marker).
      act(() => { result.current.scheduleGuidedAdvance('r1', 1.5); });
      // Confirm must show the marker ACTUALLY picked (step 2), not the
      // stale tracked one (step 4).
      expect(result.current.phase).toBe('confirm');
      expect(result.current.step).toBe(2);

      act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS); });
      // Correct (advance FROM idx1): skips idx2 (already picked), lands on
      // idx3 (B) -- step 4. The BUG (advancing from the stale tracked idx3
      // instead) would wrap forward from idx3 and land on idx0 (A) -- step 1
      // -- a genuinely different, wrong marker.
      expect(result.current.step).toBe(4);
    });

    it('renders "Step null of N" never -- falls back to fromIndex -1 and warns when the picked marker is not found', () => {
      const region = regionWith([boundary(0), boundary(90)]);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = drive({
        active: true, highlightRegions: [region], isPlaying: false, clickedDetection: null,
      });
      act(() => { result.current.scheduleGuidedAdvance('does-not-exist', 999); });
      expect(warnSpy).toHaveBeenCalled();
      expect(result.current.step).not.toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe('prefers-reduced-motion (MAJOR 3 fix)', () => {
    const mockMatchMedia = (matches) => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
        media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      }));
    };
    const originalMatchMedia = window.matchMedia;
    afterEach(() => { window.matchMedia = originalMatchMedia; });

    it('uses PICK_CONFIRM_MS (650ms) normally', () => {
      mockMatchMedia(false);
      const region = regionWith([boundary(0), boundary(90)]);
      const { parkOnDetection, result } = drive({
        active: true, highlightRegions: [region], isPlaying: false,
        clickedDetection: { regionId: 'r1', timestamp: 1.0 },
      });
      act(() => { result.current.scheduleGuidedAdvance('r1', 1.0); });
      act(() => { vi.advanceTimersByTime(PICK_CONFIRM_MS - 50); });
      expect(parkOnDetection).toHaveBeenCalledTimes(1); // not yet -- still confirming
      act(() => { vi.advanceTimersByTime(50); });
      expect(parkOnDetection).toHaveBeenCalledTimes(2);
    });

    it('advances with 0ms delay under prefers-reduced-motion', () => {
      mockMatchMedia(true);
      const region = regionWith([boundary(0), boundary(90)]);
      const { parkOnDetection, result } = drive({
        active: true, highlightRegions: [region], isPlaying: false,
        clickedDetection: { regionId: 'r1', timestamp: 1.0 },
      });
      act(() => { result.current.scheduleGuidedAdvance('r1', 1.0); });
      act(() => { vi.advanceTimersByTime(0); });
      expect(parkOnDetection).toHaveBeenCalledTimes(2); // advanced immediately
    });
  });

  describe('showPlayerBoxes suspends the guide entirely (MAJOR 4 fix)', () => {
    it('phase is null while showPlayerBoxes is false, even with an active walk underneath', () => {
      const region = regionWith([boundary(0), boundary(90)]);
      const { result } = drive({
        active: true, showPlayerBoxes: false, highlightRegions: [region],
        isPlaying: false, clickedDetection: null,
      });
      expect(result.current.phase).toBeNull();
    });

    it('resumes exactly where the walk left off once showPlayerBoxes turns back on (state kept underneath)', () => {
      const region = regionWith([boundary(0), boundary(90)]);
      const { result, rerender } = drive({
        active: true, showPlayerBoxes: false, highlightRegions: [region],
        isPlaying: false, clickedDetection: null,
      });
      expect(result.current.phase).toBeNull();
      // Entry-park already fired underneath (showPlayerBoxes only gates OUTPUT) --
      // step is tracked even while hidden.
      expect(result.current.step).toBe(1);

      rerender({
        active: true, showPlayerBoxes: true, highlightRegions: [region],
        isPlaying: false, clickedDetection: { regionId: 'r1', timestamp: 1.0 },
      });
      expect(result.current.phase).toBe('parked');
      expect(result.current.step).toBe(1); // same marker, not restarted
    });

    it('does not entry-park a SECOND time once boxes are hidden then re-shown (sessionKey unchanged)', () => {
      const region = regionWith([boundary(0), boundary(90)]);
      const { parkOnDetection, rerender } = drive({
        active: true, showPlayerBoxes: true, highlightRegions: [region],
        isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(1);
      rerender({
        active: true, showPlayerBoxes: false, highlightRegions: [region],
        isPlaying: false, clickedDetection: null,
      });
      rerender({
        active: true, showPlayerBoxes: true, highlightRegions: [region],
        isPlaying: false, clickedDetection: null,
      });
      expect(parkOnDetection).toHaveBeenCalledTimes(1);
    });
  });
});
