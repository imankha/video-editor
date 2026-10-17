import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Opening a game must not show the guide on a TRANSIENT selection. Observed live:
 * importAnnotations selected the first play, the playhead-driven auto-deselect then
 * dropped it (the placeholder playhead is 0 until the video loads), and only after
 * loadedmetadata + the resume seek did the play under the saved playhead get
 * selected. The guide, held only until game data loaded, flashed "You've marked N
 * plays" for the whole video load.
 *
 * The guide is held while `isGameDataLoading || isInitialPositionPending`
 * (AnnotateScreen holdGuide). Every render where that is false must already carry
 * the FINAL starting selection. Drives the REAL useVideo + videoStore (harness from
 * AnnotateContainer.doneForNowReselect.test.jsx); only the network is mocked.
 */

// The game-row metadata the container sees; null models a /load without a duration.
const meta = { value: { duration: 5400 } };

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: 42,
      annotateVideoMetadata: meta.value,
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

const GAME_DURATION = 5400;
const RESUME = 2157.4;
const PLAY_A = { id: 1, raw_clip_id: 1, start_time: 10, end_time: 20, rating: 3 };
const PLAY_B = { id: 2, raw_clip_id: 2, start_time: 2150, end_time: 2165, rating: 3 };

function gameResponse(overrides = {}) {
  return { game: {
    id: 42,
    video_duration: GAME_DURATION,
    last_playhead_position: RESUME,
    annotations: [{ ...PLAY_A }, { ...PLAY_B }],
    ...overrides,
  } };
}

function makeFakeVideo() {
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

function renderContainer(loadGame, { video, duration } = {}) {
  const renders = [];
  let recording = false;
  const hook = renderHook(() => {
    const v = useVideo(null, null);
    v.videoRef.current = video;
    const c = AnnotateContainer({
      videoRef: v.videoRef,
      currentTime: v.currentTime,
      duration: duration ?? v.duration,
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
    });
    if (recording) {
      renders.push({ held: c.isGameDataLoading || c.isInitialPositionPending === true, sel: c.annotateSelectedRegionId });
    }
    return { v, c };
  });
  return { ...hook, renders, startRecording: () => { recording = true; } };
}

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();

describe('AnnotateContainer initial position on game open', () => {
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
    meta.value = { duration: GAME_DURATION };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useVideoStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('lifts the hold only once the play under the saved playhead is selected', async () => {
    const video = makeFakeVideo();
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    const { result, renders, startRecording, unmount } = renderContainer(loadGame, { video });

    startRecording();
    await act(async () => {
      await result.current.c.handleLoadGame(42);
      await flushMicrotasks();
    });
    await act(async () => {
      video.duration = GAME_DURATION;
      video.readyState = 1;
      result.current.v.handlers.onLoadedMetadata();
      video.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks();
    });
    await act(async () => {
      result.current.v.handlers.onSeeked?.();
      result.current.v.handlers.onTimeUpdate();
      await flushMicrotasks();
    });

    const playB = result.current.c.clipRegions.find(r => r.rawClipId === PLAY_B.id);
    expect(playB).toBeTruthy();
    expect(result.current.c.annotateSelectedRegionId).toBe(playB.id);
    const unheldSelections = renders.filter(r => !r.held).map(r => r.sel);
    expect(unheldSelections.length).toBeGreaterThan(0);
    for (const sel of unheldSelections) expect(sel).toBe(playB.id);
    unmount();
  });

  it('does not hold when there is no saved playhead to resume', async () => {
    const video = makeFakeVideo();
    const loadGame = vi.fn().mockResolvedValue(gameResponse({ last_playhead_position: null, viewed_duration: 0 }));
    const { result, unmount } = renderContainer(loadGame, { video, duration: 0 });
    await act(async () => {
      await result.current.c.handleLoadGame(42);
      await flushMicrotasks();
    });
    expect(result.current.c.isInitialPositionPending).toBe(false);
    expect(result.current.c.annotateSelectedRegionId).toBe(null);
    unmount();
  });

  it('does not hold an expired game (its video never loads)', async () => {
    const video = makeFakeVideo();
    const loadGame = vi.fn().mockResolvedValue(gameResponse({ storage_status: 'expired' }));
    const { result, unmount } = renderContainer(loadGame, { video });
    await act(async () => {
      await result.current.c.handleLoadGame(42);
      await flushMicrotasks();
    });
    expect(result.current.c.isInitialPositionPending).toBe(false);
    unmount();
  });

  it('keeps a breadcrumb until plays queued for a missing duration have imported', async () => {
    // /load without video_duration: importAnnotations queues the plays until the
    // video reports its duration, so they arrive AFTER the store duration is known.
    meta.value = null;
    const video = makeFakeVideo();
    const loadGame = vi.fn().mockResolvedValue(gameResponse({ video_duration: null, last_playhead_position: null }));
    const { result, unmount } = renderContainer(loadGame, { video });
    await act(async () => {
      // Seek-time breadcrumb: queued plays carry no rawClipId, so match by position.
      await result.current.c.handleLoadGame(42, PLAY_B.start_time);
      await flushMicrotasks();
    });
    expect(result.current.c.clipRegions.length).toBe(0);
    await act(async () => {
      meta.value = { duration: GAME_DURATION };
      video.duration = GAME_DURATION;
      video.readyState = 1;
      result.current.v.handlers.onLoadedMetadata();
      await flushMicrotasks();
    });
    const playB = result.current.c.clipRegions.find(r => r.startTime === PLAY_B.start_time);
    expect(playB).toBeTruthy();
    expect(result.current.c.annotateSelectedRegionId).toBe(playB.id);
    expect(result.current.c.isInitialPositionPending).toBe(false);
    unmount();
  });
});
