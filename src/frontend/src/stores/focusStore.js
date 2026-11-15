import { create } from 'zustand';

/**
 * Store for framing mode state that needs to persist across mode switches
 * and be read by the update-gate flush and bug reports
 */
export const useFocusStore = create((set) => ({
  // Global settings
  includeAudio: true,

  // Export tracking
  framingChangedSinceExport: false,

  // Currently loaded clip data (from projectDataStore, but needed for framing)
  currentClipId: null,

  // Actions
  setIncludeAudio: (value) => set({ includeAudio: value }),

  setCurrentClipId: (clipId) => set({ currentClipId: clipId }),


  setFramingChangedSinceExport: (changed) => set({ framingChangedSinceExport: changed }),

  // Reset for new project
  reset: () => set({
    framingChangedSinceExport: false,
    currentClipId: null,
  }),
}));

// Selector hooks
export const useFocusIncludeAudio = () => useFocusStore(state => state.includeAudio);
export const useFocusChangedSinceExport = () => useFocusStore(state => state.framingChangedSinceExport);
