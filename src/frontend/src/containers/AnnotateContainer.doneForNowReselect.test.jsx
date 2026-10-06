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

/**
 * T11800: "Done for now" on Focus/Overlay must land on Annotate with the play
 * SELECTED. The breadcrumb (setPendingGame(gameId, null, sourceClipId)) arrives
 * intact; what defeats it is stale GLOBAL state. Focus loads the game clip with a
 * clip range (FocusScreen.jsx clipOffset = start_time, clipDuration = end - start)
 * into the global videoStore, and handleAddSpotlightLater switches mode without
 * videoStore.reset() (every other route into Annotate resets it). On Annotate the
 * real useVideo then reports duration = the PLAY length, which passes the
 * selection effect's `videoDuration > 0` gate before the game's metadata loads;
 * selectClip fires, but `seek` clamps the playhead to the stale play length, and
 * the playhead-driven auto-deselect wipes the selection.
 *
 * Unlike AnnotateContainer.pendingSelection.test.jsx (constant duration/currentTime
 * + a fake seek, i.e. exactly the path that cannot show this), this drives the REAL
 * useVideo and the REAL videoStore; only the network is mocked.
 */

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: 42,
      annotateVideoMetadata: { duration: 5400 },
    }),
  };
});

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useVideo } from '../hooks/useVideo';
import { useVideoStore } from '../stores';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { __resetBeginLoadDedup } from './annotateVideoLoad';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

const RAW_CLIP_ID = 99;
const PLAY_START = 181.3;
const PLAY_END = 191.3;
const GAME_DURATION = 5400;

function gameResponse() {
  return { game: {
    id: 42,
    video_duration: GAME_DURATION,
    last_playhead_position: PLAY_START,
    annotations: [
      { id: RAW_CLIP_ID, raw_clip_id: RAW_CLIP_ID, start_time: PLAY_START, end_time: PLAY_END, rating: 5 },
    ],
  } };
}

function makeFakeVideo() {
  // A real (jsdom) <video> so DOM helpers like .closest work; media props are
  // shadowed because jsdom implements no media pipeline.
  const el = document.createElement('video');
  document.body.appendChild(el);
  const props = { src: 'blob:annotate-game', duration: NaN, currentTime: 0, readyState: 0 };
  for (const k of Object.keys(props)) {
    Object.defineProperty(el, k, { configurable: true, writable: true, value: props[k] });
  }
  Object.defineProperty(el, 'videoWidth', { configurable: true, value: 1920 });
  Object.defineProperty(el, 'videoHeight', { configurable: true, value: 1080 });
  Object.defineProperty(el, 'paused', { configurable: true, value: true });
  el.pause = vi.fn();
  el.play = vi.fn(() => Promise.resolve());
  return el;
}

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();

describe('AnnotateContainer re-selects the play after Done for now (T11800)', () => {
  beforeEach(() => {
    __resetBeginLoadDedup();
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
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useVideoStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('keeps the play selected when Focus left its clip range in the global videoStore', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const deselectSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // What Focus leaves behind (FocusScreen.jsx loadVideo with a clip range).
    useVideoStore.setState({
      clipOffset: PLAY_START, clipDuration: PLAY_END - PLAY_START,
      duration: PLAY_END - PLAY_START, currentTime: 3,
    });

    const video = makeFakeVideo();
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    const { result } = renderHook(() => {
      const v = useVideo(null, null);
      v.videoRef.current = video;
      return {
        v,
        c: AnnotateContainer({
          videoRef: v.videoRef,
          currentTime: v.currentTime,
          duration: v.duration,
          isPlaying: v.isPlaying,
          togglePlay: v.togglePlay,
          pause: v.pause,
          stepForward: v.stepForward,
          stepBackward: v.stepBackward,
          seekBackward: v.seekBackward,
          restart: v.restart,
          seek: v.seek,
          getGame: vi.fn(),
          loadGame,
          fetchProjects: vi.fn(),
          setEditorMode: vi.fn(),
          onOpenReelInFocus: vi.fn(),
        }),
      };
    });

    // Same arguments AnnotateScreen gets from the Done-for-now breadcrumb.
    await act(async () => {
      await result.current.c.handleLoadGame(42, null, RAW_CLIP_ID);
      await flushMicrotasks();
    });
    // The browser then loads the GAME video's metadata (full-game duration).
    await act(async () => {
      video.duration = GAME_DURATION;
      video.readyState = 4;
      result.current.v.handlers.onLoadedMetadata();
      await flushMicrotasks();
    });
    await act(async () => {
      result.current.v.handlers.onSeeked?.();
      result.current.v.handlers.onTimeUpdate();
      await flushMicrotasks();
    });

    const region = result.current.c.clipRegions.find(r => r.rawClipId === RAW_CLIP_ID);
    expect(region).toBeTruthy();
    expect(result.current.c.annotateSelectedRegionId).toBe(region.id);
    const t = useVideoStore.getState().currentTime;
    expect(t).toBeGreaterThanOrEqual(PLAY_START - 0.15);
    expect(t).toBeLessThanOrEqual(PLAY_END + 0.15);
    expect(deselectSpy).not.toHaveBeenCalledWith(expect.stringMatching(/matched no region/i), expect.anything());
  });
});
