import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T4400 C3: the render button no longer sends the tab's whole framing state, so
// every Frame edit must be saved by its own gesture. This walks every edit a
// parent can make in Frame and asserts each one sends its own surgical action,
// and that the container no longer offers a full-state save to lean on.

const ok = () => Promise.resolve({ success: true });
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
const KEYFRAMES = [
  { frame: 0, ...CROP, origin: 'user' },
  { frame: 90, ...CROP, origin: 'user' },
];

function makeProps(overrides = {}) {
  return {
    videoUrl: 'blob:clip',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    currentTime: 1,
    duration: 10,
    isPlaying: false,
    seek: vi.fn(),
    selectedProjectId: 7,
    selectedProject: { id: 7 },
    editorMode: 'framing',
    keyframes: KEYFRAMES,
    aspectRatio: '9:16',
    framerate: 30,
    copiedCrop: CROP,
    addOrUpdateKeyframe: vi.fn(),
    removeKeyframe: vi.fn(),
    copyCropKeyframe: vi.fn(),
    pasteCropKeyframe: vi.fn(),
    getCropDataAtTime: vi.fn(() => CROP),
    interpolateCrop: vi.fn(() => CROP),
    hasKeyframeAt: vi.fn(() => false),
    getKeyframesForExport: vi.fn(() => []),
    deleteKeyframesInRange: vi.fn(),
    cleanupTrimKeyframes: vi.fn(),
    setCropEndFrame: vi.fn(),
    rotation: 0,
    setRotation: vi.fn((deg) => ({ rotation: deg })),
    segments: [
      { index: 0, start: 0, end: 4, isFirst: true, isLast: false, isTrimmed: false },
      { index: 1, start: 4, end: 10, isFirst: false, isLast: true, isTrimmed: false },
    ],
    segmentBoundaries: [0, 4, 10],
    segmentSpeeds: {},
    trimRange: null,
    trimHistory: [],
    addSegmentBoundary: vi.fn(),
    removeSegmentBoundary: vi.fn(),
    setSegmentSpeed: vi.fn(),
    toggleTrimSegment: vi.fn(),
    getSegmentExportData: vi.fn(() => null),
    detrimStart: vi.fn(),
    clampToVisibleRange: vi.fn((t) => t),
    isTimeVisible: vi.fn(() => true),
    detrimEnd: vi.fn(),
    clips: [{ id: 3, crop_data: KEYFRAMES }],
    projectClipId: 3,
    projectClip: { id: 3, crop_data: KEYFRAMES },
    updateClipData: vi.fn(),
    onUserEdit: vi.fn(),
    setFramingChangedSinceExport: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  h.actions = {};
  [
    'addCropKeyframe', 'updateCropKeyframe', 'deleteCropKeyframe', 'moveCropKeyframe',
    'splitSegment', 'removeSegmentSplit', 'setSegmentSpeed', 'setTrimRange',
    'clearTrimRange', 'setRotation', 'seedClipVersion',
  ].forEach((n) => { h.actions[n] = vi.fn(ok); });
});

async function gesture(props, run) {
  const { result } = renderHook(() => FocusContainer(props));
  await act(async () => { await run(result.current); });
  return result.current;
}

describe('T4400 C3: every Frame edit is saved by its own gesture', () => {
  it('the container offers no full-state save for the render button to lean on', () => {
    const { result } = renderHook(() => FocusContainer(makeProps()));
    expect(result.current.saveCurrentClipState).toBeUndefined();
  });

  it('moving the crop box sends add_crop_keyframe', async () => {
    await gesture(makeProps(), (c) => c.handleCropComplete(CROP));
    expect(h.actions.addCropKeyframe).toHaveBeenCalledWith(7, 3, expect.objectContaining({ frame: 30, ...CROP }));
  });

  it('pasting a crop sends add_crop_keyframe', async () => {
    await gesture(makeProps(), (c) => c.handlePasteCrop(2));
    expect(h.actions.addCropKeyframe).toHaveBeenCalledWith(7, 3, expect.objectContaining({ frame: 60, ...CROP }));
  });

  it('deleting a focus point sends delete_crop_keyframe', async () => {
    await gesture(makeProps(), (c) => c.handleKeyframeDelete(3));
    expect(h.actions.deleteCropKeyframe).toHaveBeenCalledWith(7, 3, 90);
  });

  it('dragging a focus point in time sends move_crop_keyframe', async () => {
    await gesture(makeProps(), (c) => c.handleKeyframeTimeMove(3, 5));
    expect(h.actions.moveCropKeyframe).toHaveBeenCalledWith(7, 3, 90, 150);
  });

  it('straightening sends set_rotation', async () => {
    await gesture(makeProps(), (c) => c.handleSetRotation(2.5));
    expect(h.actions.setRotation).toHaveBeenCalledWith(7, 3, 2.5);
  });

  it('adding a split sends split_segment', async () => {
    await gesture(makeProps(), (c) => c.handleAddSplit(6));
    expect(h.actions.splitSegment).toHaveBeenCalledWith(7, 3, 6);
  });

  it('removing a split sends remove_segment_split', async () => {
    await gesture(makeProps(), (c) => c.handleRemoveSplit(4));
    expect(h.actions.removeSegmentSplit).toHaveBeenCalledWith(7, 3, 4);
  });

  it('changing a segment speed sends set_segment_speed', async () => {
    await gesture(makeProps(), (c) => c.handleSegmentSpeedChange(1, 0.5));
    expect(h.actions.setSegmentSpeed).toHaveBeenCalledWith(7, 3, 1, 0.5);
  });

  it('trimming the start sends set_trim_range', async () => {
    await gesture(makeProps(), (c) => c.handleTrimSegment(0));
    expect(h.actions.setTrimRange).toHaveBeenCalledWith(7, 3, 4, 10);
  });

  it('restoring a trimmed start sends clear_trim_range', async () => {
    await gesture(makeProps({ trimRange: { start: 4, end: 10 } }), (c) => c.handleDetrimStart());
    expect(h.actions.clearTrimRange).toHaveBeenCalledWith(7, 3);
  });

  it('restoring a trimmed end sends clear_trim_range', async () => {
    await gesture(makeProps({ trimRange: { start: 0, end: 4 } }), (c) => c.handleDetrimEnd());
    expect(h.actions.clearTrimRange).toHaveBeenCalledWith(7, 3);
  });
});
