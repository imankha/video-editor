import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../../../config';

const API_BASE_URL = API_BASE;

/**
 * usePlayerDetection - Hook to fetch player detections for the current video frame
 *
 * BEHAVIOR:
 * - Player detection now runs automatically during framing export (U8)
 * - This hook checks cache for any pre-existing detections
 * - Shows detection boxes when cached results are available
 * - User can toggle detection boxes on/off
 *
 * @param {number} projectId - Project ID (backend looks up working video R2 path)
 * @param {number} currentTime - Current playhead time in seconds
 * @param {number} framerate - Video framerate (default 30)
 * @param {boolean} enabled - Whether detection UI is enabled (in overlay mode + in region)
 * @param {number} confidenceThreshold - Minimum confidence for detections (default 0.5)
 * @returns {Object} { detections, isLoading, isCached, ... }
 */
export function usePlayerDetection({
  projectId,
  currentTime,
  framerate = 30,
  enabled = false,
  confidenceThreshold = 0.5
}) {
  const [detections, setDetections] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [error, setError] = useState(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });

  // Track the last checked/fetched frame to avoid redundant requests
  const lastCheckedFrameRef = useRef(-1);
  const abortControllerRef = useRef(null);

  // Convert time to frame number
  const currentFrame = Math.round(currentTime * framerate);

  /**
   * Check if detection is cached for current frame
   * Returns cached detections if available
   */
  const checkCache = useCallback(async (frameNumber) => {
    if (!projectId) return null;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/detect/cache/${projectId}/${frameNumber}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (err) {
      console.warn('[usePlayerDetection] Cache check failed:', err);
      return null;
    }
  }, [projectId]);

  /**
   * Check cache when frame changes (auto-fetch cached results)
   */
  useEffect(() => {
    if (!enabled || !projectId) {
      setDetections([]);
      setIsCached(false);
      lastCheckedFrameRef.current = -1;
      return;
    }

    // Don't re-check if we already checked this frame
    if (currentFrame === lastCheckedFrameRef.current) {
      return;
    }

    // Check cache for new frame
    const checkFrameCache = async () => {
      const cacheResult = await checkCache(currentFrame);

      if (cacheResult?.cached) {
        // Frame is cached - show detections automatically
        setDetections(cacheResult.detections || []);
        setVideoDimensions({
          width: cacheResult.video_width || 0,
          height: cacheResult.video_height || 0
        });
        setIsCached(true);
        console.log('[usePlayerDetection] Cache hit for frame', currentFrame);
      } else {
        // Frame not cached - clear detections, user must click button
        setDetections([]);
        setIsCached(false);
        console.log('[usePlayerDetection] Cache miss for frame', currentFrame);
      }

      lastCheckedFrameRef.current = currentFrame;
    };

    // Debounce cache check to avoid excessive requests during scrubbing
    const timeoutId = setTimeout(checkFrameCache, 100);
    return () => clearTimeout(timeoutId);

  }, [currentFrame, enabled, projectId, checkCache]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Reset when projectId changes
  useEffect(() => {
    setDetections([]);
    setIsCached(false);
    lastCheckedFrameRef.current = -1;
    setError(null);
  }, [projectId]);

  return {
    detections,
    isLoading,
    isCached,
    error,
    videoWidth: videoDimensions.width,
    videoHeight: videoDimensions.height,
    currentFrame,
    framerate,
  };
}

export default usePlayerDetection;
