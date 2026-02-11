import { create } from 'zustand';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';

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

  // Actions
  open: () => {
    setWarmupPriority(WARMUP_PRIORITY.GALLERY);
    set({ isOpen: true });
  },
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setCount: (count) => set({ count }),
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
