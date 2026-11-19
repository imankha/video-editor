import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T4470: the Frame screen keeps two copies of the clip's cut list: the timeline's
// (useSegments, passed in as props) and the store copy the header badge, the
// Sharpen button and the credit price read (clip.segments_data via updateClipData).
// A trim must leave both copies agreeing: a failed save restores both, and a
// split made while the trim save is in flight survives in both.

const h = vi.hoisted(() => ({ actions: {} }));
vi.mock('../api/focusActions', () => {
  const names = [
    'addCropKeyframe', 'updateCropKeyframe', 'deleteCropKeyframe', 'moveCropKeyframe',
    'splitSegment', 'removeSegmentSplit', 'setSegmentSpeed', 'setTrimRange',
    'clearTrimRange', 'setRotation', 'seedClipVersion',
  ];
  const mod = {};
  names.forEach((n) => { mod[n] = (...a) => h.actions[n](...a); });
  return { ...mod, default: mod };
});
vi.mock('../components/shared', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/analytics', () => ({ track: vi.fn() }));
vi.mock('../utils/funnelEvents', () => ({ recordFunnelEvent: vi.fn(), FUNNEL_EVENTS: {} }));

import { FocusContainer } from './FocusContainer';

const CROP = { x: 10, y: 20, width: 100, height: 178 };
const KEYFRAMES = [{ frame: 0, ...CROP, origin: 'user' }, { frame: 300, ...CROP, origin: 'user' }];

// A one-clip stand-in for projectDataStore.updateClip: merges a patch, or the
// patch a function computes from the clip as it is at write time.
function makeStore(segments_data) {
  const clip = { id: 3, crop_data: KEYFRAMES, segments_data };
  const updateClipData = vi.fn((clipId, data) => {
    if (clipId !== clip.id) return;
    Object.assign(clip, typeof data === 'function' ? data(clip) : data);
  });
  return { clip, updateClipData };
}

function makeProps(store, overrides = {}) {
  return {
    videoUrl: 'blob:clip', metadata: { width: 1920, height: 1080, framerate: 30 },
    currentTime: 5, duration: 10, isPlaying: false, seek: vi.fn(),
    selectedProjectId: 7, selectedProject: { id: 7 }, editorMode: 'framing',
    keyframes: KEYFRAMES, aspectRatio: '9:16', framerate: 30, copiedCrop: CROP,
    addOrUpdateKeyframe: vi.fn(), removeKeyframe: vi.fn(), copyCropKeyframe: vi.fn(),
    pasteCropKeyframe: vi.fn(), getCropDataAtTime: vi.fn(() => CROP), interpolateCrop: vi.fn(() => CROP),
    hasKeyframeAt: vi.fn(() => false), getKeyframesForExport: vi.fn(() => []),
    deleteKeyframesInRange: vi.fn(), cleanupTrimKeyframes: vi.fn(), setCropEndFrame: vi.fn(),
    rotation: 0, setRotation: vi.fn((deg) => ({ rotation: deg })),
    segments: [
      { index: 0, start: 0, end: 4, isFirst: true, isLast: false, isTrimmed: false },
      { index: 1, start: 4, end: 10, isFirst: false, isLast: true, isTrimmed: false },
    ],
    segmentBoundaries: [0, 4, 10], segmentSpeeds: {}, trimRange: null, trimHistory: [],
    addSegmentBoundary: vi.fn(), removeSegmentBoundary: vi.fn(() => true), setSegmentSpeed: vi.fn(),
    toggleTrimSegment: vi.fn(), restoreTrim: vi.fn(), getSegmentExportData: vi.fn(() => null),
    detrimStart: vi.fn(), detrimEnd: vi.fn(), clampToVisibleRange: vi.fn((t) => t), isTimeVisible: vi.fn(() => true),
    clips: [store.clip], projectClipId: 3, projectClip: store.clip,
    updateClipData: store.updateClipData, onUserEdit: vi.fn(), setFramingChangedSinceExport: vi.fn(),
    ...overrides,
  };
}

const UNCUT = { boundaries: [0, 4, 10], segmentSpeeds: {}, trimRange: null };
const ok = () => Promise.resolve({ success: true });
const fail = () => Promise.resolve({ success: false, error: 'boom' });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  h.actions = {};
  ['splitSegment', 'removeSegmentSplit', 'setSegmentSpeed', 'setTrimRange', 'clearTrimRange']
    .forEach((n) => { h.actions[n] = vi.fn(ok); });
});

