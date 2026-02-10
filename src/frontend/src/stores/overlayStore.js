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
  // Working video (from framing export or loaded from project)
  workingVideo: null, // { file, url, metadata }

  // Clip metadata for auto-generating highlight regions
  clipMetadata: null,

  // Effect settings (default to dark_overlay, backend loads actual value)
  effectType: HighlightEffect.DARK_OVERLAY,

  // Loading states
  isLoadingWorkingVideo: false,

  // Track if overlay has changed since last export (similar to framing)
  overlayChangedSinceExport: false,

  // Actions
  setWorkingVideo: (video) => set({
    workingVideo: video,
    isLoadingWorkingVideo: false,
  }),

  setClipMetadata: (metadata) => set({ clipMetadata: metadata }),

  setEffectType: (type) => set({ effectType: type }),

  setIsLoadingWorkingVideo: (loading) => set({ isLoadingWorkingVideo: loading }),

  setOverlayChangedSinceExport: (changed) => set({ overlayChangedSinceExport: changed }),

  // Computed
  hasWorkingVideo: () => get().workingVideo !== null,

  getVideoDuration: () => get().workingVideo?.metadata?.duration || 0,

  reset: () => set({
    workingVideo: null,
    clipMetadata: null,
    effectType: HighlightEffect.DARK_OVERLAY,
    isLoadingWorkingVideo: false,
    overlayChangedSinceExport: false,
  }),
}));

// Selector hooks
export const useOverlayWorkingVideo = () => useOverlayStore(state => state.workingVideo);
export const useOverlayClipMetadata = () => useOverlayStore(state => state.clipMetadata);
export const useOverlayEffectType = () => useOverlayStore(state => state.effectType);
export const useOverlayIsLoading = () => useOverlayStore(state => state.isLoadingWorkingVideo);
export const useOverlayChangedSinceExport = () => useOverlayStore(state => state.overlayChangedSinceExport);
