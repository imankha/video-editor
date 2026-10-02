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
    (p) => useGuidedAthletePick({ parkOnDetection, ...p }),
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
});
