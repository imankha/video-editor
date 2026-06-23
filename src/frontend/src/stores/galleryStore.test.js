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

  it('setUnwatchedCount updates only the badge (unseen) count', () => {
    useGalleryStore.getState().setFromBootstrap({ count: 5, unwatched_count: 2 });
    // Watching a reel decrements unwatchedCount via this gesture-based setter.
    useGalleryStore.getState().setUnwatchedCount(1);
    const { count, unwatchedCount } = useGalleryStore.getState();
    expect(unwatchedCount).toBe(1);
    expect(count).toBe(5); // total unchanged
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
  });
});
