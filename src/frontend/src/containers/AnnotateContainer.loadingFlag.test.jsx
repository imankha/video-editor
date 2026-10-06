import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * T11830: isGameDataLoading is true from the game-open gesture until /load + import
 * settle, and is cleared on EVERY failure path (no endless spinner). Drives the real
 * container and useVideo like AnnotateContainer.doneForNowReselect.test.jsx; only the
 * network is mocked.
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

const GAME_DURATION = 5400;

function gameResponse() {
  return { game: {
    id: 42,
    video_duration: GAME_DURATION,
    last_playhead_position: 0,
    annotations: [1, 2, 3, 4, 5, 6].map(n => ({
      id: 100 + n, raw_clip_id: 100 + n, start_time: n * 100, end_time: n * 100 + 10, rating: 5,
    })),
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

describe('AnnotateContainer isGameDataLoading (T11830)', () => {
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useVideoStore.getState().reset();
    vi.restoreAllMocks();
  });

  function mount({ loadGame, getGame = vi.fn() }) {
    const video = makeFakeVideo();
    return renderHook(() => {
      const v = useVideo(null, null);
      v.videoRef.current = video;
      return AnnotateContainer({
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
        getGame,
        loadGame,
        fetchProjects: vi.fn(),
        setEditorMode: vi.fn(),
        onOpenReelInFocus: vi.fn(),
      });
    });
  }

  it('is true with a zero count while /load is pending, then false with the real count', async () => {
    let resolveLoad;
    const loadGame = vi.fn(() => new Promise((r) => { resolveLoad = r; }));
    const { result, unmount } = mount({ loadGame });
    expect(result.current.isGameDataLoading).toBe(false);

    let done;
    await act(async () => {
      done = result.current.handleLoadGame(42);
      await flushMicrotasks();
    });
    expect(result.current.isGameDataLoading).toBe(true);
    expect(result.current.annotateClipCount).toBe(0);

    await act(async () => {
      resolveLoad(gameResponse());
      await done;
      await flushMicrotasks();
    });
    expect(result.current.isGameDataLoading).toBe(false);
    expect(result.current.annotateClipCount).toBe(6);
    unmount();
  });

  it.each([
    ['a failed /load whose fallback also fails', new Error('500 server error'), new Error('500 server error')],
    ['game not found', new Error('Game not found'), null],
    ['a 401', new Error('401 unauthorized'), null],
  ])('clears the flag after %s', async (_label, loadErr, getGameErr) => {
    const loadGame = vi.fn().mockRejectedValue(loadErr);
    const getGame = vi.fn().mockRejectedValue(getGameErr || loadErr);
    const { result, unmount } = mount({ loadGame, getGame });

    await act(async () => {
      await result.current.handleLoadGame(42);
      await flushMicrotasks();
    });
    expect(result.current.isGameDataLoading).toBe(false);
    unmount();
  });
});
