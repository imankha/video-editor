import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useGalleryStore } from './galleryStore';

/**
 * Gallery store count derivation (T3900).
 *
 * The "My Reels" badge in the header shows the count of NEW (unwatched) published
 * reels — `unwatchedCount` — NOT the total reel count (`count`). These two fields are
 * tracked independently: `count` = all published reels, `unwatchedCount` = those with
 * watched_at IS NULL. These tests lock in that separation so the badge can't silently
 * be rebound to the total again.
 */
describe('galleryStore count derivation', () => {
  beforeEach(() => {
    useGalleryStore.getState().reset();
  });

  it('starts with zero counts', () => {
    const { count, unwatchedCount, countLoaded } = useGalleryStore.getState();
    expect(count).toBe(0);
    expect(unwatchedCount).toBe(0);
    expect(countLoaded).toBe(false);
  });

  it('setFromBootstrap maps total and unwatched independently', () => {
    useGalleryStore.getState().setFromBootstrap({ count: 5, unwatched_count: 2 });
    const { count, unwatchedCount, countLoaded } = useGalleryStore.getState();
    // Badge meaning: total reels (5) and new/unseen reels (2) are distinct values.
    expect(count).toBe(5);
    expect(unwatchedCount).toBe(2);
    expect(countLoaded).toBe(true);
  });

  it('setFromBootstrap defaults missing fields to 0', () => {
    useGalleryStore.getState().setFromBootstrap({});
    const { count, unwatchedCount } = useGalleryStore.getState();
    expect(count).toBe(0);
    expect(unwatchedCount).toBe(0);
  });

  it('reset clears both counts and the loaded flag', () => {
    useGalleryStore.getState().setFromBootstrap({ count: 5, unwatched_count: 2 });
    useGalleryStore.getState().reset();
    const { count, unwatchedCount, countLoaded } = useGalleryStore.getState();
    expect(count).toBe(0);
    expect(unwatchedCount).toBe(0);
    expect(countLoaded).toBe(false);
  });

  describe('fetchCount', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      useGalleryStore.getState().reset();
    });

    it('populates count and unwatchedCount from the API response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: 7, unwatched_count: 3 }),
      }));

      const returned = await useGalleryStore.getState().fetchCount({ force: true });

      const { count, unwatchedCount, countLoaded } = useGalleryStore.getState();
      expect(count).toBe(7);
      expect(unwatchedCount).toBe(3);
      expect(countLoaded).toBe(true);
      expect(returned).toBe(7);
    });

    it('recomputes the badge from source after a reel is watched (T3900)', async () => {
      // Watching a reel sets watched_at in the DB, then markWatched recomputes via
      // fetchCount. The badge derives from the recomputed value — total unchanged,
      // unwatched drops — rather than being imperatively decremented.
      useGalleryStore.getState().setFromBootstrap({ count: 4, unwatched_count: 3 });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: 4, unwatched_count: 2 }),
      }));

      await useGalleryStore.getState().fetchCount({ force: true });

      const { count, unwatchedCount } = useGalleryStore.getState();
      expect(count).toBe(4); // total reels unchanged by watching
      expect(unwatchedCount).toBe(2); // one fewer unseen
    });
  });
});

// T11580: Published tab "Just published" spotlight — memory-only view state
// (never persisted). These lock in the consume-once auto-expand contract:
// setJustPublished always arms autoExpandPending; only consumeAutoExpand (not
// just the passage of time/renders) spends it, and clear/reset both wipe it.
describe('galleryStore justPublished (T11580)', () => {
  beforeEach(() => {
    useGalleryStore.getState().reset();
  });

  it('starts with no spotlight and no pending auto-expand', () => {
    const { justPublished, autoExpandPending } = useGalleryStore.getState();
    expect(justPublished).toBeNull();
    expect(autoExpandPending).toBe(false);
  });

  it('setJustPublished stores the highlight and arms autoExpandPending', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 42, gameId: 9, aspectRatio: '9:16' });
    const { justPublished, autoExpandPending } = useGalleryStore.getState();
    expect(justPublished).toEqual({ finalVideoId: 42, gameId: 9, aspectRatio: '9:16' });
    expect(autoExpandPending).toBe(true);
  });

  it('a newer publish REPLACES the previous spotlight and re-arms auto-expand', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 1, gameId: 1, aspectRatio: '9:16' });
    useGalleryStore.getState().consumeAutoExpand();
    useGalleryStore.getState().setJustPublished({ finalVideoId: 2, gameId: 2, aspectRatio: '16:9' });
    const { justPublished, autoExpandPending } = useGalleryStore.getState();
    expect(justPublished.finalVideoId).toBe(2);
    expect(autoExpandPending).toBe(true);
  });

  it('consumeAutoExpand spends the signal without touching justPublished itself', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 42, gameId: 9, aspectRatio: '9:16' });
    useGalleryStore.getState().consumeAutoExpand();
    const { justPublished, autoExpandPending } = useGalleryStore.getState();
    expect(justPublished).toEqual({ finalVideoId: 42, gameId: 9, aspectRatio: '9:16' });
    expect(autoExpandPending).toBe(false);
  });

  it('a second consumeAutoExpand call (simulating a later reopen) is a no-op', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 42, gameId: 9, aspectRatio: '9:16' });
    useGalleryStore.getState().consumeAutoExpand();
    useGalleryStore.getState().consumeAutoExpand();
    expect(useGalleryStore.getState().autoExpandPending).toBe(false);
  });

  it('clearJustPublished (dismiss) drops both the spotlight and any pending auto-expand', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 42, gameId: 9, aspectRatio: '9:16' });
    useGalleryStore.getState().clearJustPublished();
    const { justPublished, autoExpandPending } = useGalleryStore.getState();
    expect(justPublished).toBeNull();
    expect(autoExpandPending).toBe(false);
  });

  it('reset (profile switch) drops both the spotlight and any pending auto-expand', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 42, gameId: 9, aspectRatio: '9:16' });
    useGalleryStore.getState().reset();
    const { justPublished, autoExpandPending } = useGalleryStore.getState();
    expect(justPublished).toBeNull();
    expect(autoExpandPending).toBe(false);
  });
});
