import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Bug: switching the edited play while the video is running (clicking a
 * different play's region/card while the EDITING overlay is already open)
 * left the video playing instead of pausing, unlike the "Edit Play" CTA
 * (handleAddClipFromButton) which already pauses first.
 *
 * Drives the REAL AnnotateContainer through renderHook (same harness as
 * AnnotateContainer.nearestCenterSelection.test.jsx).
 */

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: 42,
      annotateVideoUrl: 'blob:test-video',
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

const PLAY_A_ID = 601;
const PLAY_B_ID = 602;

function gameResponse() {
  return { game: {
    id: 42,
    video_duration: 300,
    annotations: [
      { id: PLAY_A_ID, raw_clip_id: PLAY_A_ID, start_time: 10, end_time: 15, rating: 3 },
      { id: PLAY_B_ID, raw_clip_id: PLAY_B_ID, start_time: 100, end_time: 105, rating: 3 },
    ],
  } };
}

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    currentTime: 0,
    duration: 300,
    isPlaying: true,
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

describe('AnnotateContainer pauses when switching the edited play mid-playback', () => {
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
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useToastStore.setState({ toasts: [] });
  });

  it('calls pause when selecting a different play while already editing one', async () => {
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    const pause = vi.fn();
    const { result, rerender } = renderHook(
      (props) => AnnotateContainer(baseProps(props)),
      { initialProps: { loadGame, pause, currentTime: 200 } }
    );

    await act(async () => {
      await result.current.handleLoadGame(42, null, null);
      await flushMicrotasks();
    });
    expect(result.current.clipRegions.length).toBe(2);
    const findByRawId = (rawId) => result.current.clipRegions.find((r) => r.rawClipId === rawId);

    // Playhead must sit inside play A's range (10-15) when selecting it, or the
    // auto-deselect effect reverts the selection before the next act() runs.
    act(() => { rerender({ loadGame, pause, currentTime: 12 }); });
    act(() => { result.current.handleSelectRegion(findByRawId(PLAY_A_ID).id); });
    act(() => { result.current.handleAddClipFromButton(); });
    await flushMicrotasks();
    expect(result.current.showAnnotateOverlay).toBe(true);
    expect(result.current.annotateSelectedRegionId).toBe(findByRawId(PLAY_A_ID).id);

    pause.mockClear(); // isolate the assertion to the subsequent switch

    // Switch to editing play B while "playing" -- must pause.
    const playBId = findByRawId(PLAY_B_ID).id;
    act(() => { result.current.handleSelectRegion(playBId); });
    await flushMicrotasks();

    expect(result.current.showAnnotateOverlay).toBe(true);
    expect(result.current.annotateSelectedRegionId).toBe(findByRawId(PLAY_B_ID).id);
    expect(pause).toHaveBeenCalled();
  });
});
