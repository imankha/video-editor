import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store.
vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

/**
 * T6190: invalidateClips is the gesture-driven refetch that replaces FocusScreen's
 * removed mount-time fetchClips. Leaving annotate for framing/overlay invalidates the
 * clip list so the editor picks up boundary/clip edits made in annotate.
 */
describe('projectDataStore.invalidateClips (T6190)', () => {
  let useProjectDataStore;

  beforeEach(async () => {
    vi.resetModules();
    mockApiFetch.mockReset();
    const mod = await import('./projectDataStore');
    useProjectDataStore = mod.useProjectDataStore;
    useProjectDataStore.setState({ clips: [], _clipsInflight: null, selectedClipId: null });
  });

  it('force-fetches fresh clips and replaces the store list (picks up annotate edits)', async () => {
    // Store holds the pre-edit clip (old boundaries).
    useProjectDataStore.setState({
      clips: [{ id: 7, start_time: 1, end_time: 5 }],
      selectedClipId: 7,
    });
    // Backend returns the post-edit boundaries.
    const fresh = [{ id: 7, start_time: 2, end_time: 9 }];
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(fresh) });

    const result = await useProjectDataStore.getState().invalidateClips(52);

    expect(result).toEqual(fresh);
    const [url] = mockApiFetch.mock.calls[0];
    expect(url).toContain('/clips/projects/52/clips');
    expect(useProjectDataStore.getState().clips).toEqual(fresh); // updated boundaries land
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it('drops the in-flight latch so it is not deduped against a stale settled request', async () => {
    // Simulate a stale latch left over for the same project (the mount-refetch bug class:
    // a settled/stale promise must not swallow the invalidation fetch).
    const stalePromise = Promise.resolve([{ id: 1, stale: true }]);
    useProjectDataStore.setState({ _clipsInflight: { projectId: 52, promise: stalePromise } });

    const fresh = [{ id: 1, stale: false }];
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(fresh) });

    const result = await useProjectDataStore.getState().invalidateClips(52);

    expect(mockApiFetch).toHaveBeenCalledTimes(1); // a real network fetch went out
    expect(result).toEqual(fresh);
  });

  it('a stale fetch resolving AFTER a fresher invalidateClips does not clobber the fresh data', async () => {
    // Start fetch A (in flight, unresolved).
    let resolveA;
    mockApiFetch.mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve; }));
    const fetchA = useProjectDataStore.getState().fetchClips(52);

    // Invalidate -> fetch B fires (drops the latch so it's a real second request) and
    // resolves BEFORE A.
    const freshB = [{ id: 2, start_time: 10, end_time: 20 }];
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(freshB) });
    await useProjectDataStore.getState().invalidateClips(52);
    expect(useProjectDataStore.getState().clips).toEqual(freshB);

    // NOW resolve the stale A after B already landed.
    const staleA = [{ id: 1, start_time: 0, end_time: 1 }];
    resolveA({ ok: true, json: () => Promise.resolve(staleA) });
    await fetchA;

    // B's data must still be in the store — A's late resolution must not clobber it.
    expect(useProjectDataStore.getState().clips).toEqual(freshB);
  });

  it('is a no-op with no projectId', async () => {
    const result = await useProjectDataStore.getState().invalidateClips(null);
    expect(result).toEqual([]);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('no longer tracks the dead clipsLoadedAt field', async () => {
    // T6190 deleted clipsLoadedAt (written-but-never-read). Guard against re-adding it.
    expect('clipsLoadedAt' in useProjectDataStore.getState()).toBe(false);

    mockApiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 1 }]) });
    await useProjectDataStore.getState().fetchClips(52);
    expect('clipsLoadedAt' in useProjectDataStore.getState()).toBe(false);

    useProjectDataStore.getState().setProjectClips({ clips: [{ id: 2 }], aspectRatio: '9:16' });
    expect('clipsLoadedAt' in useProjectDataStore.getState()).toBe(false);
  });
});
