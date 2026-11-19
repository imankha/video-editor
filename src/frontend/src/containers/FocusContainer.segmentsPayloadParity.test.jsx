import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T4470:C4 payload parity: moving the store mirror into one helper must not
// change a single request. Every segment gesture's exact focusActions calls
// (success and failure paths) are pinned here; this passes on the code before
// T4470 and after it.

const h = vi.hoisted(() => ({ actions: {} }));
const NAMES = ['splitSegment', 'removeSegmentSplit', 'setSegmentSpeed', 'setTrimRange', 'clearTrimRange'];
vi.mock('../api/focusActions', () => {
  const all = [...['splitSegment', 'removeSegmentSplit', 'setSegmentSpeed', 'setTrimRange', 'clearTrimRange'],
    'addCropKeyframe', 'updateCropKeyframe', 'deleteCropKeyframe', 'moveCropKeyframe', 'setRotation', 'seedClipVersion'];
  const mod = {};
  all.forEach((n) => { mod[n] = (...a) => h.actions[n](...a); });
  return { ...mod, default: mod };
});
vi.mock('../components/shared', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/analytics', () => ({ track: vi.fn() }));
vi.mock('../utils/funnelEvents', () => ({ recordFunnelEvent: vi.fn(), FUNNEL_EVENTS: {} }));

import { FocusContainer } from './FocusContainer';

const CROP = { x: 10, y: 20, width: 100, height: 178 };
const clip = { id: 3, crop_data: [], segments_data: { boundaries: [0, 4, 10], segmentSpeeds: {}, trimRange: null } };

function makeProps(overrides = {}) {
  return {
    videoUrl: 'blob:clip', metadata: { width: 1920, height: 1080, framerate: 30 },
    currentTime: 5, duration: 10, isPlaying: false, seek: vi.fn(),
    selectedProjectId: 7, selectedProject: { id: 7 }, editorMode: 'framing',
    keyframes: [], aspectRatio: '9:16', framerate: 30, copiedCrop: CROP,
    addOrUpdateKeyframe: vi.fn(), removeKeyframe: vi.fn(), copyCropKeyframe: vi.fn(),
    pasteCropKeyframe: vi.fn(), getCropDataAtTime: vi.fn(() => CROP), interpolateCrop: vi.fn(() => CROP),
    hasKeyframeAt: vi.fn(() => false), getKeyframesForExport: vi.fn(() => []),
    deleteKeyframesInRange: vi.fn(), cleanupTrimKeyframes: vi.fn(), setCropEndFrame: vi.fn(),
    rotation: 0, setRotation: vi.fn(),
    segments: [
      { index: 0, start: 0, end: 4, isFirst: true, isLast: false, isTrimmed: false },
      { index: 1, start: 4, end: 10, isFirst: false, isLast: true, isTrimmed: false },
    ],
    segmentBoundaries: [0, 4, 10], segmentSpeeds: { 0: 2 }, trimRange: null, trimHistory: [],
    addSegmentBoundary: vi.fn(), removeSegmentBoundary: vi.fn(() => true), setSegmentSpeed: vi.fn(),
    toggleTrimSegment: vi.fn(), restoreTrim: vi.fn(), getSegmentExportData: vi.fn(() => null),
    detrimStart: vi.fn(), detrimEnd: vi.fn(), clampToVisibleRange: vi.fn((t) => t), isTimeVisible: vi.fn(() => true),
    clips: [clip], projectClipId: 3, projectClip: clip,
    updateClipData: vi.fn(), onUserEdit: vi.fn(), setFramingChangedSinceExport: vi.fn(),
    ...overrides,
  };
}

function calls() {
  const out = {};
  NAMES.forEach((n) => { if (h.actions[n].mock.calls.length) out[n] = h.actions[n].mock.calls; });
  return out;
}

async function run(props, gesture, outcome) {
  NAMES.forEach((n) => { h.actions[n] = vi.fn(() => Promise.resolve(outcome)); });
  const { result } = renderHook(() => FocusContainer(props));
  await act(async () => { await gesture(result.current); });
  return calls();
}

const OUTCOMES = { ok: { success: true }, fail: { success: false, error: 'boom' } };
const TRIM_START = { trimRange: { start: 4, end: 10 }, trimHistory: [{ type: 'start', time: 4, previousRange: null }] };
const TRIM_BOTH = {
  trimRange: { start: 2, end: 8 },
  trimHistory: [
    { type: 'start', time: 1, previousRange: null },
    { type: 'start', time: 2, previousRange: { start: 1, end: 10 } },
    { type: 'end', time: 8, previousRange: { start: 2, end: 10 } },
  ],
};

beforeEach(() => { h.actions = {}; });

describe('T4470:C4 segment gesture requests are unchanged', () => {
  for (const [label, outcome] of Object.entries(OUTCOMES)) {
    it(`split (${label})`, async () => {
      expect(await run(makeProps(), (c) => c.handleAddSplit(6), outcome)).toEqual({ splitSegment: [[7, 3, 6]] });
    });
    it(`unsplit (${label})`, async () => {
      expect(await run(makeProps(), (c) => c.handleRemoveSplit(4), outcome)).toEqual({ removeSegmentSplit: [[7, 3, 4]] });
    });
    it(`speed (${label})`, async () => {
      expect(await run(makeProps(), (c) => c.handleSegmentSpeedChange(1, 0.5), outcome)).toEqual({ setSegmentSpeed: [[7, 3, 1, 0.5]] });
    });
    it(`trim start (${label})`, async () => {
      expect(await run(makeProps(), (c) => c.handleTrimSegment(0), outcome)).toEqual({ setTrimRange: [[7, 3, 4, 10]] });
    });
    it(`trim end (${label})`, async () => {
      expect(await run(makeProps(), (c) => c.handleTrimSegment(1), outcome)).toEqual({ setTrimRange: [[7, 3, 0, 4]] });
    });
    it(`untrim via toggle (${label})`, async () => {
      const props = makeProps({
        ...TRIM_START,
        segments: [
          { index: 0, start: 0, end: 4, isFirst: false, isLast: false, isTrimmed: true },
          { index: 1, start: 4, end: 10, isFirst: true, isLast: true, isTrimmed: false },
        ],
      });
      expect(await run(props, (c) => c.handleTrimSegment(0), outcome)).toEqual({ setTrimRange: [[7, 3, 4, 10]] });
    });
    it(`detrim start to nothing (${label})`, async () => {
      expect(await run(makeProps(TRIM_START), (c) => c.handleDetrimStart(), outcome)).toEqual({ clearTrimRange: [[7, 3]] });
    });
    it(`detrim start one level (${label})`, async () => {
      expect(await run(makeProps(TRIM_BOTH), (c) => c.handleDetrimStart(), outcome)).toEqual({ setTrimRange: [[7, 3, 1, 8]] });
    });
    it(`detrim end one level (${label})`, async () => {
      expect(await run(makeProps(TRIM_BOTH), (c) => c.handleDetrimEnd(), outcome)).toEqual({ setTrimRange: [[7, 3, 2, 10]] });
    });
  }
});
