import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectDataStore } from './projectDataStore';

// Open-in-editor latency: the open gesture prefetches clips in parallel with the
// project fetch; App.handleModeChange takes that promise instead of re-fetching.
describe('projectDataStore clips prefetch', () => {
  beforeEach(() => {
    useProjectDataStore.setState({ _clipsPrefetch: null, _clipsInflight: null });
    vi.restoreAllMocks();
  });

  it('take returns the prefetched promise once, for the same project only', () => {
    const promise = Promise.resolve([]);
    vi.spyOn(useProjectDataStore.getState(), 'invalidateClips').mockReturnValue(promise);
    useProjectDataStore.setState({ invalidateClips: () => promise });
    useProjectDataStore.getState().prefetchClipsForOpen(7);
    expect(useProjectDataStore.getState().takeClipsPrefetch(8)).toBeNull();
    useProjectDataStore.getState().prefetchClipsForOpen(7);
    expect(useProjectDataStore.getState().takeClipsPrefetch(7)).toBe(promise);
    expect(useProjectDataStore.getState().takeClipsPrefetch(7)).toBeNull();
  });

  it('an expired prefetch is not reused', () => {
    useProjectDataStore.setState({
      _clipsPrefetch: { projectId: 7, promise: Promise.resolve([]), at: Date.now() - 60000 },
    });
    expect(useProjectDataStore.getState().takeClipsPrefetch(7)).toBeNull();
  });
});
