import { useRef, useState, useCallback } from 'react';

/**
 * useStandaloneVideo - Self-contained video state management hook
 *
 * Used by GalleryVideoPlayer for internal state management.
 * Different from useVideo which manages editor state with stores.
 *
 * @param {Object} options
 * @param {boolean} options.autoPlay - Whether to auto-play on load
 * @returns {Object} Video state and handlers
 */
export function useStandaloneVideo({ autoPlay = true } = {}) {
  const videoRef = useRef(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Volume state
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(null);
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  const loadStartTimeRef = useRef(null);

  // Error state
  const [error, setError] = useState(null);

  // Playback controls
  const play = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      await videoRef.current.play();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[useStandaloneVideo] Play error:', err);
        setError(err.message);
      }
    }
  }, []);

  const pause = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.pause();
  }, []);

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, play, pause]);

  // Seek controls
  const seek = useCallback((time) => {
    if (!videoRef.current) return;
    const clampedTime = Math.max(0, Math.min(time, duration));
    videoRef.current.currentTime = clampedTime;
  }, [duration]);

  const seekForward = useCallback((seconds = 5) => {
    if (!videoRef.current) return;
    const newTime = Math.min(currentTime + seconds, duration);
    videoRef.current.currentTime = newTime;
  }, [currentTime, duration]);

  const seekBackward = useCallback((seconds = 5) => {
    if (!videoRef.current) return;
    const newTime = Math.max(currentTime - seconds, 0);
    videoRef.current.currentTime = newTime;
  }, [currentTime]);

  // Volume controls
  const setVolumeLevel = useCallback((newVolume) => {
    if (!videoRef.current) return;
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    videoRef.current.volume = clampedVolume;
    setVolume(clampedVolume);
    setIsMuted(clampedVolume === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
  }, [isMuted]);

  // Video element event handlers
  const handlers = {
    onLoadStart: useCallback(() => {
      setIsLoading(true);
      setLoadingProgress(null);
      setLoadingElapsedSeconds(0);
      setError(null);
      loadStartTimeRef.current = performance.now();
    }, []),

    onLoadedMetadata: useCallback(() => {
      if (videoRef.current) {
        setDuration(videoRef.current.duration);
      }
    }, []),

    onCanPlay: useCallback(() => {
      setIsLoading(false);
    }, []),

    onPlay: useCallback(() => {
      setIsPlaying(true);
    }, []),

    onPause: useCallback(() => {
      setIsPlaying(false);
    }, []),

    onTimeUpdate: useCallback(() => {
      if (videoRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
    }, []),

    onWaiting: useCallback(() => {
      setIsLoading(true);
    }, []),

    onPlaying: useCallback(() => {
      setIsLoading(false);
    }, []),

    onProgress: useCallback(() => {
      if (!videoRef.current || !isLoading) return;
      const video = videoRef.current;

      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const targetBuffer = Math.min(5, video.duration || 5);
        const progress = Math.min(99, Math.round((bufferedEnd / targetBuffer) * 100));
        setLoadingProgress(progress);
      }

      // Update elapsed time
      if (loadStartTimeRef.current) {
        const elapsed = Math.floor((performance.now() - loadStartTimeRef.current) / 1000);
        setLoadingElapsedSeconds(elapsed);
      }
    }, [isLoading]),

    onError: useCallback((e) => {
      const errorMsg = e.target?.error?.message || 'Video failed to load';
      console.error('[useStandaloneVideo] Error:', errorMsg);
      setError(errorMsg);
      setIsLoading(false);
    }, []),
  };

  return {
    // Ref
    videoRef,

    // State
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isLoading,
    loadingProgress,
    loadingElapsedSeconds,
    error,

    // Actions
    play,
    pause,
    togglePlay,
    seek,
    seekForward,
    seekBackward,
    setVolume: setVolumeLevel,
    toggleMute,

    // Event handlers for video element
    handlers,
  };
}

export default useStandaloneVideo;
