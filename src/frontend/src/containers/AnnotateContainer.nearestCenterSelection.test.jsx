import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * T10890: the playhead-driven auto-select effect must select whichever
 * overlapping play's CENTER is closest to the playhead, not just the first
 * one in clipRegions array order (the previous `Array.find` behavior).
 *
 * Drives the REAL AnnotateContainer through renderHook (same harness as
 * AnnotateContainer.pendingSelection.test.jsx / createAtTap.test.jsx).
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

// Two overlapping plays: WIDE fully contains TIGHT. A playhead inside both
// must pick whichever center it's actually closer to.
const WIDE_ID = 501; // start 40, end 60 -> center 50
const TIGHT_ID = 502; // start 45, end 47 -> center 46

function gameResponse() {
  return { game: {
    id: 42,
    video_duration: 300,
    annotations: [
      { id: WIDE_ID, raw_clip_id: WIDE_ID, start_time: 40, end_time: 60, rating: 3 },
      { id: TIGHT_ID, raw_clip_id: TIGHT_ID, start_time: 45, end_time: 47, rating: 4 },
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

describe('AnnotateContainer nearest-center playhead selection (T10890)', () => {
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

  it('selects the TIGHT play whose center (46) is closer to a playhead at 46.5, not the WIDE play that sorts first', async () => {
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    // Load with the playhead OUTSIDE both regions (200s) so import doesn't
    // race the auto-select effect into locking onto whichever region lands
    // first mid-import. Once both regions exist and nothing is selected, THEN
    // move the playhead onto the overlap (46.5) -- this is the actual gesture
    // the task describes: seeking/clicking the timeline onto overlapping plays.
    const { result, rerender } = renderHook(
      (props) => AnnotateContainer(baseProps(props)),
      { initialProps: { loadGame, currentTime: 200 } }
    );

    await act(async () => {
      await result.current.handleLoadGame(42, null, null);
      await flushMicrotasks();
    });
    expect(result.current.clipRegions.length).toBe(2);
    expect(result.current.annotateSelectedRegionId).toBeNull();

    // Simulate the seek/click landing at 46.5, inside both WIDE and TIGHT.
    await act(async () => { rerender({ loadGame, currentTime: 46.5 }); await flushMicrotasks(); });

    const tight = result.current.clipRegions.find((r) => r.rawClipId === TIGHT_ID);
    expect(result.current.annotateSelectedRegionId).toBe(tight.id);
  });

  it('selects the WIDE play when the playhead (55) is only inside it, not TIGHT', async () => {
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    const { result, rerender } = renderHook(
      (props) => AnnotateContainer(baseProps(props)),
      { initialProps: { loadGame, currentTime: 200 } }
    );

    await act(async () => {
      await result.current.handleLoadGame(42, null, null);
      await flushMicrotasks();
    });
    expect(result.current.clipRegions.length).toBe(2);
    expect(result.current.annotateSelectedRegionId).toBeNull();

    await act(async () => { rerender({ loadGame, currentTime: 55 }); await flushMicrotasks(); });

    const wide = result.current.clipRegions.find((r) => r.rawClipId === WIDE_ID);
    expect(result.current.annotateSelectedRegionId).toBe(wide.id);
  });
});