describe('T4470:C1 a failed trim save leaves both copies as before the trim', () => {
  it('trim start fails: store copy and timeline go back to the uncut list', async () => {
    const store = makeStore({ ...UNCUT });
    const props = makeProps(store);
    h.actions.setTrimRange = vi.fn(fail);
    const { result } = renderHook(() => FocusContainer(props));
    await act(async () => { await result.current.handleTrimSegment(0); });

    expect(store.clip.segments_data).toEqual(UNCUT);
    expect(props.restoreTrim).toHaveBeenCalledWith(null, []);
  });

  it('detrim start fails: store copy and timeline keep the trim', async () => {
    const trimmed = { boundaries: [0, 4, 10], segmentSpeeds: {}, trimRange: { start: 4, end: 10 } };
    const history = [{ type: 'start', time: 4, previousRange: null }];
    const store = makeStore({ ...trimmed });
    const props = makeProps(store, { trimRange: { start: 4, end: 10 }, trimHistory: history });
    h.actions.clearTrimRange = vi.fn(fail);
    const { result } = renderHook(() => FocusContainer(props));
    await act(async () => { await result.current.handleDetrimStart(); });

    expect(store.clip.segments_data).toEqual(trimmed);
    expect(props.restoreTrim).toHaveBeenCalledWith({ start: 4, end: 10 }, history);
  });
});

describe('T4470:C2 a split made while a trim save is in flight survives in both copies', () => {
  it('trim succeeds after the split: the store copy holds the split and the trim', async () => {
    const store = makeStore({ ...UNCUT });
    const props = makeProps(store);
    const trimSave = deferred();
    h.actions.setTrimRange = vi.fn(() => trimSave.promise);
    const { result } = renderHook(() => FocusContainer(props));

    let trimDone;
    await act(async () => {
      trimDone = result.current.handleTrimSegment(0);
      await result.current.handleAddSplit(6);
      trimSave.resolve({ success: true });
      await trimDone;
    });

    expect(store.clip.segments_data).toEqual({
      boundaries: [0, 4, 6, 10], segmentSpeeds: {}, trimRange: { start: 4, end: 10 },
    });
    expect(props.removeSegmentBoundary).not.toHaveBeenCalled();
    expect(props.restoreTrim).not.toHaveBeenCalled();
  });

  it('trim fails after the split: both copies keep the split and drop the trim', async () => {
    const store = makeStore({ ...UNCUT });
    const props = makeProps(store);
    const trimSave = deferred();
    h.actions.setTrimRange = vi.fn(() => trimSave.promise);
    const { result } = renderHook(() => FocusContainer(props));

    await act(async () => {
      const trimDone = result.current.handleTrimSegment(0);
      await result.current.handleAddSplit(6);
      trimSave.resolve({ success: false, error: 'boom' });
      await trimDone;
    });

    expect(store.clip.segments_data).toEqual({ boundaries: [0, 4, 6, 10], segmentSpeeds: {}, trimRange: null });
    expect(props.removeSegmentBoundary).not.toHaveBeenCalled();
    expect(props.restoreTrim).toHaveBeenCalledWith(null, []);
  });

  it('a speed change during an in-flight trim survives too', async () => {
    const store = makeStore({ ...UNCUT });
    const props = makeProps(store);
    const trimSave = deferred();
    h.actions.setTrimRange = vi.fn(() => trimSave.promise);
    const { result } = renderHook(() => FocusContainer(props));

    await act(async () => {
      const trimDone = result.current.handleTrimSegment(0);
      await result.current.handleSegmentSpeedChange(1, 0.5);
      trimSave.resolve({ success: true });
      await trimDone;
    });

    expect(store.clip.segments_data).toEqual({
      boundaries: [0, 4, 10], segmentSpeeds: { 1: 0.5 }, trimRange: { start: 4, end: 10 },
    });
  });
});
