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
   * Note: Check videoRef.current.src instead of videoUrl to support overlay mode
   * where the video src is set externally (not via loadVideo)
   */
  const play = async () => {
    if (videoRef.current && videoRef.current.src) {
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
   * Note: Check videoRef.current.src to support overlay mode where video
   * is loaded externally.
   */
  const seek = (time) => {
    if (videoRef.current && videoRef.current.src) {
      // Get duration from video element if not set (overlay mode)
      const effectiveDuration = duration || videoRef.current.duration || 0;
      // Use centralized validation to prevent seeking to trimmed frames
      const validTime = clampToVisibleRange
        ? clampToVisibleRange(time)
        : Math.max(0, Math.min(time, effectiveDuration));
      videoRef.current.currentTime = validTime;
      // Immediately update React state to ensure synchronization
      // This prevents stale state issues when play is called right after seek
      setCurrentTime(validTime);
    }
  };

  /**
   * Step forward one frame
   * Uses frame-based calculation to avoid floating point accumulation errors.
   * Note: Check videoRef.current.src to support overlay mode
   */
  const stepForward = () => {
    if (videoRef.current && videoRef.current.src) {
      const framerate = getFramerate(videoRef.current);
      const effectiveDuration = duration || videoRef.current.duration || 0;
      // Convert current time to frame, add 1, convert back to time
      // This avoids floating point errors from repeatedly adding 1/framerate
      const currentFrame = Math.round(currentTime * framerate);
      const nextFrame = currentFrame + 1;
      const maxFrame = Math.floor(effectiveDuration * framerate);
      const targetFrame = Math.min(nextFrame, maxFrame);
      const newTime = targetFrame / framerate;
      seek(newTime);
    }
  };

  /**
   * Step backward one frame
   * Uses frame-based calculation to avoid floating point accumulation errors.
   * Note: Check videoRef.current.src to support overlay mode
   */
  const stepBackward = () => {
    if (videoRef.current && videoRef.current.src) {
      const framerate = getFramerate(videoRef.current);
      // Convert current time to frame, subtract 1, convert back to time
      // This avoids floating point errors from repeatedly subtracting 1/framerate
      const currentFrame = Math.round(currentTime * framerate);
      const prevFrame = currentFrame - 1;
      const targetFrame = Math.max(prevFrame, 0);
      const newTime = targetFrame / framerate;
      seek(newTime);
    }
  };

  /**
   * Restart video - resets playhead to beginning (or first visible frame if start is trimmed)
   * Note: Check videoRef.current.src to support overlay mode
   */
  const restart = () => {
    if (videoRef.current && videoRef.current.src) {
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

  // Use requestAnimationFrame for smooth time updates during playback
  // The native timeupdate event only fires ~4 times/second which causes
  // visible lag in overlay positioning. RAF gives us ~60fps updates.
  useEffect(() => {
    if (!isPlaying || !videoRef.current) return;

    let rafId;
    const updateTime = () => {
      if (videoRef.current && !isSeeking) {
        const newTime = videoRef.current.currentTime;
        setCurrentTime(newTime);
      }
      rafId = requestAnimationFrame(updateTime);
    };

    rafId = requestAnimationFrame(updateTime);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isPlaying, isSeeking]);

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
        // BUG FIX: Don't pause if we're at a valid boundary position (e.g., trimRange.start)
        // This prevents the bug where playback fails when starting from Frame 0 after front trimming
        const clampedTime = clampToVisibleRange ? clampToVisibleRange(currentTime) : currentTime;
        const epsilon = 0.01; // 10ms tolerance for floating point precision

        if (Math.abs(clampedTime - currentTime) > epsilon) {
          // We're truly in a trimmed area (not at a valid boundary), pause and seek to valid position
          pause();
          seek(clampedTime);
        }
        // Otherwise, we're at a valid boundary position, allow playback to continue
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
