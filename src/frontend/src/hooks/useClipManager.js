import { useCallback, useMemo, useEffect } from 'react';
import { useProjectDataStore } from '../stores';
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
    aspectRatio: globalAspectRatio,
    globalTransition,
    clipMetadataCache,
    setClips,
    setSelectedClipId,
    setAspectRatio: setGlobalAspectRatioState,
    setGlobalTransition,
    addClip: addClipToStore,
    deleteClip: deleteClipFromStore,
    updateClip: updateClipInStore,
    reorderClips: reorderClipsInStore,
    clearClips: clearAllClips,
  } = useProjectDataStore();

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
   * Calculate the centered crop rectangle for a given aspect ratio
   */
  const calculateCenteredCrop = useCallback((sourceWidth, sourceHeight, aspectRatio) => {
    if (!sourceWidth || !sourceHeight) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
    const targetRatio = ratioW / ratioH;
    const videoRatio = sourceWidth / sourceHeight;

    let cropWidth, cropHeight;

    if (videoRatio > targetRatio) {
      cropHeight = sourceHeight;
      cropWidth = cropHeight * targetRatio;
    } else {
      cropWidth = sourceWidth;
      cropHeight = cropWidth / targetRatio;
    }

    const x = (sourceWidth - cropWidth) / 2;
    const y = (sourceHeight - cropHeight) / 2;

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(cropWidth),
      height: Math.round(cropHeight)
    };
  }, []);

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
   * Update the global aspect ratio.
   * Preserves relative offsets of crop keyframes for all clips.
   *
   * Reads crop_data from raw clip JSON and dimensions from clipMetadataCache.
   */
  const setGlobalAspectRatio = useCallback((newAspectRatio) => {
    const oldAspectRatio = globalAspectRatio;

    setGlobalAspectRatioState(newAspectRatio);

    // Update all clips' crop keyframes preserving offsets
    setClips(prev => prev.map(clip => {
      const cropKeyframes = clipCropKeyframes(clip);
      if (!cropKeyframes || cropKeyframes.length === 0) {
        return clip;
      }

      const meta = clipMetadataCache[clip.id];
      const sourceWidth = meta?.width || 0;
      const sourceHeight = meta?.height || 0;
      if (!sourceWidth || !sourceHeight) return clip;

      const oldCenteredCrop = calculateCenteredCrop(sourceWidth, sourceHeight, oldAspectRatio);
      const newCenteredCrop = calculateCenteredCrop(sourceWidth, sourceHeight, newAspectRatio);

      const newKeyframes = cropKeyframes.map(kf => {
        const offsetX = kf.x - oldCenteredCrop.x;
        const offsetY = kf.y - oldCenteredCrop.y;

        let newX = newCenteredCrop.x + offsetX;
        let newY = newCenteredCrop.y + offsetY;

        newX = Math.max(0, Math.min(newX, sourceWidth - newCenteredCrop.width));
        newY = Math.max(0, Math.min(newY, sourceHeight - newCenteredCrop.height));

        return {
          ...kf,
          x: Math.round(newX),
          y: Math.round(newY),
          width: newCenteredCrop.width,
          height: newCenteredCrop.height
        };
      });

      // Store updated keyframes back as JSON in crop_data
      return { ...clip, crop_data: JSON.stringify(newKeyframes) };
    }));
  }, [globalAspectRatio, calculateCenteredCrop, setGlobalAspectRatioState, setClips, clipMetadataCache]);

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
          segments: clip.segments_data ? JSON.parse(clip.segments_data) : null,
          cropKeyframes: clipCropKeyframes(clip),
          trimRange: clip.timing_data ? (JSON.parse(clip.timing_data).trimRange || null) : null,
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
    setGlobalAspectRatio,
    setGlobalTransition,

    // Export
    getExportData,

    // Helpers
    calculateCenteredCrop,
  };
}

export default useClipManager;
