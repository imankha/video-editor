import { useState, useCallback, useMemo, useEffect } from 'react';

/**
 * useClipManager - Manages the list of clips and their metadata
 *
 * Each clip stores:
 * - id: unique identifier (local or from backend working_clip_id)
 * - file: the File object (null for project clips loaded from URL)
 * - fileUrl: URL to fetch clip (for project clips)
 * - workingClipId: backend working_clips.id (for project clips)
 * - fileName: display name
 * - fileNameDisplay: name without extension
 * - duration: video duration in seconds
 * - sourceWidth, sourceHeight: video dimensions
 * - segments: segment data for this clip (boundaries, speeds, trimRange)
 * - cropKeyframes: crop keyframes for this clip
 *
 * The hook manages:
 * - clips: array of all clips
 * - selectedClipId: currently selected clip
 * - globalAspectRatio: shared aspect ratio across all clips
 * - globalTransition: transition settings between clips
 */
export function useClipManager() {
  // Array of clip objects
  const [clips, setClips] = useState([]);

  // Currently selected clip ID
  const [selectedClipId, setSelectedClipId] = useState(null);

  // Global aspect ratio (applies to all clips)
  const [globalAspectRatio, setGlobalAspectRatioState] = useState('9:16');

  // Global transition settings
  const [globalTransition, setGlobalTransition] = useState({
    type: 'cut',
    duration: 0.5
  });

  /**
   * Generate a unique clip ID
   */
  const generateClipId = useCallback(() => {
    return 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }, []);

  /**
   * Get the currently selected clip object
   */
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    return clips.find(clip => clip.id === selectedClipId) || null;
  }, [clips, selectedClipId]);

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
      // Video is wider - constrain by height
      cropHeight = sourceHeight;
      cropWidth = cropHeight * targetRatio;
    } else {
      // Video is taller - constrain by width
      cropWidth = sourceWidth;
      cropHeight = cropWidth / targetRatio;
    }

    // Center the crop rectangle
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
   * Add a new clip
   * @param {File} file - The video file
   * @param {Object} metadata - Video metadata (duration, width, height, etc.)
   * @returns {string} - The new clip's ID
   */
  const addClip = useCallback((file, metadata) => {
    const id = generateClipId();
    const fileName = file.name;
    const fileNameDisplay = fileName.replace(/\.[^/.]+$/, ''); // Remove extension

    const newClip = {
      id,
      file,
      fileName,
      fileNameDisplay,
      duration: metadata.duration,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      framerate: metadata.framerate || 30,
      // Annotate metadata (if clip came from Annotate mode)
      annotateName: metadata.annotateName || null,
      annotateNotes: metadata.annotateNotes || null,
      annotateStartTime: metadata.annotateStartTime || null,
      annotateEndTime: metadata.annotateEndTime || null,
      // Initialize with empty state - will be populated when clip is first selected
      segments: {
        boundaries: [0, metadata.duration],
        userSplits: [],
        trimRange: null,
        segmentSpeeds: {}
      },
      cropKeyframes: [], // Will be initialized when clip is loaded
      trimRange: null
    };

    setClips(prev => [...prev, newClip]);

    return id;
  }, [generateClipId]);

  /**
   * Add a clip from a project (loaded from backend)
   * @param {Object} projectClip - Clip data from backend API
   * @param {string} fileUrl - URL to fetch the clip video
   * @param {Object} metadata - Video metadata (duration, width, height, etc.)
   * @returns {string} - The new clip's ID
   */
  const addClipFromProject = useCallback((projectClip, fileUrl, metadata) => {
    const id = generateClipId();
    const fileName = projectClip.filename || 'clip.mp4';
    const fileNameDisplay = fileName.replace(/\.[^/.]+$/, '');

    // Parse saved framing edits if they exist
    let savedCropKeyframes = [];
    let savedSegments = null;
    let savedTrimRange = null;

    if (projectClip.crop_data) {
      try {
        savedCropKeyframes = JSON.parse(projectClip.crop_data);
      } catch (e) {
        console.warn('[useClipManager] Failed to parse crop_data:', e);
      }
    }

    if (projectClip.segments_data) {
      try {
        savedSegments = JSON.parse(projectClip.segments_data);
      } catch (e) {
        console.warn('[useClipManager] Failed to parse segments_data:', e);
      }
    }

    if (projectClip.timing_data) {
      try {
        const timingData = JSON.parse(projectClip.timing_data);
        savedTrimRange = timingData.trimRange || null;
      } catch (e) {
        console.warn('[useClipManager] Failed to parse timing_data:', e);
      }
    }

    const newClip = {
      id,
      file: null, // No file for project clips
      fileUrl,
      workingClipId: projectClip.id, // Backend working_clips.id
      fileName,
      fileNameDisplay,
      duration: metadata.duration,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      framerate: metadata.framerate || 30,
      // Clip metadata from raw_clips
      annotateName: projectClip.name || null,
      annotateNotes: projectClip.notes || null,
      annotateStartTime: null,
      annotateEndTime: null,
      // Restored framing edits or defaults
      segments: savedSegments || {
        boundaries: [0, metadata.duration],
        userSplits: [],
        trimRange: null,
        segmentSpeeds: {}
      },
      cropKeyframes: savedCropKeyframes,
      trimRange: savedTrimRange
    };

    setClips(prev => [...prev, newClip]);

    return id;
  }, [generateClipId]);

  /**
   * Load all clips from a project
   * @param {Array} projectClips - Array of clip data from backend
   * @param {Function} getClipFileUrl - Function to generate clip file URL
   * @param {Function} getVideoMetadata - Async function to get video metadata from URL
   * @param {string} projectAspectRatio - Project's aspect ratio
   * @returns {Promise<string[]>} - Array of created clip IDs
   */
  const loadProjectClips = useCallback(async (projectClips, getClipFileUrl, getVideoMetadata, projectAspectRatio) => {
    // Clear existing clips
    setClips([]);
    setSelectedClipId(null);

    if (projectAspectRatio) {
      setGlobalAspectRatioState(projectAspectRatio);
    }

    // Fetch all metadata in parallel for faster loading
    const clipPromises = projectClips.map(async (projectClip) => {
      const fileUrl = getClipFileUrl(projectClip.id);
      try {
        const metadata = await getVideoMetadata(fileUrl);
        return { projectClip, fileUrl, metadata, success: true };
      } catch (error) {
        console.error('[useClipManager] Failed to load clip:', projectClip.id, error);
        return { projectClip, fileUrl, metadata: null, success: false };
      }
    });

    const results = await Promise.all(clipPromises);

    // Add clips in order (preserving sort order)
    const createdIds = [];
    for (const result of results) {
      if (result.success && result.metadata) {
        const clipId = addClipFromProject(result.projectClip, result.fileUrl, result.metadata);
        createdIds.push(clipId);
      }
    }

    return createdIds;
  }, [addClipFromProject]);

  /**
   * Clear all clips (used when switching projects)
   */
  const clearClips = useCallback(() => {
    setClips([]);
    setSelectedClipId(null);
  }, []);

  /**
   * Effect to ensure the first clip is always selected when clips exist
   * This handles the case where clips are added but none is selected
   */
  useEffect(() => {
    if (clips.length > 0 && !selectedClipId) {
      // Select the first clip (top of the list)
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  /**
   * Delete a clip
   * @param {string} clipId - ID of the clip to delete
   */
  const deleteClip = useCallback((clipId) => {
    setClips(prev => {
      const newClips = prev.filter(clip => clip.id !== clipId);

      // If we deleted the selected clip, select another one
      if (selectedClipId === clipId) {
        if (newClips.length > 0) {
          // Select the first remaining clip
          setSelectedClipId(newClips[0].id);
        } else {
          setSelectedClipId(null);
        }
      }

      return newClips;
    });
  }, [selectedClipId]);

  /**
   * Select a clip by ID
   * @param {string} clipId - ID of the clip to select
   */
  const selectClip = useCallback((clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip) {
      setSelectedClipId(clipId);
    }
  }, [clips]);

  /**
   * Reorder clips via drag-and-drop
   * @param {number} fromIndex - Source index
   * @param {number} toIndex - Destination index
   */
  const reorderClips = useCallback((fromIndex, toIndex) => {
    setClips(prev => {
      const newClips = [...prev];
      const [removed] = newClips.splice(fromIndex, 1);
      newClips.splice(toIndex, 0, removed);
      return newClips;
    });
  }, []);

  /**
   * Update data for a specific clip
   * @param {string} clipId - ID of the clip to update
   * @param {Object} data - Data to merge into the clip
   */
  const updateClipData = useCallback((clipId, data) => {
    setClips(prev => prev.map(clip => {
      if (clip.id !== clipId) return clip;
      return { ...clip, ...data };
    }));
  }, []);

  /**
   * Update the global aspect ratio
   * Preserves relative offsets of crop keyframes for all clips
   *
   * Algorithm:
   * 1. Calculate the OLD centered crop for the old aspect ratio
   * 2. Calculate the NEW centered crop for the new aspect ratio
   * 3. For each keyframe, compute the offset from the old centered crop
   * 4. Apply that offset to the new centered crop (with boundary clamping)
   */
  const setGlobalAspectRatio = useCallback((newAspectRatio) => {
    const oldAspectRatio = globalAspectRatio;

    // Update the global state
    setGlobalAspectRatioState(newAspectRatio);

    // Update all clips' crop keyframes preserving offsets
    setClips(prev => prev.map(clip => {
      if (!clip.cropKeyframes || clip.cropKeyframes.length === 0) {
        return clip;
      }

      // Calculate old and new centered crops for this clip's dimensions
      const oldCenteredCrop = calculateCenteredCrop(
        clip.sourceWidth,
        clip.sourceHeight,
        oldAspectRatio
      );
      const newCenteredCrop = calculateCenteredCrop(
        clip.sourceWidth,
        clip.sourceHeight,
        newAspectRatio
      );

      // Update all keyframes preserving relative offsets
      const newKeyframes = clip.cropKeyframes.map(kf => {
        // Calculate offset from old centered position
        const offsetX = kf.x - oldCenteredCrop.x;
        const offsetY = kf.y - oldCenteredCrop.y;

        // Apply offset to new centered position
        let newX = newCenteredCrop.x + offsetX;
        let newY = newCenteredCrop.y + offsetY;

        // Clamp to video bounds
        newX = Math.max(0, Math.min(newX, clip.sourceWidth - newCenteredCrop.width));
        newY = Math.max(0, Math.min(newY, clip.sourceHeight - newCenteredCrop.height));

        return {
          ...kf,
          x: Math.round(newX),
          y: Math.round(newY),
          width: newCenteredCrop.width,
          height: newCenteredCrop.height
        };
      });

      return { ...clip, cropKeyframes: newKeyframes };
    }));
  }, [globalAspectRatio, calculateCenteredCrop]);

  /**
   * Get export data for all clips
   * Returns array of clips with their individual settings plus global settings
   */
  const getExportData = useCallback(() => {
    return {
      clips: clips.map(clip => ({
        clipId: clip.id,
        fileName: clip.fileName,
        // Note: videoPath will be set when files are uploaded to backend
        duration: clip.duration,
        sourceWidth: clip.sourceWidth,
        sourceHeight: clip.sourceHeight,
        segments: clip.segments,
        cropKeyframes: clip.cropKeyframes,
        trimRange: clip.trimRange
      })),
      globalAspectRatio,
      transition: globalTransition
    };
  }, [clips, globalAspectRatio, globalTransition]);

  /**
   * Check if there are any clips
   */
  const hasClips = clips.length > 0;

  /**
   * Get the index of the selected clip
   */
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
    addClip,
    addClipFromProject,
    loadProjectClips,
    clearClips,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,

    // Export
    getExportData,

    // Helpers
    calculateCenteredCrop
  };
}

export default useClipManager;
