import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T14370: Mark play silently did nothing (prod, Android, shared game).
//
// Reproduced on staging: the Mark play card is live while /load is still in
// flight (5-6s on a phone). A tap in that window either found no duration
// (region never created, one console.warn, nothing on screen) or, when the
// video element had already loaded its metadata, created a play with no game
// id and then crashed the editor when /load's applyGameData reset the regions
// under the open editor (EDITING is immune to deselect, so `existingClip`
// became null).
//
// Both are fixed at the source: Mark play refuses LOUDLY while the game is
// loading, and opening a game resets the selection state machine together
// with the regions.

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useUploadStore } from '../stores/uploadStore';
import { useToastStore } from '../components/shared/Toast';
import { ANNOTATE } from '../config/displayNames';

const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// The shape /load returns for a single-video game with no plays.
function loadResult(id, duration = 86) {
  return {
    game: {
      id,
      name: `game ${id}`,
      video_duration: duration,
      video_width: 1920,
      video_height: 1080,
      video_size: 1,
      storage_status: 'active',
      annotations: [],
      videos: [{ sequence: 1, duration, video_width: 1920, video_height: 1080 }],
    },
    playback_url: null,
    teammate_shares: [],
    teammate_tags: [],
  };
}

// A video element that has ALREADY loaded its metadata (the T4000 early src
// lets the byte fetch overlap /load, so this is the common phone ordering).
function loadedVideoElement(duration = 86) {
  return {
    readyState: 1,
    duration,
    videoWidth: 1920,
    videoHeight: 1080,
    currentTime: 0,
    paused: true,
    playbackRate: 1,
    play: vi.fn(),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    closest: () => null,
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
  };
}

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    currentTime: 10,
    duration: 0,
    isPlaying: false,
    togglePlay: vi.fn(),
    pause: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    getGame: vi.fn().mockResolvedValue({ annotations: [] }),
    loadGame: vi.fn(),
    fetchProjects: vi.fn(),
    setEditorMode: vi.fn(),
    onOpenReelInFocus: vi.fn(),
    ...overrides,
  };
}

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();
const uploadOriginal = useUploadStore.getState();

const saveCalls = () => apiFetch.mock.calls.filter(([url]) => String(url).includes('/clips/raw/save'));
const markPlayErrors = (spy) => spy.mock.calls.filter(([m]) => String(m).startsWith('[MarkPlay]'));

describe('T14370 - Mark play while the game is still loading', () => {
  let errSpy;
  let warnSpy;

  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url) => {
      if (String(url).includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 555 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({
      recordAchievement: vi.fn(),
      fetchProgress: vi.fn().mockResolvedValue(undefined),
    });
    useUploadStore.setState({ uploads: [] });
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
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useUploadStore.setState(uploadOriginal, true);
    useToastStore.setState({ toasts: [] });
  });

  it('refuses loudly while /load is in flight, then works once the game has loaded', async () => {
    const load = deferred();
    const { result } = renderHook(() => AnnotateContainer(baseProps({ loadGame: vi.fn(() => load.promise) })));

    await act(async () => { result.current.handleLoadGame(601); await flush(); });
    expect(result.current.isGameDataLoading).toBe(true);

    await act(async () => { result.current.handleAddClipFromButton(); await flush(); });

    // Nothing created, nothing sent, and the refusal is NOT silent.
    expect(result.current.clipRegions.length).toBe(0);
    expect(saveCalls().length).toBe(0);
    expect(markPlayErrors(errSpy).length).toBe(1);
    expect(useToastStore.getState().toasts.some((t) => t.title === ANNOTATE.MARK_PLAY_LOADING_TITLE)).toBe(true);

    await act(async () => { load.resolve(loadResult(601)); await flush(); });
    expect(result.current.isGameDataLoading).toBe(false);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await act(async () => { result.current.handleAddClipFromButton(); await flush(); });
    expect(result.current.clipRegions.length).toBe(1);
    expect(saveCalls().length).toBe(1);
    expect(JSON.parse(saveCalls()[0][1].body).game_id).toBe(601);
    // The chain's context line must be console.info, not console.log: the
    // production build drops console.log (vite esbuild.pure), so a report filed
    // from prod carried the [MarkPlay] line with no [CreateClip] context
    // (observed on staging, 2026-11-02).
    expect(infoSpy.mock.calls.some(([m]) => String(m).startsWith('[CreateClip] Stored region:'))).toBe(true);
    infoSpy.mockRestore();
  });

  it('refuses even when the video element already has a duration (metadata before /load)', async () => {
    const load = deferred();
    const videoRef = { current: loadedVideoElement() };
    const { result } = renderHook(() => AnnotateContainer(baseProps({ videoRef, loadGame: vi.fn(() => load.promise) })));

    await act(async () => { result.current.handleLoadGame(602); await flush(); });
    expect(result.current.isGameDataLoading).toBe(true);

    await act(async () => { result.current.handleAddClipFromButton(); await flush(); });

    // Pre-fix: a region with NO game id was created here, the editor opened on
    // it, and /load's reset then crashed the editor. Now: no region at all.
    expect(result.current.clipRegions.length).toBe(0);
    expect(result.current.showAnnotateOverlay).toBe(false);
    expect(saveCalls().length).toBe(0);
    expect(markPlayErrors(errSpy).length).toBe(1);
    expect(useToastStore.getState().toasts.some((t) => t.title === ANNOTATE.MARK_PLAY_LOADING_TITLE)).toBe(true);

    await act(async () => { load.resolve(loadResult(602)); await flush(); });
    expect(result.current.showAnnotateOverlay).toBe(false);
  });

  it('opening another game while the editor is open closes it with the regions (no null existingClip)', async () => {
    const loadGame = vi.fn((id) => Promise.resolve(loadResult(id)));
    const { result } = renderHook(() => AnnotateContainer(baseProps({ loadGame })));

    await act(async () => { await result.current.handleLoadGame(701); await flush(); });
    await act(async () => { result.current.handleAddClipFromButton(); await flush(); });
    expect(result.current.clipRegions.length).toBe(1);
    expect(result.current.showAnnotateOverlay).toBe(true);

    await act(async () => { await result.current.handleLoadGame(702); await flush(); });

    expect(result.current.clipRegions.length).toBe(0);
    // EDITING used to survive the regions reset (deselect is a no-op while
    // EDITING), leaving the editor open on a region that no longer existed.
    expect(result.current.showAnnotateOverlay).toBe(false);
    expect(result.current.annotateSelectedRegionId).toBe(null);
  });

  it('a Mark play that creates no region logs [MarkPlay] with context and toasts', async () => {
    // No load at all: no game, no duration. Pre-fix this exit was a bare
    // console.warn with nothing on screen.
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    useUploadStore.setState({ uploads: [{ id: 'u1', status: 'uploading', gameId: 4, uploads: [] }] });

    await act(async () => { result.current.handleAddClipFromButton(); await flush(); });

    expect(result.current.clipRegions.length).toBe(0);
    const errs = markPlayErrors(errSpy);
    expect(errs.length).toBe(1);
    const ctx = errs[0][1];
    expect(ctx).toMatchObject({ step: 'addClipRegion', gameId: 4 });
    expect(typeof ctx.userAgent).toBe('string');
    expect(useToastStore.getState().toasts.some((t) => t.title === ANNOTATE.MARK_PLAY_FAILED_TITLE)).toBe(true);
  });
});
