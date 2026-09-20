import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * T10750: the navigation breadcrumb ("open Annotate on this reel's source clip")
 * must be consumed EXACTLY ONCE.
 *
 * The bug: AnnotateScreen ran a retry effect that re-issued select+seek until the
 * selection "stuck". It could never observe its own success — selectClip runs in
 * a passive effect (DefaultLane) while the accompanying seek writes zustand
 * through a selector-less subscription (SyncLane); React renders SyncLane first
 * and skips updates whose lane isn't in renderLanes, so the selection was
 * DEFERRED, the effect read NONE, and it re-fired until a 40-attempt cap. Live
 * capture: ~32 identical select+seek pairs per Annotate entry.
 *
 * The regression that matters is therefore a CALL COUNT, not correctness — which
 * is exactly what a live run can show but CI cannot. Hence these assertions.
 *
 * Drives the REAL AnnotateContainer through renderHook (same harness as
 * AnnotateContainer.createAtTap.test.jsx).
 */

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: 42,
      annotateVideoMetadata: { duration: 300 },
    }),
  };
});

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useToastStore } from '../components/shared/Toast';
import { __resetBeginLoadDedup } from './annotateVideoLoad';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

const SOURCE_RAW_CLIP_ID = 777;
const CLIP_START = 74.36;

function gameResponse() {
  return { game: {
    id: 42,
    video_duration: 300,
    annotations: [
      {
        id: SOURCE_RAW_CLIP_ID,
        raw_clip_id: SOURCE_RAW_CLIP_ID,
        start_time: CLIP_START,
        end_time: 79.84,
        rating: 5,
      },
    ],
  } };
}

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    currentTime: 0,
    duration: 300,
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

describe('AnnotateContainer pending clip selection (T10750)', () => {
  beforeEach(() => {
    __resetBeginLoadDedup(); // the loader dedups in-flight loads by gameId across tests
    apiFetch.mockReset();
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({
      recordAchievement: vi.fn(),
      fetchProgress: vi.fn().mockResolvedValue(undefined),
    });
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useToastStore.setState({ toasts: [] });
  });

  it('selects the breadcrumb clip ONCE and never re-issues it across re-renders', async () => {
    const seek = vi.fn();
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    // The real `seek` writes setCurrentTime(validTime) SYNCHRONOUSLY before it
    // touches the element (useVideo.js), so selection and playhead land in one
    // consistent commit and the playhead-driven auto-deselect's range test
    // passes. A vi.fn() seek moves nothing, so model that settled state by
    // starting the playhead inside the clip -- otherwise auto-deselect wipes the
    // selection for a reason that has nothing to do with what this test pins.
    // CRITICAL for this test to mean anything: the real screen re-creates `seek`
    // every render (it is a plain unmemoized fn in useVideo), so the effect's
    // dep list churns constantly and it RE-RUNS on every render. A stable props
    // object would never re-run it, and the "fires once" assertion below would
    // pass even against a retry that never disarms. Hand it a fresh identity
    // each render, forwarding to the same spy.
    const { result, rerender } = renderHook(() => AnnotateContainer(
      baseProps({ seek: (...a) => seek(...a), loadGame, currentTime: CLIP_START })
    ));

    await act(async () => {
      await result.current.handleLoadGame(42, null, SOURCE_RAW_CLIP_ID);
      await flushMicrotasks();
    });

    expect(result.current.clipRegions.length).toBe(1);
    const match = result.current.clipRegions[0];
    expect(match.rawClipId).toBe(SOURCE_RAW_CLIP_ID);

    // The breadcrumb landed: the clip is selected and the playhead was sent to it.
    expect(result.current.annotateSelectedRegionId).toBe(match.id);
    const seekCallsAfterLand = seek.mock.calls.length;
    expect(seekCallsAfterLand).toBeGreaterThan(0);
    expect(seek).toHaveBeenCalledWith(expect.closeTo(CLIP_START, 2));

    // THE REGRESSION ASSERTION: re-render repeatedly (the real screen re-renders
    // constantly — the seek fn identity churns every render). The one-shot must
    // not fire again. Pre-fix this climbed until the 40-attempt cap.
    for (let i = 0; i < 10; i++) {
      await act(async () => { rerender(); await flushMicrotasks(); });
    }

    expect(seek.mock.calls.length).toBe(seekCallsAfterLand);
    expect(result.current.annotateSelectedRegionId).toBe(match.id);
  });

  it('drops a breadcrumb that matches no region, loudly, instead of retrying forever', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seek = vi.fn();
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    const { result, rerender } = renderHook(() => AnnotateContainer(
      baseProps({ seek: (...a) => seek(...a), loadGame, currentTime: CLIP_START })
    ));

    await act(async () => {
      await result.current.handleLoadGame(42, null, 999999); // no such raw clip
      await flushMicrotasks();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/matched no region/i),
      expect.objectContaining({ sourceClipId: 999999 })
    );

    const callsAfter = seek.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      await act(async () => { rerender(); await flushMicrotasks(); });
    }
    // Dropped, not retried.
    expect(seek.mock.calls.length).toBe(callsAfter);
    warnSpy.mockRestore();
  });
});
