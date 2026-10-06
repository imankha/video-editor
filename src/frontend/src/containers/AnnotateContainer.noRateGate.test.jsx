import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// No "Rate this play" gate: Done / close never blocks on rating, even for a legacy
// play whose rating is null. Done on a rating-5 play that is not yet a highlight
// still opens the Highlight choice card (T11130).
//
// Same harness as AnnotateContainer.createAtTap.test.jsx.

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

async function markPlay(result) {
  await act(async () => { result.current.handleAddClipFromButton(); });
  await act(async () => { await flushMicrotasks(); });
  return result.current.clipRegions[0].id;
}

describe('AnnotateContainer - no rate gate', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false, success: true }) });
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

  it('handleOverlayClose closes immediately even when region.rating is null', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markPlay(result);
    // A legacy play (rating null) arrives via import; switch the editor onto it.
    await act(async () => {
      await result.current.importAnnotations([{ start_time: 40, end_time: 48, name: '', rating: null, tags: [], notes: '' }], 120);
    });
    await act(async () => { await flushMicrotasks(); });
    const legacy = result.current.clipRegions.find((r) => r.rating == null);
    expect(legacy).toBeTruthy();
    act(() => { result.current.handleSelectRegion(legacy.id); });
    expect(result.current.annotateSelectedRegionId).toBe(legacy.id);
    // Selected (not yet editing): the Edit Play entry opens the editor on it.
    act(() => { result.current.handleAddClipFromButton(); });
    expect(result.current.showAnnotateOverlay).toBe(true);

    act(() => { result.current.handleOverlayClose(); });

    expect(result.current.showAnnotateOverlay).toBe(false);
    expect(result.current.rateGate).toBeUndefined();
  });

  it('Done on a rating-5 play that is not yet a highlight still opens the highlight choice', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 5 }); });

    act(() => { result.current.handleOverlayClose(); });

    expect(result.current.highlightChoice).toEqual({ regionId: id });
    expect(result.current.showAnnotateOverlay).toBe(true);
  });
});
