import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * T17170:C1: after a play is marked it stays selected, and the T13590 "no
 * selection change while playing" gate also froze DESELECT, so playing on past
 * the play kept "Edit play" up and the parent could not mark the next moment.
 * Leaving the selected play's range now deselects at once (playing or not);
 * entering a play while playing still selects nothing (T13590).
 *
 * Drives the REAL AnnotateContainer through renderHook (same harness as
 * AnnotateContainer.noAutoSelectWhilePlaying.test.jsx).
 */

// T11175: the Add Clip beacon is a funnel event; keep it off the mocked apiFetch.
vi.mock('../utils/funnelEvents', async (orig) => ({ ...(await orig()), recordFunnelEvent: vi.fn() }));
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

describe('AnnotateContainer deselects when a playing playhead leaves the play (T17170:C1)', () => {
  beforeEach(() => {
    __resetBeginLoadDedup();
    apiFetch.mockReset();
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
    useAuthStore.setState({ isAuthenticated: true });
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
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

  async function step(rerender, loadGame, currentTime, isPlaying) {
    await act(async () => { rerender({ loadGame, currentTime, isPlaying }); await flushMicrotasks(); });
  }

  it('playing past the selected play deselects it, so Mark play comes back', async () => {
    const { result, rerender, loadGame } = await loadAt({ isPlaying: false });
    await step(rerender, loadGame, 50, false);
    const wide = result.current.clipRegions.find((r) => r.rawClipId === WIDE_ID);
    expect(result.current.annotateSelectedRegionId).toBe(wide.id);
    expect(result.current.isEditMode).toBe(true);

    await step(rerender, loadGame, 55, true);
    expect(result.current.annotateSelectedRegionId).toBe(wide.id);
    await step(rerender, loadGame, 61, true);
    expect(result.current.annotateSelectedRegionId).toBeNull();
    expect(result.current.isEditMode).toBe(false);
  });

  it('playing past the selected play into another play selects nothing (T13590)', async () => {
    const { result, rerender, loadGame } = await loadAt({ isPlaying: false });
    await step(rerender, loadGame, 46, false);
    const tight = result.current.clipRegions.find((r) => r.rawClipId === TIGHT_ID);
    expect(result.current.annotateSelectedRegionId).toBe(tight.id);
    // Leaves TIGHT (45-47) while still inside WIDE (40-60): deselect, never swap to WIDE.
    await step(rerender, loadGame, 48, true);
    expect(result.current.annotateSelectedRegionId).toBeNull();
  });
});
