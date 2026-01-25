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

// localStorage key for persisting effect type preference
const EFFECT_TYPE_STORAGE_KEY = 'highlightEffectType';
const DEFAULT_EFFECT_TYPE = 'dark_overlay';

// Load saved effect type from localStorage, or use default
function getInitialEffectType() {
  try {
    const saved = localStorage.getItem(EFFECT_TYPE_STORAGE_KEY);
    if (saved && ['brightness_boost', 'original', 'dark_overlay'].includes(saved)) {
      return saved;
    }
  } catch (e) {
    // localStorage not available
  }
  return DEFAULT_EFFECT_TYPE;
}

export const useOverlayStore = create((set, get) => ({
  // Working video (from framing export or loaded from project)
  workingVideo: null, // { file, url, metadata }

  // Clip metadata for auto-generating highlight regions
  clipMetadata: null,

  // Effect settings (loaded from localStorage or default to 'dark_overlay')
  effectType: getInitialEffectType(),

  // Loading states
  isLoadingWorkingVideo: false,
  isDataLoaded: false,

  // Actions
  setWorkingVideo: (video) => set({
    workingVideo: video,
    isLoadingWorkingVideo: false,
  }),

  setClipMetadata: (metadata) => set({ clipMetadata: metadata }),

  setEffectType: (type) => {
    // Persist to localStorage
    try {
      localStorage.setItem(EFFECT_TYPE_STORAGE_KEY, type);
    } catch (e) {
      // localStorage not available
    }
    set({ effectType: type });
  },

  setIsLoadingWorkingVideo: (loading) => set({ isLoadingWorkingVideo: loading }),

  setIsDataLoaded: (loaded) => set({ isDataLoaded: loaded }),

  // Computed
  hasWorkingVideo: () => get().workingVideo !== null,

  getVideoDuration: () => get().workingVideo?.metadata?.duration || 0,

  reset: () => set({
    workingVideo: null,
    clipMetadata: null,
    effectType: getInitialEffectType(), // Preserve user's preference on reset
    isLoadingWorkingVideo: false,
    isDataLoaded: false,
  }),
}));

// Selector hooks
export const useOverlayWorkingVideo = () => useOverlayStore(state => state.workingVideo);
export const useOverlayClipMetadata = () => useOverlayStore(state => state.clipMetadata);
export const useOverlayEffectType = () => useOverlayStore(state => state.effectType);
export const useOverlayIsLoading = () => useOverlayStore(state => state.isLoadingWorkingVideo);
