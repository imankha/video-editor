import { useState, useRef, useEffect } from 'react';
import { extractVideoMetadata, createVideoURL, revokeVideoURL, getFramerate } from '../utils/videoUtils';
import { validateVideoFile } from '../utils/fileValidation';

/**
 * Custom hook for managing video state and playback
 * @param {Function} getSegmentAtTime - Optional function to get segment info at a given time
 * @param {Function} clampToVisibleRange - Optional function to clamp time to visible (non-trimmed) range
 * @returns {Object} Video state and control functions
 */
export function useVideo(getSegmentAtTime = null, clampToVisibleRange = null) {
  const videoRef = useRef(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Load a video file
   * @param {File} file - Video file to load
   */
  const loadVideo = async (file) => {
    setError(null);
    setIsLoading(true);

    // Validate file
    const validation = validateVideoFile(file);
    if (!validation.isValid) {
      setError(validation.error);
      setIsLoading(false);
      return;
    }

    try {
      // Clean up previous video
      if (videoUrl) {
        revokeVideoURL(videoUrl);
        setIsPlaying(false);
      }

      // Extract metadata
      const videoMetadata = await extractVideoMetadata(file);

      // Create blob URL
      const url = createVideoURL(file);

      setVideoFile(file);
      setVideoUrl(url);
      setMetadata(videoMetadata);
      setDuration(videoMetadata.duration);
      setCurrentTime(0);
      setIsLoading(false);
    } catch (err) {
      setError(err.message || 'Failed to load video');
      setIsLoading(false);
    }
  };

  /**
   * Play video - handles promise to prevent race conditions
   */
  const play = async () => {
    if (videoRef.current && videoUrl) {
      try {
        // video.play() returns a promise - must handle it
        await videoRef.current.play();
      } catch (error) {
        // Ignore AbortError - happens when play() is interrupted by pause()
        if (error.name !== 'AbortError') {
          console.error('Video play error:', error);
        }
      }
    }
  };

  /**
   * Pause video
   */
  const pause = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  /**
   * Toggle play/pause - async to handle play() promise
   */
  const togglePlay = async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  };

  /**
   * Seek to specific time
   * @param {number} time - Target time in seconds
   *
   * ARCHITECTURE: All seeks go through clampToVisibleRange to prevent
   * seeking to trimmed frames. This is the single validation point.
   */
  const seek = (time) => {
    if (videoRef.current && videoUrl) {
      // Use centralized validation to prevent seeking to trimmed frames
      const validTime = clampToVisibleRange
        ? clampToVisibleRange(time)
        : Math.max(0, Math.min(time, duration));
      videoRef.current.currentTime = validTime;
    }
  };

  /**
   * Step forward one frame
   */
  const stepForward = () => {
    if (videoRef.current && metadata) {
      const framerate = getFramerate(videoRef.current);
      const frameDuration = 1 / framerate;
      const newTime = Math.min(currentTime + frameDuration, duration);
      seek(newTime);
    }
  };

  /**
   * Step backward one frame
   */
  const stepBackward = () => {
    if (videoRef.current && metadata) {
      const framerate = getFramerate(videoRef.current);
      const frameDuration = 1 / framerate;
      const newTime = Math.max(currentTime - frameDuration, 0);
      seek(newTime);
    }
  };

  /**
   * Restart video - resets playhead to beginning (or first visible frame if start is trimmed)
   */
  const restart = () => {
    if (videoRef.current && videoUrl) {
      pause();
      // seek(0) will automatically clamp to first visible frame if start is trimmed
      seek(0);
    }
  };

  // Video element event handlers
  const handleTimeUpdate = () => {
    if (videoRef.current && !isSeeking) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleSeeking = () => {
    setIsSeeking(true);
  };

  const handleSeeked = () => {
    setIsSeeking(false);
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  // Adjust playback rate based on current segment speed
  // ARCHITECTURE: We need BOTH proactive and reactive validation:
  // - Proactive (clampToVisibleRange): Prevents manual seeks to trimmed frames
  // - Reactive (below): Stops playback when naturally hitting trim boundaries
  useEffect(() => {
    if (!videoRef.current || !getSegmentAtTime) return;

    const segment = getSegmentAtTime(currentTime);
    if (segment) {
      // Set playback rate based on segment speed
      videoRef.current.playbackRate = segment.speed;

      // If playing and in a trimmed segment, pause at the boundary
      // This handles continuous playback reaching the end of visible content
      if (isPlaying && segment.isTrimmed) {
        pause();
        // Use clampToVisibleRange to find the correct boundary
        // This will automatically put us at the right edge of visible content
        if (clampToVisibleRange) {
          seek(clampToVisibleRange(currentTime));
        }
      }
    } else {
      // No segment info, use normal playback
      videoRef.current.playbackRate = 1;
    }
  }, [currentTime, getSegmentAtTime, isPlaying, clampToVisibleRange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) {
        revokeVideoURL(videoUrl);
      }
    };
  }, [videoUrl]);

  return {
    // Refs
    videoRef,

    // State
    videoFile,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    isSeeking,
    error,
    isLoading,

    // Actions
    loadVideo,
    play,
    pause,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,

    // Event handlers for video element
    handlers: {
      onTimeUpdate: handleTimeUpdate,
      onPlay: handlePlay,
      onPause: handlePause,
      onSeeking: handleSeeking,
      onSeeked: handleSeeked,
      onLoadedMetadata: handleLoadedMetadata,
    }
  };
}
