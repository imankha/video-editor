import { useState, useCallback, useMemo } from 'react';

/**
 * Custom hook for managing crop tool state and keyframes
 * Handles crop rectangle position, size, and keyframe interpolation
 */
export default function useCrop(videoMetadata) {
  const [isCropActive, setIsCropActive] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('16:9'); // '16:9', '9:16', 'free'
  const [keyframes, setKeyframes] = useState([]);

  /**
   * Calculate the default crop rectangle that fits within video bounds
   * Returns the largest rectangle with the selected aspect ratio
   */
  const calculateDefaultCrop = useCallback((videoWidth, videoHeight, targetAspectRatio) => {
    if (!videoWidth || !videoHeight) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let cropWidth, cropHeight;

    if (targetAspectRatio === 'free') {
      // Free aspect ratio - use full video dimensions
      cropWidth = videoWidth;
      cropHeight = videoHeight;
    } else {
      // Parse aspect ratio (e.g., "16:9" -> 16/9)
      const [ratioW, ratioH] = targetAspectRatio.split(':').map(Number);
      const ratio = ratioW / ratioH;
      const videoRatio = videoWidth / videoHeight;

      if (videoRatio > ratio) {
        // Video is wider - constrain by height
        cropHeight = videoHeight;
        cropWidth = cropHeight * ratio;
      } else {
        // Video is taller - constrain by width
        cropWidth = videoWidth;
        cropHeight = cropWidth / ratio;
      }
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
   * Activate the crop tool and add initial keyframe
   */
  const activateCropTool = useCallback(() => {
    if (!videoMetadata?.videoWidth || !videoMetadata?.videoHeight) {
      console.warn('Cannot activate crop tool: video metadata not available');
      return;
    }

    setIsCropActive(true);

    // Create initial keyframe at time 0 if no keyframes exist
    if (keyframes.length === 0) {
      const defaultCrop = calculateDefaultCrop(
        videoMetadata.videoWidth,
        videoMetadata.videoHeight,
        aspectRatio
      );

      setKeyframes([{
        time: 0,
        ...defaultCrop
      }]);
    }
  }, [videoMetadata, aspectRatio, keyframes.length, calculateDefaultCrop]);

  /**
   * Deactivate the crop tool
   */
  const deactivateCropTool = useCallback(() => {
    setIsCropActive(false);
  }, []);

  /**
   * Remove all crop keyframes and deactivate
   */
  const clearCrop = useCallback(() => {
    setKeyframes([]);
    setIsCropActive(false);
  }, []);

  /**
   * Update aspect ratio and recalculate all keyframes
   */
  const updateAspectRatio = useCallback((newRatio) => {
    setAspectRatio(newRatio);

    // Recalculate all keyframes with new aspect ratio
    if (keyframes.length > 0 && videoMetadata?.videoWidth && videoMetadata?.videoHeight) {
      const updatedKeyframes = keyframes.map(kf => {
        const newCrop = calculateDefaultCrop(
          videoMetadata.videoWidth,
          videoMetadata.videoHeight,
          newRatio
        );
        return {
          time: kf.time,
          ...newCrop
        };
      });
      setKeyframes(updatedKeyframes);
    }
  }, [keyframes, videoMetadata, calculateDefaultCrop]);

  /**
   * Add or update a keyframe at the specified time
   */
  const addOrUpdateKeyframe = useCallback((time, cropData) => {
    setKeyframes(prev => {
      // Check if keyframe exists at this time (within 10ms tolerance)
      const existingIndex = prev.findIndex(kf => Math.abs(kf.time - time) < 0.01);

      if (existingIndex >= 0) {
        // Update existing keyframe
        const updated = [...prev];
        updated[existingIndex] = { time, ...cropData };
        return updated;
      } else {
        // Add new keyframe and sort by time
        const newKeyframes = [...prev, { time, ...cropData }];
        return newKeyframes.sort((a, b) => a.time - b.time);
      }
    });
  }, []);

  /**
   * Remove a keyframe at the specified time
   */
  const removeKeyframe = useCallback((time) => {
    setKeyframes(prev => prev.filter(kf => Math.abs(kf.time - time) > 0.01));
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
    isCropActive,
    aspectRatio,
    keyframes,

    // Actions
    activateCropTool,
    deactivateCropTool,
    clearCrop,
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
