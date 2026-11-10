import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T15550: "Keep marking plays" (the Highlight choice card's "later" button)
// must return the user to the Mark Play screen (selection state NONE), not
// leave the play SELECTED (which renders the "Edit play" / "Highlights from
// this play" panel — what staging QA saw as "it opened Edit play").
//
// Drives the REAL AnnotateContainer through renderHook (same harness as
// AnnotateContainer.createAtTap.test.jsx).

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: 42,
      annotateVideoMetadata: { duration: 120 },
    }),
  };
});

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useToastStore } from '../components/shared/Toast';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    currentTime: 10,
    duration: 120,
    isPlaying: false,
    togglePlay: vi.fn(),
    pause: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    getGame: vi.fn(),
    loadGame: vi.fn(),
    fetchProjects: vi.fn(),
    setEditorMode: vi.fn(),
    onOpenReelInFocus: vi.fn(),
    ...overrides,
  };
}

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();

describe('AnnotateContainer "Keep marking plays" (T15550)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({
      recordAchievement: vi.fn(),
      fetchProgress: vi.fn().mockResolvedValue(undefined),
    });
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useToastStore.setState({ toasts: [] });
  });

  it('T15550:C1 returns to the Mark Play screen (NONE) instead of leaving the play selected (Edit play)', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1 }) });
      }
      if (opts?.method === 'PUT') {
        const body = JSON.parse(opts.body);
        if (body.create_project) {
          return Promise.resolve({
            ok: true, status: 200,
            json: async () => ({ success: true, project_created: true, project_id: 999 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const seek = vi.fn();
    const { result } = renderHook(() => AnnotateContainer(baseProps({ seek })));

    // Mark a play — opens the editor on it (EDITING).
    act(() => {
      result.current.handleAddClipFromButton();
    });
    await act(async () => { await flushMicrotasks(); });
    const regionId = result.current.clipRegions[0].id;
    const { endTime } = result.current.clipRegions[0];

    // Rate it a Highlight (5) — the Done gesture then offers the choice card.
    act(() => {
      result.current.updateClipRegion(regionId, { rating: 5 });
    });
    await act(async () => { await flushMicrotasks(); });

    // Done on a rated-5, not-yet-highlight play opens the choice card instead
    // of closing straight to SELECTED.
    act(() => {
      result.current.handleOverlayClose();
    });
    expect(result.current.highlightChoice).toEqual({ regionId });

    // Tap "Keep marking plays" (the card's "later" outcome).
    await act(async () => {
      await result.current.handleHighlightChoiceLater();
      await flushMicrotasks();
    });

    expect(result.current.highlightChoice).toBeNull();
    // THE REGRESSION ASSERTION: fully deselected, not just closed-to-SELECTED.
    expect(result.current.annotateSelectedRegionId).toBeNull();
    expect(result.current.isEditMode).toBe(false);
    // AC: the playhead lands AFTER the marked play (deselecting alone is not
    // enough — the auto-select-at-playhead effect would otherwise immediately
    // re-select this same region, since nothing moved the playhead off it).
    // Past endTime by more than FRAME_TOLERANCE (0.15s) so an adjacent,
    // back-to-back play starting exactly at endTime isn't re-selected either.
    expect(seek).toHaveBeenCalledWith(expect.closeTo(endTime + 0.25, 5));
    const lastSeekTarget = seek.mock.calls.at(-1)[0];
    expect(lastSeekTarget).toBeGreaterThan(endTime + 0.15);
  });

  it('T15930:C1 nudges BEFORE the play when it ends at the very end of the video (no room past end)', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1 }) });
      }
      if (opts?.method === 'PUT') {
        const body = JSON.parse(opts.body);
        if (body.create_project) {
          return Promise.resolve({
            ok: true, status: 200,
            json: async () => ({ success: true, project_created: true, project_id: 999 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const seek = vi.fn();
    // The module mock above pins annotateVideoMetadata.duration to 120 for
    // every test in this file, so "no room past end" means ending AT 120
    // (a real staging example had endTime === the video's own duration
    // exactly: 89.322s / 89.322s).
    const { result } = renderHook(() => AnnotateContainer(baseProps({ seek })));

    act(() => {
      result.current.handleAddClipFromButton();
    });
    await act(async () => { await flushMicrotasks(); });
    const regionId = result.current.clipRegions[0].id;

    // Move the play to the very tail of the video (endTime === duration).
    act(() => {
      result.current.updateClipRegion(regionId, { startTime: 110, endTime: 120 });
    });
    const { startTime, endTime } = result.current.clipRegions[0];
    expect(endTime).toBe(120); // confirms this clip really does end at the video's duration

    act(() => {
      result.current.updateClipRegion(regionId, { rating: 5 });
    });
    await act(async () => { await flushMicrotasks(); });

    act(() => {
      result.current.handleOverlayClose();
    });
    expect(result.current.highlightChoice).toEqual({ regionId });

    await act(async () => {
      await result.current.handleHighlightChoiceLater();
      await flushMicrotasks();
    });

    expect(result.current.annotateSelectedRegionId).toBeNull();
    // THE REGRESSION ASSERTION: with no room past endTime (89.322s === the
    // video's own duration on staging), the pre-fix code nudged to
    // endTime + 0.25, which seek()'s Math.min(time, duration) clamps straight
    // back to endTime -- inside FRAME_TOLERANCE of the clip it just left,
    // so the auto-select effect immediately re-selected it (observed live:
    // "Keep marking plays" reopened the just-made play's Edit panel instead
    // of the Mark Play screen). The fix nudges before startTime instead.
    const lastSeekTarget = seek.mock.calls.at(-1)[0];
    expect(lastSeekTarget).toBeLessThan(startTime - 0.15);
  });
});
