import { useCallback, useMemo, useEffect } from 'react';
import { useProjectDataStore, useProjectsStore } from '../stores';

/**
 * useClipManager - Manages the clip and its metadata
 *
 * T250: Uses backend integer IDs. Raw clip stored in projectDataStore.
 * Video metadata cached in clipMetadataCache. Derived values via selectors.
 * T11240: a project is exactly one clip; the multi-clip CRUD surface
 * (add/delete/reorder/select/transition/export-data) is gone.
 *
 * @see stores/projectDataStore.js for the underlying state store
 * @see utils/clipSelectors.js for derived value selectors
 */
export function useClipManager() {
  const {
    clips,
    selectedClipId,
    clipMetadataCache,
    setSelectedClipId,
    updateClip: updateClipInStore,
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
   * Update data for the clip (merges into raw clip data)
   */
  const updateClipData = useCallback((clipId, data) => {
    updateClipInStore(clipId, data);
  }, [updateClipInStore]);

  const hasClips = clips.length > 0;

  return {
    // State
    clips,
    selectedClipId,
    selectedClip,
    hasClips,
    globalAspectRatio,

    // Actions
    updateClipData,
  };
}

export default useClipManager;
