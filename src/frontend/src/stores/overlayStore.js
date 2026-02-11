import { create } from 'zustand';

import { HighlightEffect } from '../constants/highlightEffects';

/**
 * Store for overlay mode UI state
 * - Effect settings
 * - Loading states
 * - Change tracking
 *
 * NOTE: Working video and clip metadata are stored in projectDataStore (canonical owner).
 * This store only contains overlay-specific UI state.
 *
 * NOTE: Effect type is persisted to the backend via overlayActions.setEffectType(),
 * not localStorage. The default is only used until backend data is loaded.
 */

export const useOverlayStore = create((set) => ({
  // Effect settings (default to dark_overlay, backend loads actual value)
  effectType: HighlightEffect.DARK_OVERLAY,

  // Highlight color for new highlights (null = None/no preference, user hasn't selected yet)
  highlightColor: null,

  // Loading states
  isLoadingWorkingVideo: false,

  // Track if overlay has changed since last export (similar to framing)
  overlayChangedSinceExport: false,

  // Actions
  setEffectType: (type) => set({ effectType: type }),

  setHighlightColor: (color) => set({ highlightColor: color }),

  setIsLoadingWorkingVideo: (loading) => set({ isLoadingWorkingVideo: loading }),

  setOverlayChangedSinceExport: (changed) => set({ overlayChangedSinceExport: changed }),

  reset: () => set({
    effectType: HighlightEffect.DARK_OVERLAY,
    highlightColor: null,  // Reset to "no preference"
    isLoadingWorkingVideo: false,
    overlayChangedSinceExport: false,
  }),
}));

// Selector hooks
// NOTE: useOverlayWorkingVideo and useOverlayClipMetadata removed - use projectDataStore
export const useOverlayEffectType = () => useOverlayStore(state => state.effectType);
export const useOverlayHighlightColor = () => useOverlayStore(state => state.highlightColor);
export const useOverlayIsLoading = () => useOverlayStore(state => state.isLoadingWorkingVideo);
export const useOverlayChangedSinceExport = () => useOverlayStore(state => state.overlayChangedSinceExport);
