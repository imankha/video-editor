import { useCallback, useMemo, useEffect } from 'react';
import { useProjectDataStore, useProjectsStore } from '../stores';
import { clipCropKeyframes } from '../utils/clipSelectors';

/**
 * useClipManager - Manages the list of clips and their metadata
 *
 * T250: Uses backend integer IDs. Raw clips stored in projectDataStore.
 * Video metadata cached in clipMetadataCache. Derived values via selectors.
 *
 * @see stores/projectDataStore.js for the underlying state store
 * @see utils/clipSelectors.js for derived value selectors
 */
export function useClipManager() {
  const {
    clips,
    selectedClipId,
    globalTransition,
    clipMetadataCache,
    setSelectedClipId,
    setGlobalTransition,
    deleteClip: deleteClipFromStore,
    updateClip: updateClipInStore,
    reorderClips: reorderClipsInStore,
  } = useProjectDataStore();

  // T10980: the reel's ratio is projects.aspect_ratio and nothing else. The
  // selected project is loaded before the editor mounts (App gates on it), so
  // the fallback only covers the moment before that gate, never a real project.
  const projectAspectRatio = useProjectsStore(state => state.selectedProject?.aspect_ratio);
  const globalAspectRatio = projectAspectRatio || '9:16';

  /**
   * Get the currently selected clip object, merged with metadata cache
   */
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    const clip = clips.find(c => c.id === selectedClipId);
    if (!clip) return null;
    const meta = clipMetadataCache[clip.id];
    if (!meta) return clip;
    return {
      ...clip,
      duration: meta.duration,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      framerate: meta.framerate || 30,
      metadata: meta.metadata,
    };
  }, [clips, selectedClipId, clipMetadataCache]);

  /**
   * Effect to ensure the first clip is always selected when clips exist
   */
  useEffect(() => {
    if (clips.length > 0 && !selectedClipId) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  /**
   * Delete a clip
   */
  const deleteClip = useCallback((clipId) => {
    deleteClipFromStore(clipId);
  }, [deleteClipFromStore]);

  /**
   * Select a clip by ID (backend integer ID)
   */
  const selectClip = useCallback((clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip) {
      setSelectedClipId(clipId);
    }
  }, [clips]);

  /**
   * Reorder clips via drag-and-drop
   */
  const reorderClips = useCallback((fromIndex, toIndex) => {
    reorderClipsInStore(fromIndex, toIndex);
  }, [reorderClipsInStore]);

  /**
   * Update data for a specific clip (merges into raw clip data)
   */
  const updateClipData = useCallback((clipId, data) => {
    updateClipInStore(clipId, data);
  }, [updateClipInStore]);

  /**
   * Get export data for all clips
   */
  const getExportData = useCallback(() => {
    return {
      clips: clips.map(clip => {
        const meta = clipMetadataCache[clip.id];
        return {
          clipId: clip.id,
          fileName: clip.filename || 'clip.mp4',
          duration: meta?.duration || 0,
          sourceWidth: meta?.width || 0,
          sourceHeight: meta?.height || 0,
          segments: clip.segments_data || null,
          cropKeyframes: clipCropKeyframes(clip),
          trimRange: clip.segments_data ? (clip.segments_data.trimRange || null) : null,
        };
      }),
      globalAspectRatio,
      transition: globalTransition
    };
  }, [clips, clipMetadataCache, globalAspectRatio, globalTransition]);

  const hasClips = clips.length > 0;

  const selectedClipIndex = useMemo(() => {
    if (!selectedClipId) return -1;
    return clips.findIndex(clip => clip.id === selectedClipId);
  }, [clips, selectedClipId]);

  return {
    // State
    clips,
    selectedClipId,
    selectedClip,
    selectedClipIndex,
    hasClips,
    globalAspectRatio,
    globalTransition,

    // Actions
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalTransition,

    // Export
    getExportData,
  };
}

export default useClipManager;
