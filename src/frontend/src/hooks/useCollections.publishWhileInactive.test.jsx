import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// apiFetch is referenced inside a hoisted vi.mock factory.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

vi.mock('../stores/profileStore', () => {
  const state = { profiles: [], currentProfileId: null };
  const useProfileStore = (sel) => sel(state);
  useProfileStore.getState = () => state;
  return { useProfileStore };
});

// Real galleryStore (unmocked) so notifyCollectionsChanged/reset exercise the
// actual subscription + the actual non-monotonic reset-to-0 behavior.
import { useGalleryStore } from '../stores/galleryStore';
import { useCollections } from './useCollections';

const jsonResponse = (body) => ({ ok: true, json: async () => body });

describe('useCollections — T11600 (Published tab stale after a publish while inactive)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    act(() => { useGalleryStore.getState().reset(); });
  });

  it('refetches the summary once the tab becomes active, even if the publish-driven version bump happened while inactive', async () => {
    apiFetchMock
      .mockResolvedValueOnce(jsonResponse({ games: [] })) // mount-time eager fetch (T9390), tab inactive
      .mockResolvedValueOnce(jsonResponse({ games: [{ id: 1, name: 'Game 1' }] })); // post-publish refetch

    const { result, rerender } = renderHook(
      ({ isActive }) => useCollections(isActive),
      { initialProps: { isActive: false } }
    );

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.summary).toEqual({ games: [] });

    // A publish happens while the Published tab is NOT active (e.g. publishing
    // from the Reels tab) — galleryStore bumps collectionsVersion.
    act(() => { useGalleryStore.getState().notifyCollectionsChanged(); });
    rerender({ isActive: false });

    // Still inactive: must NOT have fetched yet (no premature refetch).
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    // The tab then becomes active (user opens Published, or the publish
    // gesture's openGallery navigates there).
    rerender({ isActive: true });

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.summary).toEqual({ games: [{ id: 1, name: 'Game 1' }] });
  });

  it('does not drop a publish whose version bump coincides with a profile-switch reset (ABA: collectionsVersion is not monotonic)', async () => {
    apiFetchMock
      .mockResolvedValueOnce(jsonResponse({ games: [] }))           // mount
      .mockResolvedValueOnce(jsonResponse({ games: [{ id: 1 }] }))  // publish #1 while inactive, then activate
      .mockResolvedValueOnce(jsonResponse({ games: [{ id: 2 }] })); // publish #2 after reset+rebump to the SAME version number, then activate

    const { result, rerender } = renderHook(
      ({ isActive }) => useCollections(isActive),
      { initialProps: { isActive: false } }
    );
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));

    // Publish #1: version 0 -> 1 while inactive, then activate -> fetched, seen=1.
    act(() => { useGalleryStore.getState().notifyCollectionsChanged(); });
    rerender({ isActive: true });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.summary).toEqual({ games: [{ id: 1 }] });

    // Deactivate, then a profile switch resets collectionsVersion back to 0
    // directly (profileStore._resetDataStores calls galleryStore.reset()) --
    // this hook is not remounted across a profile switch (ProjectManager isn't
    // keyed by profile), so its seenVersionRef survives past the reset.
    rerender({ isActive: false });
    act(() => { useGalleryStore.getState().reset(); });

    // Publish #2 (on the new profile) bumps 0 -> 1 again while inactive -- the
    // SAME numeric value seenVersionRef already holds from publish #1. A naive
    // value-equality check would mistake this for "already seen" and drop the
    // refetch; the fix must track the 0 in between, not just the before/after
    // values that happen to collide.
    act(() => { useGalleryStore.getState().notifyCollectionsChanged(); });
    rerender({ isActive: true });

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.summary).toEqual({ games: [{ id: 2 }] });
  });

  it('clears cached member lists on a real version-bump refetch, so an already-expanded game group picks up a new highlight', async () => {
    apiFetchMock
      .mockResolvedValueOnce(jsonResponse({ games: [{ id: 9 }] }))    // mount, tab active
      .mockResolvedValueOnce(jsonResponse({ downloads: [{ id: 1 }] })) // expand game:9
      .mockResolvedValueOnce(jsonResponse({ games: [{ id: 9 }] }));   // post-publish refetch

    const { result } = renderHook(() => useCollections(true));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.fetchMembers({ key: 'game:9', query: 'game_id=9' });
    });
    expect(result.current.members['game:9']).toEqual([{ id: 1 }]);
    expect(result.current.memberStates['game:9']).toBe('ready');

    // A new highlight is published into the same game while the tab is active.
    act(() => { useGalleryStore.getState().notifyCollectionsChanged(); });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));

    // The stale cached member list must not survive the refetch -- otherwise
    // re-expanding game:9 would short-circuit on the cache (memberStates ===
    // 'ready') and never pick up the newly published highlight.
    expect(result.current.members['game:9']).toBeUndefined();
    expect(result.current.memberStates['game:9']).toBeUndefined();
  });
});
