import { useState, useRef, useEffect } from 'react';
import { extractVideoMetadata, createVideoURL, revokeVideoURL, getFramerate } from '../utils/videoUtils';
import { validateVideoFile } from '../utils/fileValidation';

/**
 * Custom hook for managing video state and playback
 * @returns {Object} Video state and control functions
 */
export function useVideo() {
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
   */
  const seek = (time) => {
    if (videoRef.current && videoUrl) {
      videoRef.current.currentTime = Math.max(0, Math.min(time, duration));
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
