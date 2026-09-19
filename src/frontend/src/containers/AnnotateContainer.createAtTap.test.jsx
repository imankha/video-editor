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
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useToastStore.setState({ toasts: [] });
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

  it('per-key failure (finding 3): a failed trim is not cleared by a later successful rating; Retry through the queue clears it', async () => {
    let trimAttempts = 0;
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1 }) });
      }
      if (opts?.method === 'PUT') {
        const body = JSON.parse(opts.body);
        if (body.start_time !== undefined) {
          trimAttempts += 1;
          if (trimAttempts === 1) {
            return Promise.resolve({ ok: false, status: 503, json: async () => ({ code: 'sync_failed' }) });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
        }
        // rating write always succeeds
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    const regionId = result.current.clipRegions[0].id;

    // Trim fails (503 sync_failed -> retryable), rating on the SAME region then succeeds.
    await act(async () => {
      await result.current.updateClipRegion(regionId, { startTime: 1, endTime: 5 });
    });
    await act(async () => {
      await result.current.updateClipRegion(regionId, { rating: 5 });
    });

    // The trim's failure must NOT be cleared by the unrelated rating success (v2 finding 3).
    expect(await result.current.awaitRegionWrites(regionId)).toBe(false);

    // Retry re-enqueues through the SAME region queue (not a direct re-call) and succeeds this time.
    const toasts = useToastStore.getState().toasts;
    const retryToast = toasts.find((t) => t.title === 'Could not save to the cloud');
    expect(retryToast).toBeTruthy();
    await act(async () => {
      await retryToast.action.onClick();
    });

    expect(await result.current.awaitRegionWrites(regionId)).toBe(true);
  });

  it('queued delete (finding 4): DELETE waits behind a pending PUT, and no failure toast fires', async () => {
    let resolvePut;
    const putPromise = new Promise((res) => { resolvePut = res; });
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1 }) });
      }
      if (opts?.method === 'PUT') return putPromise;
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    const regionId = result.current.clipRegions[0].id;

    // Name blur enqueues a PUT — held pending.
    act(() => { result.current.updateClipRegion(regionId, { name: 'Renamed' }); });
    await act(async () => { await flushMicrotasks(); });
    expect(apiFetch).toHaveBeenCalledTimes(2); // POST (settled) + PUT (pending)

    // Delete requested immediately after — must NOT fire until the PUT settles.
    let deletePromise;
    act(() => { deletePromise = result.current.handleDeletePlayFromEditor(regionId); });
    await act(async () => { await flushMicrotasks(); });
    expect(apiFetch).toHaveBeenCalledTimes(2); // still no DELETE call

    // The region is removed from LOCAL state immediately (D.3) even though the
    // network delete is still queued behind the pending PUT.
    expect(result.current.clipRegions.length).toBe(0);

    // Resolve the PUT — the queued DELETE can now fire.
    await act(async () => {
      resolvePut({ ok: true, status: 200, json: async () => ({ success: true }) });
      await deletePromise;
    });
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(apiFetch.mock.calls[2][1].method).toBe('DELETE');

    const toasts = useToastStore.getState().toasts;
    expect(toasts.find((t) => t.title === 'Could not save to the cloud')).toBeUndefined();
  });

  it('clean-check (finding 5): a write whose value already matches the stored region never touches the network', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    const region = result.current.clipRegions[0];

    apiFetch.mockClear(); // isolate the assertion to the next write only

    // Re-tapping the already-selected rating (a pointer-down/up with no real
    // change is the same shape) must cost zero network calls.
    await act(async () => {
      await result.current.updateClipRegion(region.id, { rating: region.rating });
    });
    expect(apiFetch).not.toHaveBeenCalled();

    // A trim commit with the SAME start/end (a tap with no movement) is likewise a no-op.
    await act(async () => {
      await result.current.updateClipRegion(region.id, { startTime: region.startTime, endTime: region.endTime });
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('§E row 15: a Mark play tap fires announcePlaySaved exactly once and announceReelCreated zero times', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });

    const toasts = useToastStore.getState().toasts;
    const playSavedToasts = toasts.filter((t) => /play/i.test(t.title) && /saved/i.test(t.title));
    expect(playSavedToasts.length).toBe(1);
    expect(toasts.find((t) => t.dedupKey === 'reel-created')).toBeUndefined();
  });

  it('default capture window (moved from the retired captureWindow.test.jsx): clamps to [0, duration]', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });

    // Tap near the start: the 6s "before" window must clamp to 0, not go negative.
    const early = renderHook(() => AnnotateContainer(baseProps({ currentTime: 1, duration: 120 })));
    act(() => { early.result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    expect(early.result.current.clipRegions[0].startTime).toBe(0);
    expect(early.result.current.clipRegions[0].endTime).toBe(3); // 1 + DEFAULT_CLIP_AFTER(2)

    // Tap near the end: the 2s "after" window must clamp to duration, not exceed it.
    const late = renderHook(() => AnnotateContainer(baseProps({ currentTime: 119, duration: 120 })));
    act(() => { late.result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    expect(late.result.current.clipRegions[0].startTime).toBe(113); // 119 - DEFAULT_CLIP_BEFORE(6)
    expect(late.result.current.clipRegions[0].endTime).toBe(120);
  });
});
