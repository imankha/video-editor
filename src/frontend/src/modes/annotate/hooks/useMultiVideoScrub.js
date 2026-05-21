import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { buildFullVideoTimeline } from './useVirtualTimeline';
import { classifyVideoError, VideoErrorKind } from '../../../utils/videoErrorClassifier';

/**
 * useMultiVideoScrub -- Dual-video scrub for unified multi-video annotate mode.
 *
 * Adapted from useAnnotationPlayback's ping-pong pattern but for full-video
 * scrubbing instead of clip-to-clip playback. Two <video> elements overlap;
 * only one is visible at a time (CSS opacity). When the user scrubs across a
 * video boundary, visibility swaps instantly.
 *
 * Returns null when gameVideos is null/single-video (after all hooks are called).
 */
export function useMultiVideoScrub({ gameVideos, playbackRate = 1, onRefreshUrls = null }) {
  const isMulti = !!gameVideos && gameVideos.length > 1;

  const videoARef = useRef(null);
  const videoBRef = useRef(null);
  const activeVideoRef = useRef('A');
  const currentVideoIndexRef = useRef(0);
  const rafIdRef = useRef(null);
  const isPlayingRef = useRef(false);
  const playbackRateRef = useRef(playbackRate);
  const retryCountRef = useRef(0);
  const pendingSwapRef = useRef(null);
  const MAX_RETRY_ATTEMPTS = 2;

  const [virtualTime, setVirtualTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeVideoLabel, setActiveVideoLabel] = useState('A');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fullTimeline = useMemo(
    () => isMulti ? buildFullVideoTimeline(gameVideos) : null,
    [gameVideos, isMulti],
  );

  const getVideos = useCallback(() => {
    const isA = activeVideoRef.current === 'A';
    return {
      active: isA ? videoARef.current : videoBRef.current,
      inactive: isA ? videoBRef.current : videoARef.current,
    };
  }, []);

  const swapVideos = useCallback(() => {
    activeVideoRef.current = activeVideoRef.current === 'A' ? 'B' : 'A';
    setActiveVideoLabel(activeVideoRef.current);
  }, []);

  const getVideoUrl = useCallback((index) => {
    if (!gameVideos) return null;
    const v = gameVideos[index];
    return v?.url || v?.serverUrl;
  }, [gameVideos]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    const { active } = getVideos();
    if (active) active.playbackRate = playbackRate;
  }, [playbackRate, getVideos]);

  // Initialize: load video A with first video, video B with second
  useEffect(() => {
    if (!fullTimeline || !isMulti) return;
    const a = videoARef.current;
    const b = videoBRef.current;
    if (a) {
      a.src = getVideoUrl(0);
      a.load();
    }
    if (b && gameVideos.length > 1) {
      b.src = getVideoUrl(1);
      b.load();
    }
    activeVideoRef.current = 'A';
    currentVideoIndexRef.current = 0;
    setActiveVideoLabel('A');
    setVirtualTime(0);
  }, [fullTimeline, isMulti, getVideoUrl, gameVideos?.length]);

  const seek = useCallback((vt) => {
    if (!fullTimeline) return;
    const result = fullTimeline.virtualToActual(vt);
    const { active, inactive } = getVideos();
    if (!active) return;

    if (result.videoIndex !== currentVideoIndexRef.current) {
      const targetUrl = getVideoUrl(result.videoIndex);
      if (inactive && inactive.src !== targetUrl) {
        inactive.src = targetUrl;
        inactive.load();
      }
      if (inactive) {
        // Cancel any pending swap from a previous rapid seek
        if (pendingSwapRef.current) {
          const prev = pendingSwapRef.current;
          prev.el.removeEventListener('seeked', prev.handler);
          prev.el.removeEventListener('canplay', prev.handler);
          pendingSwapRef.current = null;
        }

        inactive.currentTime = result.actualTime;
        setIsLoading(true);
        const onReady = () => {
          inactive.removeEventListener('seeked', onReady);
          inactive.removeEventListener('canplay', onReady);
          pendingSwapRef.current = null;
          swapVideos();
          currentVideoIndexRef.current = result.videoIndex;
          setIsLoading(false);

          const { inactive: newInactive } = getVideos();
          const adjacentIndex = result.videoIndex === 0 ? 1 : result.videoIndex - 1;
          if (newInactive && gameVideos && adjacentIndex >= 0 && adjacentIndex < gameVideos.length) {
            const adjUrl = getVideoUrl(adjacentIndex);
            if (newInactive.src !== adjUrl) {
              newInactive.src = adjUrl;
              newInactive.load();
            }
          }
        };
        pendingSwapRef.current = { el: inactive, handler: onReady };
        inactive.addEventListener('seeked', onReady, { once: true });
        inactive.addEventListener('canplay', onReady, { once: true });
      } else {
        swapVideos();
        currentVideoIndexRef.current = result.videoIndex;
      }
    } else {
      active.currentTime = result.actualTime;
    }

    setVirtualTime(vt);
  }, [fullTimeline, getVideos, getVideoUrl, swapVideos, gameVideos]);

  // RAF time update loop for playback
  const startTimeUpdateLoop = useCallback(() => {
    const tick = () => {
      if (!isPlayingRef.current || !fullTimeline) return;

      const { active } = getVideos();
      if (!active) {
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      const actualTime = active.currentTime;
      const seg = fullTimeline.segments[currentVideoIndexRef.current];

      // Check if we've hit the end of the current video
      if (seg && actualTime >= seg.duration - 0.05) {
        const nextIndex = currentVideoIndexRef.current + 1;
        if (nextIndex < fullTimeline.segments.length) {
          const { inactive } = getVideos();
          if (inactive) {
            inactive.currentTime = 0;
            inactive.playbackRate = playbackRateRef.current;
            inactive.play().catch(() => {});
          }
          active.pause();
          swapVideos();
          currentVideoIndexRef.current = nextIndex;
        } else {
          active.pause();
          isPlayingRef.current = false;
          setIsPlaying(false);
          setVirtualTime(fullTimeline.totalDuration);
          rafIdRef.current = null;
          return;
        }
      }

      const vt = fullTimeline.actualToVirtual(currentVideoIndexRef.current, actualTime);
      setVirtualTime(vt);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [fullTimeline, getVideos, swapVideos]);

  const stopTimeUpdateLoop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const play = useCallback(async () => {
    const { active } = getVideos();
    if (!active) return;
    active.playbackRate = playbackRateRef.current;
    await active.play().catch(() => {});
    isPlayingRef.current = true;
    setIsPlaying(true);
    startTimeUpdateLoop();
  }, [getVideos, startTimeUpdateLoop]);

  const pause = useCallback(() => {
    const { active } = getVideos();
    if (active) active.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    stopTimeUpdateLoop();
  }, [getVideos, stopTimeUpdateLoop]);

  const togglePlay = useCallback(async () => {
    if (isPlayingRef.current) {
      pause();
    } else {
      if (fullTimeline && virtualTime >= fullTimeline.totalDuration - 0.1) {
        seek(0);
      }
      await play();
    }
  }, [pause, play, seek, fullTimeline, virtualTime]);

  const stepForward = useCallback(() => {
    if (!fullTimeline) return;
    const { active } = getVideos();
    if (!active) return;
    const fps = 30;
    const currentFrame = Math.round(virtualTime * fps);
    const nextFrame = currentFrame + 1;
    const maxFrame = Math.floor(fullTimeline.totalDuration * fps);
    const newVt = Math.min(nextFrame, maxFrame) / fps;
    seek(newVt);
  }, [fullTimeline, virtualTime, seek, getVideos]);

  const stepBackward = useCallback(() => {
    if (!fullTimeline) return;
    const fps = 30;
    const currentFrame = Math.round(virtualTime * fps);
    const prevFrame = Math.max(currentFrame - 1, 0);
    const newVt = prevFrame / fps;
    seek(newVt);
  }, [fullTimeline, virtualTime, seek]);

  const seekForward = useCallback((seconds = 5) => {
    if (!fullTimeline) return;
    const newVt = Math.min(virtualTime + seconds, fullTimeline.totalDuration);
    seek(newVt);
  }, [fullTimeline, virtualTime, seek]);

  const seekBackward = useCallback((seconds = 5) => {
    if (!fullTimeline) return;
    const newVt = Math.max(virtualTime - seconds, 0);
    seek(newVt);
  }, [fullTimeline, virtualTime, seek]);

  const restart = useCallback(() => {
    pause();
    seek(0);
  }, [pause, seek]);

  const handleVideoError = useCallback((e) => {
    const video = e.target;
    const code = video?.error?.code;
    const kind = classifyVideoError({ code, videoSrc: video?.src });

    if (kind === VideoErrorKind.ABORTED) return;

    if ((kind === VideoErrorKind.NETWORK_ERROR || kind === VideoErrorKind.FORMAT_ERROR) &&
        retryCountRef.current < MAX_RETRY_ATTEMPTS && onRefreshUrls) {
      retryCountRef.current += 1;
      onRefreshUrls();
      return;
    }

    const messages = {
      [VideoErrorKind.NETWORK_ERROR]: 'Network error — video URL may have expired',
      [VideoErrorKind.DECODE_ERROR]: 'Video decode error — file may be corrupt',
      [VideoErrorKind.FORMAT_ERROR]: 'Video format not supported',
      [VideoErrorKind.STALE_BLOB]: 'Video source expired',
    };
    setError(messages[kind] || 'Video failed to load');
  }, [onRefreshUrls]);

  const handleVideoWaiting = useCallback(() => {
    if (pendingSwapRef.current) {
      setIsLoading(true);
    }
  }, []);

  const handleVideoCanPlay = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    retryCountRef.current = 0;
  }, []);

  const retry = useCallback(() => {
    clearError();
    if (onRefreshUrls) {
      onRefreshUrls();
    }
  }, [clearError, onRefreshUrls]);

  // Reset error/retry state when URLs change (refresh succeeded)
  useEffect(() => {
    if (gameVideos) {
      setError(null);
      retryCountRef.current = 0;
    }
  }, [gameVideos]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimeUpdateLoop();
    };
  }, [stopTimeUpdateLoop]);

  // Return null for single-video mode (after all hooks have been called)
  if (!isMulti) return null;

  return {
    videoARef,
    videoBRef,
    virtualTime,
    totalDuration: fullTimeline?.totalDuration ?? 0,
    seek,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBackward,
    seekForward,
    seekBackward,
    restart,
    isPlaying,
    activeVideoLabel,
    currentVideoSequence: fullTimeline?.segments[currentVideoIndexRef.current]?.videoSequence ?? null,
    currentVideoIndex: currentVideoIndexRef.current,
    fullTimeline,
    boundaryOffsets: fullTimeline?.getVideoBoundaries() ?? [],
    isLoading,
    error,
    clearError,
    retry,
    videoHandlers: {
      onError: handleVideoError,
      onWaiting: handleVideoWaiting,
      onCanPlay: handleVideoCanPlay,
    },
  };
}

export default useMultiVideoScrub;
