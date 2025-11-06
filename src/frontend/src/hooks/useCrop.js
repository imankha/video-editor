import { useState, useCallback, useEffect } from 'react';

/**
 * Custom hook for managing crop tool state and keyframes
 * Crop tool is ALWAYS active when video is loaded
 */
export default function useCrop(videoMetadata) {
  const [aspectRatio, setAspectRatio] = useState('16:9'); // '16:9', '9:16'
  const [keyframes, setKeyframes] = useState([]);
  const [isEndKeyframeExplicit, setIsEndKeyframeExplicit] = useState(false);

  /**
   * Calculate the default crop rectangle that fits within video bounds
   * Returns the largest rectangle with the selected aspect ratio
   */
  const calculateDefaultCrop = useCallback((videoWidth, videoHeight, targetAspectRatio) => {
    if (!videoWidth || !videoHeight) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    // Parse aspect ratio (e.g., "16:9" -> 16/9)
    const [ratioW, ratioH] = targetAspectRatio.split(':').map(Number);
    const ratio = ratioW / ratioH;
    const videoRatio = videoWidth / videoHeight;

    let cropWidth, cropHeight;

    if (videoRatio > ratio) {
      // Video is wider - constrain by height
      cropHeight = videoHeight;
      cropWidth = cropHeight * ratio;
    } else {
      // Video is taller - constrain by width
      cropWidth = videoWidth;
      cropHeight = cropWidth / ratio;
    }

    // Center the crop rectangle
    const x = (videoWidth - cropWidth) / 2;
    const y = (videoHeight - cropHeight) / 2;

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(cropWidth),
      height: Math.round(cropHeight)
    };
  }, []);

  /**
   * Auto-initialize keyframes when metadata loads
   * Creates permanent keyframes at start (time=0) and end (time=duration)
   * End keyframe initially mirrors start until explicitly modified
   */
  useEffect(() => {
    if (videoMetadata?.width && videoMetadata?.height && videoMetadata?.duration && keyframes.length === 0) {
      const defaultCrop = calculateDefaultCrop(
        videoMetadata.width,
        videoMetadata.height,
        aspectRatio
      );

      console.log('[useCrop] Auto-initializing permanent keyframes at time=0 and time=duration:', defaultCrop);
      console.log('[useCrop] End keyframe will mirror start until explicitly modified');

      // Reset the explicit flag for new video
      setIsEndKeyframeExplicit(false);

      setKeyframes([
        {
          time: 0,
          ...defaultCrop
        },
        {
          time: videoMetadata.duration,
          ...defaultCrop
        }
      ]);
    }
  }, [videoMetadata, aspectRatio, keyframes.length, calculateDefaultCrop]);

  /**
   * Update aspect ratio and recalculate all keyframes
   * If end keyframe hasn't been explicitly set, both start and end get same values
   */
  const updateAspectRatio = useCallback((newRatio) => {
    console.log('[useCrop] Updating aspect ratio to:', newRatio);
    setAspectRatio(newRatio);

    // Recalculate all keyframes with new aspect ratio
    if (keyframes.length > 0 && videoMetadata?.width && videoMetadata?.height) {
      // Get the new default crop for this aspect ratio
      const newCrop = calculateDefaultCrop(
        videoMetadata.width,
        videoMetadata.height,
        newRatio
      );

      const updatedKeyframes = keyframes.map(kf => {
        // If end hasn't been explicitly set, use default for all keyframes
        if (!isEndKeyframeExplicit) {
          return {
            time: kf.time,
            ...newCrop
          };
        }

        // If end has been explicitly set, only update non-end keyframes with default
        // End keyframe keeps its custom position/size but updates to new aspect ratio
        const isEnd = Math.abs(kf.time - videoMetadata.duration) < 0.01;
        if (isEnd) {
          // Preserve end keyframe's relative position but adjust to new aspect ratio
          // For now, just recalculate - could be smarter about preserving position
          return {
            time: kf.time,
            ...newCrop
          };
        }

        return {
          time: kf.time,
          ...newCrop
        };
      });

      console.log('[useCrop] Updated keyframes for new aspect ratio (isEndExplicit:', isEndKeyframeExplicit, '):', updatedKeyframes);
      setKeyframes(updatedKeyframes);
    }
  }, [keyframes, videoMetadata, calculateDefaultCrop, isEndKeyframeExplicit]);

  /**
   * Add or update a keyframe at the specified time
   * If updating start keyframe and end hasn't been explicitly set, end mirrors start
   */
  const addOrUpdateKeyframe = useCallback((time, cropData, duration) => {
    console.log('[useCrop] Adding/updating keyframe at time', time, ':', cropData);

    // Check if we're updating the end keyframe
    const isEndKeyframe = duration && Math.abs(time - duration) < 0.01;
    const isStartKeyframe = Math.abs(time) < 0.01;

    if (isEndKeyframe) {
      console.log('[useCrop] End keyframe explicitly set by user');
      setIsEndKeyframeExplicit(true);
    }

    setKeyframes(prev => {
      // Check if keyframe exists at this time (within 10ms tolerance)
      const existingIndex = prev.findIndex(kf => Math.abs(kf.time - time) < 0.01);

      let updated;
      if (existingIndex >= 0) {
        // Update existing keyframe - set time AFTER spreading to avoid overwrite
        updated = [...prev];
        updated[existingIndex] = { ...cropData, time };
      } else {
        // Add new keyframe and sort by time
        const newKeyframes = [...prev, { ...cropData, time }];
        updated = newKeyframes.sort((a, b) => a.time - b.time);
      }

      // If updating start keyframe and end hasn't been explicitly set, mirror to end
      if (isStartKeyframe && !isEndKeyframeExplicit && duration) {
        console.log('[useCrop] Mirroring start keyframe to end (end not yet explicit)');
        const endKeyframeIndex = updated.findIndex(kf => Math.abs(kf.time - duration) < 0.01);
        if (endKeyframeIndex >= 0) {
          // Set time AFTER spreading cropData to preserve the duration time
          updated[endKeyframeIndex] = {
            ...cropData,
            time: duration
          };
        }
      }

      return updated;
    });
  }, [isEndKeyframeExplicit]);

  /**
   * Remove a keyframe at the specified time
   * Cannot remove permanent keyframes at time=0 or time=duration
   */
  const removeKeyframe = useCallback((time, duration) => {
    console.log('[useCrop] Attempting to remove keyframe at time:', time);

    // Don't allow removing permanent start/end keyframes
    if (Math.abs(time) < 0.01) {
      console.log('[useCrop] Cannot remove permanent start keyframe (time=0)');
      return;
    }
    if (duration && Math.abs(time - duration) < 0.01) {
      console.log('[useCrop] Cannot remove permanent end keyframe (time=duration)');
      return;
    }

    setKeyframes(prev => {
      // Don't allow removing if it would leave less than 2 keyframes
      if (prev.length <= 2) {
        console.log('[useCrop] Cannot remove - must have at least 2 keyframes');
        return prev;
      }
      return prev.filter(kf => Math.abs(kf.time - time) > 0.01);
    });
  }, []);

  /**
   * Interpolate crop values between keyframes for a given time
   */
  const interpolateCrop = useCallback((time) => {
    if (keyframes.length === 0) {
      return null;
    }

    // If only one keyframe, return it
    if (keyframes.length === 1) {
      return keyframes[0];
    }

    // Find surrounding keyframes
    let beforeKf = null;
    let afterKf = null;

    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i].time <= time) {
        beforeKf = keyframes[i];
      }
      if (keyframes[i].time > time && !afterKf) {
        afterKf = keyframes[i];
        break;
      }
    }

    // If before first keyframe, return first
    if (!beforeKf) {
      return keyframes[0];
    }

    // If after last keyframe, return last
    if (!afterKf) {
      return beforeKf;
    }

    // Linear interpolation between keyframes
    const duration = afterKf.time - beforeKf.time;
    const progress = (time - beforeKf.time) / duration;

    return {
      time,
      x: beforeKf.x + (afterKf.x - beforeKf.x) * progress,
      y: beforeKf.y + (afterKf.y - beforeKf.y) * progress,
      width: beforeKf.width + (afterKf.width - beforeKf.width) * progress,
      height: beforeKf.height + (afterKf.height - beforeKf.height) * progress
    };
  }, [keyframes]);

  /**
   * Check if a keyframe exists at the specified time
   */
  const hasKeyframeAt = useCallback((time) => {
    return keyframes.some(kf => Math.abs(kf.time - time) < 0.01);
  }, [keyframes]);

  /**
   * Get keyframe at specific time (if exists)
   */
  const getKeyframeAt = useCallback((time) => {
    return keyframes.find(kf => Math.abs(kf.time - time) < 0.01);
  }, [keyframes]);

  return {
    // State
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,

    // Actions
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,

    // Queries
    interpolateCrop,
    hasKeyframeAt,
    getKeyframeAt,
    calculateDefaultCrop
  };
}
