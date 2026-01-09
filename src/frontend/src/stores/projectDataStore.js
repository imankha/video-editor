import { create } from 'zustand';

/**
 * Store for loaded project data
 * Populated by ProjectsScreen/useProjectLoader, consumed by FramingScreen/OverlayScreen
 *
 * This store bridges the gap between project selection and screen rendering.
 * It holds the data that screens need to initialize their own state.
 */
export const useProjectDataStore = create((set, get) => ({
  // Loaded clips with metadata
  clips: [],

  // Currently selected clip index
  selectedClipIndex: 0,

  // Working video (if exported) - { file, url, metadata }
  workingVideo: null,

  // Loaded framing state per clip (from persistence)
  clipStates: {}, // { [clipId]: { segments_data, crop_data, timing_data } }

  // Project aspect ratio
  aspectRatio: '9:16',

  // Clip metadata for overlay mode (calculated from clips with segments)
  clipMetadata: null,

  // Loading state
  isLoading: false,
  loadingStage: null, // 'clips' | 'video' | 'working-video' | 'complete'

  // Actions
  setClips: (clips) => set({ clips }),

  setSelectedClipIndex: (index) => set({ selectedClipIndex: index }),

  setWorkingVideo: (workingVideo) => set({ workingVideo }),

  setClipState: (clipId, state) => set(prev => ({
    clipStates: { ...prev.clipStates, [clipId]: state }
  })),

  setAspectRatio: (aspectRatio) => set({ aspectRatio }),

  setClipMetadata: (clipMetadata) => set({ clipMetadata }),

  setLoading: (isLoading, stage = null) => set({ isLoading, loadingStage: stage }),

  getSelectedClip: () => {
    const { clips, selectedClipIndex } = get();
    return clips[selectedClipIndex] || null;
  },

  // Clear all project data (called when switching projects)
  reset: () => set({
    clips: [],
    selectedClipIndex: 0,
    workingVideo: null,
    clipStates: {},
    aspectRatio: '9:16',
    clipMetadata: null,
    isLoading: false,
    loadingStage: null,
  }),
}));

// Selector hooks
export const useProjectClipsData = () => useProjectDataStore(state => state.clips);
export const useSelectedClipIndex = () => useProjectDataStore(state => state.selectedClipIndex);
export const useWorkingVideo = () => useProjectDataStore(state => state.workingVideo);
export const useProjectAspectRatio = () => useProjectDataStore(state => state.aspectRatio);
