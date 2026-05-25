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
  effectType: HighlightEffect.DARK_OVERLAY,

  highlightColor: 'none',

  // Overlay tuning settings
  strokeWidth: 3,
  fillEnabled: false,
  fillOpacity: 0.10,
  dimStrength: 0.15,

  isLoadingWorkingVideo: false,

  overlayChangedSinceExport: false,

  setEffectType: (type) => set({ effectType: type }),

  setHighlightColor: (color) => set({ highlightColor: color }),

  setStrokeWidth: (w) => set({ strokeWidth: w }),
  setFillEnabled: (e) => set({ fillEnabled: e }),
  setFillOpacity: (o) => set({ fillOpacity: o }),
  setDimStrength: (d) => set({ dimStrength: d }),

  setIsLoadingWorkingVideo: (loading) => set({ isLoadingWorkingVideo: loading }),

  setOverlayChangedSinceExport: (changed) => set({ overlayChangedSinceExport: changed }),

  reset: () => set({
    effectType: HighlightEffect.DARK_OVERLAY,
    highlightColor: 'none',
    strokeWidth: 3,
    fillEnabled: false,
    fillOpacity: 0.10,
    dimStrength: 0.15,
    isLoadingWorkingVideo: false,
    overlayChangedSinceExport: false,
  }),
}));

export const useOverlayEffectType = () => useOverlayStore(state => state.effectType);
export const useOverlayHighlightColor = () => useOverlayStore(state => state.highlightColor);
export const useOverlayIsLoading = () => useOverlayStore(state => state.isLoadingWorkingVideo);
export const useOverlayChangedSinceExport = () => useOverlayStore(state => state.overlayChangedSinceExport);
export const useOverlayStrokeWidth = () => useOverlayStore(state => state.strokeWidth);
export const useOverlayFillEnabled = () => useOverlayStore(state => state.fillEnabled);
export const useOverlayFillOpacity = () => useOverlayStore(state => state.fillOpacity);
export const useOverlayDimStrength = () => useOverlayStore(state => state.dimStrength);
