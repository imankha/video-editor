import { create } from 'zustand';

/**
 * Store for framing mode state that needs to persist across mode switches
 * and be accessible from other screens (like overlay for export comparison)
 */
export const useFramingStore = create((set, get) => ({
  // Per-clip framing state (crop keyframes, segments)
  clipStates: {},

  // Current video file (for persisting across mode switches)
  videoFile: null,

  // Global settings
  includeAudio: true,

  // Export tracking
  hasExported: false,
  exportedStateHash: null,
  framingChangedSinceExport: false,

  // Currently loaded clip data (from projectDataStore, but needed for framing)
  currentClipId: null,

  // Actions
  setClipState: (clipId, state) => set(prev => ({
    clipStates: { ...prev.clipStates, [clipId]: state }
  })),

  getClipState: (clipId) => get().clipStates[clipId] || null,

  setVideoFile: (file) => set({ videoFile: file }),

  setIncludeAudio: (value) => set({ includeAudio: value }),

  setCurrentClipId: (clipId) => set({ currentClipId: clipId }),

  markExported: (stateHash) => set({
    hasExported: true,
    exportedStateHash: stateHash,
    framingChangedSinceExport: false,
  }),

  setFramingChangedSinceExport: (changed) => set({ framingChangedSinceExport: changed }),

  hasChangedSinceExport: (currentStateHash) => {
    const { hasExported, exportedStateHash } = get();
    if (!hasExported) return false;
    return currentStateHash !== exportedStateHash;
  },

  // Reset for new project
  reset: () => set({
    clipStates: {},
    videoFile: null,
    hasExported: false,
    exportedStateHash: null,
    framingChangedSinceExport: false,
    currentClipId: null,
  }),
}));

// Selector hooks
export const useFramingVideoFile = () => useFramingStore(state => state.videoFile);
export const useFramingIncludeAudio = () => useFramingStore(state => state.includeAudio);
export const useFramingChangedSinceExport = () => useFramingStore(state => state.framingChangedSinceExport);
