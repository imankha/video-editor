import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T10610 § 3.2 / v2 findings 1 & 2: create-at-tap must queue the create POST as
// the chain HEAD, and a queued field write on the same region must resolve the
// raw_clip_id via the ref map (not React state) regardless of render timing.
//
// This drives the REAL AnnotateContainer (called as a plain function, i.e. a
// hook, from AnnotateScreen — see AnnotateContainer.jsx's own usage) through
// renderHook, with `apiFetch` mocked so saveClip/updateClip (useRawClipSave)
// hit the mock instead of the network. `useAnnotateState` is wrapped so
// `annotateGameId` is set WITHOUT driving the full upload/load flow.

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

describe('AnnotateContainer create-at-tap (T10610)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({
      recordAchievement: vi.fn(),
      fetchProgress: vi.fn().mockResolvedValue(undefined),
    });
    // useIsMobile (via AnnotateContainer) needs matchMedia — jsdom has none.
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
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
  });

  it('create-then-trim race (finding 1): exactly one POST and one PUT, POST first', async () => {
    let resolveCreate;
    const createPromise = new Promise((res) => { resolveCreate = res; });
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) return createPromise;
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    act(() => {
      result.current.handleAddClipFromButton();
    });
    await act(async () => { await flushMicrotasks(); });

    // Region should exist locally already (addClipRegion is synchronous), the
    // POST is in flight but unresolved.
    expect(result.current.clipRegions.length).toBe(1);
    const regionId = result.current.clipRegions[0].id;
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toContain('/clips/raw/save');

    // Fire a trim while the create POST is still unresolved.
    act(() => {
      result.current.updateClipRegion(regionId, { startTime: 1, endTime: 5 });
    });
    await act(async () => { await flushMicrotasks(); });

    // The trim must NOT have issued a second request yet — it is queued behind the create.
    expect(apiFetch).toHaveBeenCalledTimes(1);

    // Resolve the create and let the whole chain settle.
    await act(async () => {
      resolveCreate({ ok: true, status: 200, json: async () => ({ raw_clip_id: 999 }) });
      await result.current.awaitRegionWrites(regionId);
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[0][0]).toContain('/clips/raw/save');
    expect(apiFetch.mock.calls[1][0]).toContain('/clips/raw/999');
    expect(apiFetch.mock.calls[1][1].method).toBe('PUT');
  });

  it('ref-map freshness (finding 2): a queued write started before the create resolves still lands on the right id', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 777 }) });
      }
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    act(() => {
      result.current.handleAddClipFromButton();
    });
    await act(async () => { await flushMicrotasks(); });

    const regionId = result.current.clipRegions[0].id;

    // Second write enqueued right after — React state (setRawClipId) is not
    // necessarily flushed yet, but the ref map must already carry the id by
    // the time this queued write actually executes.
    act(() => {
      result.current.updateClipRegion(regionId, { rating: 5 });
    });
    await act(async () => { await result.current.awaitRegionWrites(regionId); });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1][0]).toContain('/clips/raw/777');
  });

  it('double-tap guard: two rapid taps create exactly one region/row', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1 }) });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    act(() => {
      result.current.handleAddClipFromButton();
      result.current.handleAddClipFromButton();
    });
    await act(async () => { await flushMicrotasks(); });

    expect(result.current.clipRegions.length).toBe(1);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
