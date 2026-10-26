import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * T13590: while the video PLAYS the playhead must not drive selection, so the
 * big primary button never swaps from Mark play to the highlight/edit actions
 * under a parent's finger. Selection syncs once playback pauses.
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

describe('AnnotateContainer no auto-select while playing (T13590)', () => {
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

  async function loadAt(props) {
    const loadGame = vi.fn().mockResolvedValue(gameResponse());
    const hook = renderHook(
      (p) => AnnotateContainer(baseProps(p)),
      { initialProps: { loadGame, currentTime: 200, ...props } }
    );
    await act(async () => {
      await hook.result.current.handleLoadGame(42, null, null);
      await flushMicrotasks();
    });
    return { ...hook, loadGame };
  }

  it('does not select a play when the playhead enters it while playing', async () => {
    const { result, rerender, loadGame } = await loadAt({ isPlaying: true });
    expect(result.current.annotateSelectedRegionId).toBeNull();
    await act(async () => { rerender({ loadGame, currentTime: 55, isPlaying: true }); await flushMicrotasks(); });
    expect(result.current.annotateSelectedRegionId).toBeNull();
    expect(result.current.isEditMode).toBe(false);
  });

  it('selects the play under the playhead once playback pauses', async () => {
    const { result, rerender, loadGame } = await loadAt({ isPlaying: true });
    await act(async () => { rerender({ loadGame, currentTime: 55, isPlaying: true }); await flushMicrotasks(); });
    await act(async () => { rerender({ loadGame, currentTime: 55, isPlaying: false }); await flushMicrotasks(); });
    const wide = result.current.clipRegions.find((r) => r.rawClipId === WIDE_ID);
    expect(result.current.annotateSelectedRegionId).toBe(wide.id);
  });
});
