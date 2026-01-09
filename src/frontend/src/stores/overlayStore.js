import { create } from 'zustand';

/**
 * Store for overlay mode state
 * - Working video data (set by FramingScreen on export)
 * - Highlight regions (restored from backend)
 * - Effect settings
 *
 * This store allows OverlayScreen to be self-contained while receiving
 * data from FramingScreen's export process.
 */
export const useOverlayStore = create((set, get) => ({
  // Working video (from framing export or loaded from project)
  workingVideo: null, // { file, url, metadata }

  // Clip metadata for auto-generating highlight regions
  clipMetadata: null,

  // Effect settings
  effectType: 'original',

  // Loading states
  isLoadingWorkingVideo: false,
  isDataLoaded: false,

  // Actions
  setWorkingVideo: (video) => set({
    workingVideo: video,
    isLoadingWorkingVideo: false,
  }),

  setClipMetadata: (metadata) => set({ clipMetadata: metadata }),

  setEffectType: (type) => set({ effectType: type }),

  setIsLoadingWorkingVideo: (loading) => set({ isLoadingWorkingVideo: loading }),

  setIsDataLoaded: (loaded) => set({ isDataLoaded: loaded }),

  // Computed
  hasWorkingVideo: () => get().workingVideo !== null,

  getVideoDuration: () => get().workingVideo?.metadata?.duration || 0,

  reset: () => set({
    workingVideo: null,
    clipMetadata: null,
    effectType: 'original',
    isLoadingWorkingVideo: false,
    isDataLoaded: false,
  }),
}));

// Selector hooks
export const useOverlayWorkingVideo = () => useOverlayStore(state => state.workingVideo);
export const useOverlayClipMetadata = () => useOverlayStore(state => state.clipMetadata);
export const useOverlayEffectType = () => useOverlayStore(state => state.effectType);
export const useOverlayIsLoading = () => useOverlayStore(state => state.isLoadingWorkingVideo);
