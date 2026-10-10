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

  // T10450 regression: a createProject-only payload (Frame Now/Later's exact
  // shape) has no other field to diff, so filtering `createProject` out of the
  // clean-check's key list (rather than treating its presence as never-clean)
  // left an empty key list — trivially "clean" — and silently dropped the
  // create with zero network calls, zero toast, zero navigation.
  it('Frame Now/Later (createProject-only, no other field changed) still reaches the network and creates the project', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });
      }
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, project_created: true, project_id: 99 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    const region = result.current.clipRegions[0];

    apiFetch.mockClear();

    let outcome;
    await act(async () => {
      outcome = await result.current.updateClipRegion(region.id, { createProject: true });
    });

    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/clips/raw/1'), expect.objectContaining({ method: 'PUT' }));
    expect(outcome).toEqual({ saveOk: true, projectId: 99 });
  });

  // Frame Now navigates straight into Framing as part of this same
  // call's outcome, so the "is now in Clips" toast would be announcing a
  // screen the user is already leaving. Frame Later has no navigation, so it
  // still needs the toast to confirm the play became a clip.
  it('Frame Now (createProject + silent) creates the project without firing the "is now in Clips" toast', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });
      }
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, project_created: true, project_id: 99 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });

    const fetchProjects = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => AnnotateContainer(baseProps({ fetchProjects })));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    const region = result.current.clipRegions[0];

    apiFetch.mockClear();
    let outcome;
    await act(async () => {
      outcome = await result.current.updateClipRegion(region.id, { createProject: true, silent: true });
    });

    expect(outcome).toEqual({ saveOk: true, projectId: 99 });
    expect(fetchProjects).toHaveBeenCalledWith({ force: true });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('Frame Later (createProject, no silent) still fires the "is now in Clips" toast', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });
      }
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, project_created: true, project_id: 99 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    const region = result.current.clipRegions[0];

    apiFetch.mockClear();
    // Clear the "Play saved" toast the initial mark-play-tap creation above
    // already fired, so this assertion is only about the update call below.
    useToastStore.setState({ toasts: [] });

    await act(async () => {
      await result.current.updateClipRegion(region.id, { createProject: true });
    });

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].title).toMatch(/is now in Clips/);
  });

  it('§E row 15 (T12430): Mark play fires no toast; Done fires announcePlaySaved exactly once, announceReelCreated zero times', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });
    // Name the play so the toast text (not just its count) is asserted.
    await act(async () => { await result.current.updateClipRegion(result.current.clipRegions[0].id, { name: 'Nutmeg' }); });

    const playAdded = () => useToastStore.getState().toasts
      .filter((t) => /play/i.test(t.title) && /added/i.test(t.title));
    expect(playAdded().length).toBe(0);

    // Done (handleOverlayClose also serves X/Escape; all are the editor's close gesture)
    await act(async () => { result.current.handleOverlayClose(); await flushMicrotasks(); });
    expect(playAdded().length).toBe(1);
    expect(playAdded()[0].title).toBe('Added play "Nutmeg"');
    expect(useToastStore.getState().toasts.find((t) => t.dedupKey === 'reel-created')).toBeUndefined();

    // Reopen the editor on the SAME play and press Done again: this reaches
    // announcePlayOnDone a second time, so only the once-per-play guard keeps it at 1.
    act(() => { result.current.handleSelectRegion(result.current.clipRegions[0].id); });
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { result.current.handleOverlayClose(); await flushMicrotasks(); });
    expect(playAdded().length).toBe(1);
  });

  it('T12430: Done while the create failed (no raw_clip_id) does not toast or spend the one-shot; a retried create + Done toasts once', async () => {
    let failCreate = true;
    apiFetch.mockImplementation((url) => {
      if (url.includes('/clips/raw/save')) {
        if (failCreate) {
          return Promise.resolve({ ok: false, status: 503, json: async () => ({ code: 'sync_failed' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });

    const playAdded = () => useToastStore.getState().toasts
      .filter((t) => /play/i.test(t.title) && /added/i.test(t.title));

    await act(async () => { result.current.handleOverlayClose(); await flushMicrotasks(); });
    expect(playAdded().length).toBe(0);

    // The user clicks Retry on the failure toast; the create now succeeds.
    failCreate = false;
    const retryToast = useToastStore.getState().toasts.find((t) => t.action?.label === 'Retry');
    expect(retryToast).toBeDefined();
    await act(async () => { await retryToast.action.onClick(); await flushMicrotasks(); });

    act(() => { result.current.handleSelectRegion(result.current.clipRegions[0].id); });
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { result.current.handleOverlayClose(); await flushMicrotasks(); });
    expect(playAdded().length).toBe(1);
  });

  // Owner decision 2026-10-06 (reverses T10710): a freshly Marked play is
  // created already rated Good (4), so the rating row shows a visible selection
  // and no "Rate this play" popup is needed. Never 5: Brilliant makes a highlight.
  it('the create-at-tap POST body and local region carry the default rating Good (4)', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false }) });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => { result.current.handleAddClipFromButton(); });
    await act(async () => { await flushMicrotasks(); });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [, opts] = apiFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.rating).toBe(4);
    // The editor's local echo (AnnotateFullscreenOverlay) reads the region directly.
    expect(result.current.clipRegions[0].rating).toBe(4);
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
