import { create } from 'zustand';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';
import { API_BASE } from '../config';

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
  countLoaded: false,

  // Actions
  open: () => {
    setWarmupPriority(WARMUP_PRIORITY.GALLERY);
    set({ isOpen: true });
  },
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setCount: (count) => set({ count, countLoaded: true }),

  /**
   * Fetch downloads count from backend (for badge).
   * Deduped: concurrent callers share the same promise.
   */
  fetchCount: async ({ force = false } = {}) => {
    if (_fetchCountPromise && !force) return _fetchCountPromise;

    _fetchCountPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/downloads/count`);
        if (!response.ok) return 0;
        const data = await response.json();
        const count = data.count || 0;
        set({ count, countLoaded: true });
        return count;
      } catch {
        return 0;
      } finally {
        _fetchCountPromise = null;
      }
    })();
    return _fetchCountPromise;
  },

  // Reset on profile switch — clears badge count and closes panel
  reset: () => {
    _fetchCountPromise = null;
    set({ isOpen: false, count: 0, countLoaded: false });
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
