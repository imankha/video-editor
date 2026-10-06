import { create } from 'zustand';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

// Module-level ref for fetch dedup
let _fetchCountPromise = null;

/**
 * Gallery Store
 *
 * Manages the state for the Downloads/Gallery panel.
 * Extracted from App.jsx to make DownloadsPanel self-contained.
 */
export const useGalleryStore = create((set) => ({
  // Panel open state
  isOpen: false,

  // Downloads count (for badge display)
  count: 0,
  unwatchedCount: 0,
  countLoaded: false,

  // Version signal for the published-reels model. Bumped whenever the set of
  // published reels changes (publish / unpublish). Views that render the
  // grouped My Reels list (useCollections) subscribe and re-fetch — model
  // change -> event -> UI updates, instead of relying on a reopen/refetch race.
  collectionsVersion: 0,

  // T11580: the highlight most recently published THIS session, memory-only
  // (never persisted -- Decision 1, "Just published" spotlight is Option A:
  // appears only right after a publish, not derived from published_at).
  // { finalVideoId, gameId, aspectRatio } | null. gameId is null for a
  // multi-game/no-game highlight (mirrors finishedReelNav.js's gating), which
  // targets the Mixes group instead of a single game group.
  justPublished: null,
  // Consume-once signal for the one auto-expand that should follow THIS
  // publish (landmine: T8990 -- a group's defaultExpanded must never be
  // derived from justPublished staying truthy, or every later remount of
  // CollectionsTab would re-force the same group open again, discarding a
  // user's deliberate collapse). Readers capture this once at their own first
  // mount after a publish (lazy useState initializer) then call
  // consumeAutoExpand() so a later remount sees it already spent.
  autoExpandPending: false,

  // T11800: the play most recently framed THIS session whose Focus session ended with
  // "Done for now" (memory-only, consume-once like justPublished). { projectId, clipName }.
  // Set inside the gesture handler; the Annotate banner captures it once at mount and
  // clears it, so it can never reappear on a reload or a later remount.
  justFramed: null,
  // T11800 fallback (Focus session not started from Annotate): the draft the Clips tab
  // should scroll to and ring ONCE. `clipsRingTarget` is the pending request (set by the
  // gesture); ProjectManager consumes it into `clipsRingProjectId` (the active ring, which
  // DraftTile reads) and clears that after 2.5s (T8990: never derived from a value that
  // stays truthy).
  clipsRingTarget: null,
  clipsRingProjectId: null,

  // Actions
  open: () => {
    setWarmupPriority(WARMUP_PRIORITY.GALLERY);
    set({ isOpen: true });
  },
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setCount: (count) => set({ count, countLoaded: true }),

  // Dispatch a "published reels changed" event. Call after a publish/unpublish
  // succeeds on the backend (the model change), so subscribed views refresh.
  notifyCollectionsChanged: () => set((state) => ({ collectionsVersion: state.collectionsVersion + 1 })),

  // T11580: set from usePublishProject's success path (inside the publish
  // gesture, never a useEffect). A newer publish replaces whatever was there.
  setJustPublished: (justPublished) => set({ justPublished, autoExpandPending: true }),
  // Dismiss (X) -- also clears the auto-expand signal so a stale pending
  // expand can't fire for a highlight the user already dismissed.
  clearJustPublished: () => set({ justPublished: null, autoExpandPending: false }),
  setJustFramed: (justFramed) => set({ justFramed }),
  clearJustFramed: () => set({ justFramed: null }),
  setClipsRingTarget: (projectId) => set({ clipsRingTarget: projectId }),
  startClipsRing: (projectId) => set({ clipsRingTarget: null, clipsRingProjectId: projectId }),
  clearClipsRing: () => set({ clipsRingProjectId: null }),
  // Read-and-clear: the FIRST caller after a publish gets true; every
  // subsequent call (later remounts/reopens) gets false until the next publish.
  consumeAutoExpand: () => set({ autoExpandPending: false }),

  /**
   * Fetch downloads count from backend (for badge).
   * Deduped: concurrent callers share the same promise.
   */
  setFromBootstrap: (downloads) => {
    set({ count: downloads.count || 0, unwatchedCount: downloads.unwatched_count || 0, countLoaded: true });
  },

  fetchCount: async ({ force = false } = {}) => {
    if (_fetchCountPromise && !force) return _fetchCountPromise;

    _fetchCountPromise = (async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/downloads/count`);
        if (!response.ok) return 0;
        const data = await response.json();
        const count = data.count || 0;
        const unwatchedCount = data.unwatched_count || 0;
        set({ count, unwatchedCount, countLoaded: true });
        return count;
      } catch {
        return 0;
      } finally {
        _fetchCountPromise = null;
      }
    })();
    return _fetchCountPromise;
  },

  // Reset on profile switch — clears badge count, closes panel, and drops the
  // just-published spotlight (Decision 1: cleared on profile switch).
  reset: () => {
    _fetchCountPromise = null;
    set({
      isOpen: false,
      count: 0,
      unwatchedCount: 0,
      countLoaded: false,
      collectionsVersion: 0,
      justPublished: null,
      autoExpandPending: false,
    });
  },
}));

// Selector hooks for granular subscriptions
export const useGalleryIsOpen = () => useGalleryStore((state) => state.isOpen);
export const useGalleryCount = () => useGalleryStore((state) => state.count);
export const useGalleryActions = () => useGalleryStore((state) => ({
  open: state.open,
  close: state.close,
  toggle: state.toggle,
  setCount: state.setCount,
}));
