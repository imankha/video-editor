import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE_URL = 'http://localhost:8000';

/**
 * usePlayerDetection - Hook to fetch player detections for the current video frame
 *
 * Uploads the video file once, then calls the YOLO detection endpoint
 * when the frame changes (debounced).
 *
 * @param {File|Blob} videoFile - Video file to analyze
 * @param {number} currentTime - Current playhead time in seconds
 * @param {number} framerate - Video framerate (default 30)
 * @param {boolean} enabled - Whether detection is enabled
 * @param {number} confidenceThreshold - Minimum confidence for detections (default 0.5)
 * @returns {Object} { detections, isLoading, isUploading, error, videoWidth, videoHeight }
 */
export function usePlayerDetection({
  videoFile,
  currentTime,
  framerate = 30,
  enabled = false,
  confidenceThreshold = 0.5
}) {
  const [detections, setDetections] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [videoId, setVideoId] = useState(null);

  // Track the last fetched frame to avoid redundant requests
  const lastFetchedFrameRef = useRef(-1);
  const abortControllerRef = useRef(null);
  const uploadedFileRef = useRef(null);

  // Convert time to frame number
  const currentFrame = Math.round(currentTime * framerate);

  /**
   * Upload video file and get video_id
   */
  const uploadVideo = useCallback(async (file) => {
    if (!file) return null;

    // Check if already uploaded this file
    if (uploadedFileRef.current === file && videoId) {
      return videoId;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('video', file, file.name || 'video.mp4');

      const response = await fetch(`${API_BASE_URL}/api/detect/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Upload failed: ${response.status}`);
      }

      const data = await response.json();

      uploadedFileRef.current = file;
      setVideoId(data.video_id);

      console.log('[usePlayerDetection] Video uploaded:', data.video_id);

      return data.video_id;

    } catch (err) {
      console.error('[usePlayerDetection] Upload error:', err);
      setError(`Upload failed: ${err.message}`);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [videoId]);

  /**
   * Delete uploaded video
   */
  const deleteVideo = useCallback(async (id) => {
    if (!id) return;

    try {
      await fetch(`${API_BASE_URL}/api/detect/upload/${id}`, {
        method: 'DELETE'
      });
      console.log('[usePlayerDetection] Video deleted:', id);
    } catch (err) {
      console.warn('[usePlayerDetection] Failed to delete video:', err);
    }
  }, []);

  /**
   * Fetch detections for the current frame
   */
  const fetchDetections = useCallback(async (frameNumber, vId) => {
    if (!vId || !enabled) {
      setDetections([]);
      return;
    }

    // Don't fetch if we already have this frame
    if (frameNumber === lastFetchedFrameRef.current) {
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/detect/players`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_id: vId,
          frame_number: frameNumber,
          confidence_threshold: confidenceThreshold
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Detection failed: ${response.status}`);
      }

      const data = await response.json();

      lastFetchedFrameRef.current = frameNumber;
      setDetections(data.detections || []);
      setVideoDimensions({
        width: data.video_width,
        height: data.video_height
      });

    } catch (err) {
      if (err.name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }
      console.error('[usePlayerDetection] Error fetching detections:', err);
      setError(err.message);
      setDetections([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, confidenceThreshold]);

  // Upload video when enabled and file is available
  useEffect(() => {
    if (!enabled || !videoFile) {
      return;
    }

    // Upload if not already uploaded
    if (uploadedFileRef.current !== videoFile) {
      uploadVideo(videoFile);
    }
  }, [enabled, videoFile, uploadVideo]);

  // Fetch detections when frame changes
  useEffect(() => {
    if (!enabled || !videoId) {
      setDetections([]);
      lastFetchedFrameRef.current = -1;
      return;
    }

    // Debounce the fetch by 150ms to avoid too many requests during scrubbing
    const timeoutId = setTimeout(() => {
      fetchDetections(currentFrame, videoId);
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [currentFrame, enabled, videoId, fetchDetections]);

  // Clean up on unmount or when disabled
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Clean up uploaded video when component unmounts
      if (videoId) {
        deleteVideo(videoId);
      }
    };
  }, []);

  // Clean up when detection is disabled
  useEffect(() => {
    if (!enabled && videoId) {
      deleteVideo(videoId);
      setVideoId(null);
      uploadedFileRef.current = null;
      setDetections([]);
      lastFetchedFrameRef.current = -1;
    }
  }, [enabled, videoId, deleteVideo]);

  // Reset when video file changes
  useEffect(() => {
    if (videoFile !== uploadedFileRef.current) {
      // New video file - clean up old one
      if (videoId) {
        deleteVideo(videoId);
        setVideoId(null);
      }
      uploadedFileRef.current = null;
      setDetections([]);
      lastFetchedFrameRef.current = -1;
    }
  }, [videoFile, videoId, deleteVideo]);

  return {
    detections,
    isLoading,
    isUploading,
    error,
    videoWidth: videoDimensions.width,
    videoHeight: videoDimensions.height,
    currentFrame,
    videoId,
    framerate
  };
}

export default usePlayerDetection;
