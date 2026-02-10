import { create } from 'zustand';

import { HighlightEffect } from '../constants/highlightEffects';

/**
 * Store for overlay mode state
 * - Working video data (set by FramingScreen on export)
 * - Highlight regions (restored from backend)
 * - Effect settings
 *
 * This store allows OverlayScreen to be self-contained while receiving
 * data from FramingScreen's export process.
 *
 * NOTE: Effect type is persisted to the backend via overlayActions.setEffectType(),
 * not localStorage. The default is only used until backend data is loaded.
 */

export const useOverlayStore = create((set, get) => ({
  // NOTE: workingVideo is now stored in projectDataStore (canonical owner)
  // Use useProjectDataStore(state => state.workingVideo) to access it

  // Clip metadata for auto-generating highlight regions
  clipMetadata: null,

  // Effect settings (default to dark_overlay, backend loads actual value)
  effectType: HighlightEffect.DARK_OVERLAY,

  // Loading states
  isLoadingWorkingVideo: false,

  // Track if overlay has changed since last export (similar to framing)
  overlayChangedSinceExport: false,

  // Actions
  setClipMetadata: (metadata) => set({ clipMetadata: metadata }),

  setEffectType: (type) => set({ effectType: type }),

  setIsLoadingWorkingVideo: (loading) => set({ isLoadingWorkingVideo: loading }),

  setOverlayChangedSinceExport: (changed) => set({ overlayChangedSinceExport: changed }),

  reset: () => set({
    clipMetadata: null,
    effectType: HighlightEffect.DARK_OVERLAY,
    isLoadingWorkingVideo: false,
    overlayChangedSinceExport: false,
  }),
}));

// Selector hooks
// NOTE: useOverlayWorkingVideo removed - use useWorkingVideo from projectDataStore
export const useOverlayClipMetadata = () => useOverlayStore(state => state.clipMetadata);
export const useOverlayEffectType = () => useOverlayStore(state => state.effectType);
export const useOverlayIsLoading = () => useOverlayStore(state => state.isLoadingWorkingVideo);
export const useOverlayChangedSinceExport = () => useOverlayStore(state => state.overlayChangedSinceExport);
