import { create } from 'zustand';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * Project Data Store - Single source of truth for project and clip state
 *
 * T250: Stores RAW backend WorkingClipResponse data. No transformation.
 * Derived values (isExtracted, isFailed, etc.) are computed via clipSelectors.js.
 * Backend working_clips.id is the canonical clip ID.
 *
 * Clip format (raw backend WorkingClipResponse):
 * - id: backend working_clips.id (integer)
 * - project_id, raw_clip_id, uploaded_filename
 * - filename: extracted clip filename (null if not extracted)
 * - file_url: presigned R2 URL (null in local dev)
 * - name, notes, exported_at, sort_order
 * - crop_data, timing_data, segments_data: JSON strings
 * - game_id, start_time, end_time, tags, rating
 * - extraction_status: 'pending' | 'running' | 'completed' | 'failed' | null
 *
 * Video metadata is cached separately in clipMetadataCache keyed by clip ID.
 *
 * @see utils/clipSelectors.js for derived value computation
 * @see hooks/useProjectLoader.js for clip loading
 * @see hooks/useClipManager.js for clip CRUD convenience wrapper
 */
export const useProjectDataStore = create((set, get) => ({
  // Raw backend clips (WorkingClipResponse[])
  clips: [],

  // Currently selected clip ID (backend integer ID)
  selectedClipId: null,

  // Video metadata cache: { [clipId]: { duration, width, height, framerate, metadata } }
  clipMetadataCache: {},

  // API loading state
  clipsFetching: false,
  clipsError: null,

  // Working video (if exported) - { file, url, metadata }
  workingVideo: null,

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
    const newClips = typeof clips === 'function' ? clips(state.clips) : clips;
    return { clips: newClips };
  }),

  setSelectedClipId: (selectedClipId) => set({ selectedClipId }),

  setAspectRatio: (aspectRatio) => set({ aspectRatio }),

  setGlobalTransition: (globalTransition) => set({ globalTransition }),

  setClipMetadataCache: (clipMetadataCache) => set({ clipMetadataCache }),

  updateClipMetadata: (clipId, metadata) => set((state) => ({
    clipMetadataCache: { ...state.clipMetadataCache, [clipId]: metadata },
  })),

  // ========== Clip CRUD Operations ==========

  addClip: (clip) => set((state) => ({
    clips: [...state.clips, clip],
  })),

  deleteClip: (clipId) => set((state) => {
    const newClips = state.clips.filter((clip) => clip.id !== clipId);
    let newSelectedClipId = state.selectedClipId;

    if (state.selectedClipId === clipId) {
      newSelectedClipId = newClips.length > 0 ? newClips[0].id : null;
    }

    return { clips: newClips, selectedClipId: newSelectedClipId };
  }),

  updateClip: (clipId, data) => set((state) => ({
    clips: state.clips.map((clip) =>
      clip.id === clipId ? { ...clip, ...data } : clip
    ),
  })),

  reorderClips: (fromIndex, toIndex) => set((state) => {
    const newClips = [...state.clips];
    const [removed] = newClips.splice(fromIndex, 1);
    newClips.splice(toIndex, 0, removed);
    return { clips: newClips };
  }),

  clearClips: () => set({
    clips: [],
    selectedClipId: null,
    clipMetadataCache: {},
  }),

  // Batch update for loading project clips
  setProjectClips: ({ clips, aspectRatio }) => set((state) => ({
    clips,
    selectedClipId: clips.length > 0 ? clips[0].id : null,
    aspectRatio: aspectRatio || state.aspectRatio,
  })),

  // ========== API Methods ==========

  fetchClips: async (projectId) => {
    if (!projectId) return [];

    set({ clipsFetching: true, clipsError: null });
    try {
      const response = await fetch(`${API_BASE_URL}/clips/projects/${projectId}/clips`);
      if (!response.ok) throw new Error('Failed to fetch clips');
      const data = await response.json();
      set({ clips: data, clipsFetching: false });
      return data;
    } catch (err) {
      set({ clipsError: err.message, clipsFetching: false });
      console.error('[projectDataStore] fetchClips error:', err);
      return [];
    }
  },

  retryExtraction: async (projectId, clipId) => {
    if (!projectId) return false;

    try {
      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/${clipId}/retry-extraction`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error('Failed to retry extraction');

      // Refresh clips to get updated status
      await get().fetchClips(projectId);
      return true;
    } catch (err) {
      console.error('[projectDataStore] retryExtraction error:', err);
      return false;
    }
  },

  saveFramingEdits: async (projectId, clipId, framingData) => {
    if (!projectId) return { success: false };

    try {
      const updatePayload = {};

      if (framingData.cropKeyframes !== undefined) {
        updatePayload.crop_data = JSON.stringify(framingData.cropKeyframes);
      }
      if (framingData.segments !== undefined) {
        updatePayload.segments_data = JSON.stringify(framingData.segments);
      }
      if (framingData.trimRange !== undefined) {
        updatePayload.timing_data = JSON.stringify({ trimRange: framingData.trimRange });
      }

      if (Object.keys(updatePayload).length === 0) {
        return { success: true };
      }

      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/${clipId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload)
        }
      );
      if (!response.ok) throw new Error('Failed to save framing edits');

      const result = await response.json();

      if (result.refresh_required) {
        await get().fetchClips(projectId);
        return {
          success: true,
          newClipId: result.new_clip_id,
          newVersion: result.new_version
        };
      } else {
        // Update local raw clip with the data we just sent
        set((state) => ({
          clips: state.clips.map(c =>
            c.id === clipId ? { ...c, ...updatePayload } : c
          ),
        }));
      }

      return { success: true };
    } catch (err) {
      console.error('[projectDataStore] saveFramingEdits error:', err);
      return { success: false };
    }
  },

  addClipFromLibrary: async (projectId, rawClipId) => {
    if (!projectId) return null;

    try {
      const formData = new FormData();
      formData.append('raw_clip_id', rawClipId.toString());

      const response = await fetch(`${API_BASE_URL}/clips/projects/${projectId}/clips`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to add clip');
      const clip = await response.json();

      await get().fetchClips(projectId);
      return clip;
    } catch (err) {
      console.error('[projectDataStore] addClipFromLibrary error:', err);
      return null;
    }
  },

  uploadClipWithMetadata: async (projectId, uploadData) => {
    if (!projectId) return null;

    const { file, name, rating, tags, notes } = uploadData;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name || '');
      formData.append('rating', (rating || 3).toString());
      formData.append('tags', JSON.stringify(tags || []));
      formData.append('notes', notes || '');

      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/upload-with-metadata`,
        { method: 'POST', body: formData }
      );
      if (!response.ok) throw new Error('Failed to upload clip');
      const clip = await response.json();

      await get().fetchClips(projectId);
      return clip;
    } catch (err) {
      console.error('[projectDataStore] uploadClipWithMetadata error:', err);
      return null;
    }
  },

  removeClip: async (projectId, clipId) => {
    if (!projectId) return false;

    try {
      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/${clipId}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error('Failed to remove clip');

      await get().fetchClips(projectId);
      return true;
    } catch (err) {
      console.error('[projectDataStore] removeClip error:', err);
      return false;
    }
  },

  reorderClipsOnServer: async (projectId, clipIds) => {
    if (!projectId) return false;

    try {
      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/reorder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clipIds)
        }
      );
      if (!response.ok) throw new Error('Failed to reorder clips');

      await get().fetchClips(projectId);
      return true;
    } catch (err) {
      console.error('[projectDataStore] reorderClipsOnServer error:', err);
      return false;
    }
  },

  getClipFileUrl: (clipId, projectId) => {
    const clip = get().clips.find(c => c.id === clipId);
    if (clip?.file_url) return clip.file_url;
    if (!projectId) return null;
    return `${API_BASE_URL}/clips/projects/${projectId}/clips/${clipId}/file`;
  },

  // ========== Other Actions ==========

  setWorkingVideo: (workingVideo) => set({ workingVideo }),

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

  /**
   * Get a clip merged with its cached video metadata.
   * Returns the raw clip with duration, sourceWidth, sourceHeight, framerate added.
   */
  getClipWithMetadata: (clipId) => {
    const clip = get().clips.find(c => c.id === clipId);
    if (!clip) return null;
    const meta = get().clipMetadataCache[clipId];
    if (!meta) return clip;
    return {
      ...clip,
      duration: meta.duration,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      framerate: meta.framerate || 30,
      metadata: meta.metadata,
    };
  },

  // Clear all project data (called when switching projects)
  reset: () => set({
    clips: [],
    selectedClipId: null,
    clipMetadataCache: {},
    clipsFetching: false,
    clipsError: null,
    workingVideo: null,
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
