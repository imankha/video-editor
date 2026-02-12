import { create } from 'zustand';

/**
 * @deprecated Use projectDataStore instead - this store is kept for backwards compatibility only.
 *
 * Clip Store - Multi-clip management state
 *
 * MIGRATION: The single source of truth for clip data is now projectDataStore.
 * useClipManager now uses projectDataStore directly. This store is deprecated
 * and will be removed in a future version.
 *
 * @see stores/projectDataStore.js for the single source of truth
 */
export const useClipStore = create((set, get) => ({
  // Array of clip objects
  clips: [],

  // Currently selected clip ID
  selectedClipId: null,

  // Global aspect ratio (applies to all clips)
  globalAspectRatio: '9:16',

  // Global transition settings
  globalTransition: {
    type: 'cut',
    duration: 0.5,
  },

  // State setters
  setClips: (clips) => set({ clips }),
  setSelectedClipId: (selectedClipId) => set({ selectedClipId }),
  setGlobalAspectRatioState: (globalAspectRatio) => set({ globalAspectRatio }),
  setGlobalTransition: (globalTransition) => set({ globalTransition }),

  // Add a clip to the array
  addClipToStore: (clip) => set((state) => ({
    clips: [...state.clips, clip],
  })),

  // Delete a clip and handle selection
  deleteClipFromStore: (clipId) => set((state) => {
    const newClips = state.clips.filter((clip) => clip.id !== clipId);
    let newSelectedClipId = state.selectedClipId;

    // If we deleted the selected clip, select another one
    if (state.selectedClipId === clipId) {
      newSelectedClipId = newClips.length > 0 ? newClips[0].id : null;
    }

    return { clips: newClips, selectedClipId: newSelectedClipId };
  }),

  // Update data for a specific clip
  updateClipInStore: (clipId, data) => set((state) => ({
    clips: state.clips.map((clip) =>
      clip.id === clipId ? { ...clip, ...data } : clip
    ),
  })),

  // Reorder clips via drag-and-drop
  reorderClipsInStore: (fromIndex, toIndex) => set((state) => {
    const newClips = [...state.clips];
    const [removed] = newClips.splice(fromIndex, 1);
    newClips.splice(toIndex, 0, removed);
    return { clips: newClips };
  }),

  // Clear all clips
  clearAllClips: () => set({
    clips: [],
    selectedClipId: null,
  }),

  // Batch update for loading project clips
  setProjectClips: ({ clips, aspectRatio }) => set({
    clips,
    selectedClipId: clips.length > 0 ? clips[0].id : null,
    globalAspectRatio: aspectRatio || get().globalAspectRatio,
  }),

  // Reset to initial state
  reset: () => set({
    clips: [],
    selectedClipId: null,
    globalAspectRatio: '9:16',
    globalTransition: { type: 'cut', duration: 0.5 },
  }),

  // Computed values
  hasClips: () => get().clips.length > 0,

  getSelectedClip: () => {
    const { clips, selectedClipId } = get();
    if (!selectedClipId) return null;
    return clips.find((clip) => clip.id === selectedClipId) || null;
  },

  getSelectedClipIndex: () => {
    const { clips, selectedClipId } = get();
    if (!selectedClipId) return -1;
    return clips.findIndex((clip) => clip.id === selectedClipId);
  },

  getClipById: (clipId) => {
    return get().clips.find((clip) => clip.id === clipId) || null;
  },
}));

export default useClipStore;
