import { create } from 'zustand';

/**
 * Project Data Store - Single source of truth for project and clip state
 *
 * This store holds ALL project data including clips. There is no separate clipStore.
 * Clips are transformed to UI format when loaded by useProjectLoader.
 *
 * Clip format (UI-ready):
 * - id: client-side unique ID
 * - workingClipId: backend working_clips.id
 * - file: File object (null for project clips)
 * - fileUrl: URL for project clips
 * - fileName, fileNameDisplay: display names
 * - duration, sourceWidth, sourceHeight, framerate: video metadata
 * - segments: { boundaries, userSplits, trimRange, segmentSpeeds }
 * - cropKeyframes: parsed crop data
 * - trimRange: parsed timing data
 * - annotateName, annotateNotes, etc: clip annotations
 *
 * @see hooks/useProjectLoader.js for clip transformation on load
 * @see hooks/useClipManager.js for clip CRUD operations
 */
export const useProjectDataStore = create((set, get) => ({
  // Loaded clips with metadata (UI format - transformed on load)
  clips: [],

  // Currently selected clip ID (client-side ID)
  selectedClipId: null,

  // Working video (if exported) - { file, url, metadata }
  workingVideo: null,

  // Loaded framing state per clip (from persistence)
  clipStates: {}, // { [clipId]: { segments_data, crop_data, timing_data } }

  // Project aspect ratio (global, applies to all clips)
  aspectRatio: '9:16',

  // Global transition settings between clips
  globalTransition: {
    type: 'cut',
    duration: 0.5,
  },

  // Clip metadata for overlay mode (calculated from clips with segments)
  clipMetadata: null,

  // Loading state
  isLoading: false,
  loadingStage: null, // 'clips' | 'video' | 'working-video' | 'complete'

  // ========== Clip State Setters ==========

  setClips: (clips) => set((state) => {
    // If it's a function, call it with current clips (like useState updater)
    const newClips = typeof clips === 'function' ? clips(state.clips) : clips;
    return { clips: newClips };
  }),

  setSelectedClipId: (selectedClipId) => set({ selectedClipId }),

  setAspectRatio: (aspectRatio) => set({ aspectRatio }),

  setGlobalTransition: (globalTransition) => set({ globalTransition }),

  // ========== Clip CRUD Operations ==========

  // Add a clip to the array
  addClip: (clip) => set((state) => ({
    clips: [...state.clips, clip],
  })),

  // Delete a clip and handle selection
  deleteClip: (clipId) => set((state) => {
    const newClips = state.clips.filter((clip) => clip.id !== clipId);
    let newSelectedClipId = state.selectedClipId;

    // If we deleted the selected clip, select another one
    if (state.selectedClipId === clipId) {
      newSelectedClipId = newClips.length > 0 ? newClips[0].id : null;
    }

    return { clips: newClips, selectedClipId: newSelectedClipId };
  }),

  // Update data for a specific clip
  updateClip: (clipId, data) => set((state) => ({
    clips: state.clips.map((clip) =>
      clip.id === clipId ? { ...clip, ...data } : clip
    ),
  })),

  // Reorder clips via drag-and-drop
  reorderClips: (fromIndex, toIndex) => set((state) => {
    const newClips = [...state.clips];
    const [removed] = newClips.splice(fromIndex, 1);
    newClips.splice(toIndex, 0, removed);
    return { clips: newClips };
  }),

  // Clear all clips
  clearClips: () => set({
    clips: [],
    selectedClipId: null,
  }),

  // Batch update for loading project clips
  setProjectClips: ({ clips, aspectRatio }) => set((state) => ({
    clips,
    selectedClipId: clips.length > 0 ? clips[0].id : null,
    aspectRatio: aspectRatio || state.aspectRatio,
  })),

  // ========== Other Actions ==========

  setWorkingVideo: (workingVideo) => set({ workingVideo }),

  setClipState: (clipId, state) => set(prev => ({
    clipStates: { ...prev.clipStates, [clipId]: state }
  })),

  setClipMetadata: (clipMetadata) => set({ clipMetadata }),

  setLoading: (isLoading, stage = null) => set({ isLoading, loadingStage: stage }),

  // ========== Computed Values ==========

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

  // Clear all project data (called when switching projects)
  reset: () => set({
    clips: [],
    selectedClipId: null,
    workingVideo: null,
    clipStates: {},
    aspectRatio: '9:16',
    globalTransition: { type: 'cut', duration: 0.5 },
    clipMetadata: null,
    isLoading: false,
    loadingStage: null,
  }),
}));

// Selector hooks
export const useProjectClips = () => useProjectDataStore(state => state.clips);
export const useSelectedClipId = () => useProjectDataStore(state => state.selectedClipId);
export const useWorkingVideo = () => useProjectDataStore(state => state.workingVideo);
export const useProjectAspectRatio = () => useProjectDataStore(state => state.aspectRatio);
export const useGlobalTransition = () => useProjectDataStore(state => state.globalTransition);
