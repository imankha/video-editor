import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useVideoProxy } from '../../../hooks/useVideoProxy';

/**
 * useMultiVideoScrub -- Dual-video scrub for unified multi-video annotate mode.
 *
 * Delegates video element management to useVideoProxy. Owns only scrub-specific
 * logic: RAF playback loop, play/pause state, step/seek navigation.
 *
 * Returns null when gameVideos is null/single-video (after all hooks are called).
 */
export function useMultiVideoScrub({ gameVideos, playbackRate = 1, onRefreshUrls = null }) {
  const isMulti = !!gameVideos && gameVideos.length > 1;

  const proxy = useVideoProxy({ videos: gameVideos, playbackRate, onRefreshUrls });

  const rafIdRef = useRef(null);
  const isPlayingRef = useRef(false);
  const pendingPlayRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);

  const startTimeUpdateLoop = useCallback(() => {
    const tick = () => {
      if (!isPlayingRef.current || !proxy.timeline) return;

      const { active } = proxy.getVideos();
      if (!active) {
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      const actualTime = active.currentTime;
      const seg = proxy.timeline.segments[proxy.currentVideoIndexRef.current];

      if (seg && actualTime >= seg.duration - 0.05) {
        const nextIndex = proxy.currentVideoIndexRef.current + 1;
        if (nextIndex < proxy.timeline.segments.length) {
          const { inactive } = proxy.getVideos();
          if (inactive) {
            inactive.currentTime = 0;
            inactive.playbackRate = proxy.playbackRateRef.current;
            inactive.play().catch(() => {
              isPlayingRef.current = false;
              setIsPlaying(false);
            });
          }
          active.pause();
          proxy.swapVideos();
          proxy.currentVideoIndexRef.current = nextIndex;
        } else {
          active.pause();
          isPlayingRef.current = false;
          setIsPlaying(false);
          proxy.setVirtualTime(proxy.timeline.totalDuration);
          rafIdRef.current = null;
          return;
        }
      }

      const vt = proxy.timeline.actualToVirtual(proxy.currentVideoIndexRef.current, actualTime);
      proxy.setVirtualTime(vt);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [proxy.timeline, proxy.getVideos, proxy.swapVideos, proxy.currentVideoIndexRef, proxy.playbackRateRef, proxy.setVirtualTime]);

  const stopTimeUpdateLoop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // Execute deferred play when proxy finishes a cross-boundary swap
  useEffect(() => {
    if (!proxy.isLoading && pendingPlayRef.current) {
      pendingPlayRef.current = false;
      proxy.videoController.play().then(() => {
        isPlayingRef.current = true;
        setIsPlaying(true);
        startTimeUpdateLoop();
      }).catch(() => {
        isPlayingRef.current = false;
        setIsPlaying(false);
      });
    }
  }, [proxy.isLoading, proxy.videoController, startTimeUpdateLoop]);

  const play = useCallback(async () => {
    if (proxy.isLoading) {
      pendingPlayRef.current = true;
      return;
    }
    try {
      await proxy.videoController.play();
      isPlayingRef.current = true;
      setIsPlaying(true);
      startTimeUpdateLoop();
    } catch {
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  }, [proxy.videoController, proxy.isLoading, startTimeUpdateLoop]);

  const pause = useCallback(() => {
    pendingPlayRef.current = false;
    proxy.videoController.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    stopTimeUpdateLoop();
  }, [proxy.videoController, stopTimeUpdateLoop]);

  const togglePlay = useCallback(async () => {
    const activeEl = proxy.videoController.getActiveElement();
    if ((activeEl && !activeEl.paused) || isPlayingRef.current) {
      pause();
    } else {
      if (proxy.timeline && proxy.virtualTime >= proxy.timeline.totalDuration - 0.1) {
        proxy.videoController.seek(0);
      }
      await play();
    }
  }, [pause, play, proxy.videoController, proxy.timeline, proxy.virtualTime]);

  const stepForward = useCallback(() => {
    if (!proxy.timeline) return;
    const activeEl = proxy.videoController.getActiveElement();
    if (!activeEl) return;
    const fps = 30;
    const currentFrame = Math.round(proxy.virtualTime * fps);
    const nextFrame = currentFrame + 1;
    const maxFrame = Math.floor(proxy.timeline.totalDuration * fps);
    const newVt = Math.min(nextFrame, maxFrame) / fps;
    proxy.videoController.seek(newVt);
  }, [proxy.timeline, proxy.virtualTime, proxy.videoController]);

  const stepBackward = useCallback(() => {
    if (!proxy.timeline) return;
    const fps = 30;
    const currentFrame = Math.round(proxy.virtualTime * fps);
    const prevFrame = Math.max(currentFrame - 1, 0);
    const newVt = prevFrame / fps;
    proxy.videoController.seek(newVt);
  }, [proxy.timeline, proxy.virtualTime, proxy.videoController]);

  const seekForward = useCallback((seconds = 5) => {
    if (!proxy.timeline) return;
    const newVt = Math.min(proxy.virtualTime + seconds, proxy.timeline.totalDuration);
    proxy.videoController.seek(newVt);
  }, [proxy.timeline, proxy.virtualTime, proxy.videoController]);

  const seekBackward = useCallback((seconds = 5) => {
    if (!proxy.timeline) return;
    const newVt = Math.max(proxy.virtualTime - seconds, 0);
    proxy.videoController.seek(newVt);
  }, [proxy.timeline, proxy.virtualTime, proxy.videoController]);

  const restart = useCallback(() => {
    pause();
    proxy.videoController.seek(0);
  }, [pause, proxy.videoController]);

  useEffect(() => {
    return () => {
      stopTimeUpdateLoop();
    };
  }, [stopTimeUpdateLoop]);

  const videoController = useMemo(() => ({
    play,
    pause,
    seek: proxy.videoController.seek,
    setVolume: proxy.videoController.setVolume,
    setMuted: proxy.videoController.setMuted,
    getCurrentTime: proxy.videoController.getCurrentTime,
    isPaused: proxy.videoController.isPaused,
    getActiveElement: proxy.videoController.getActiveElement,
    _renderRefs: proxy.videoController._renderRefs,
  }), [play, pause, proxy.videoController]);

  if (!isMulti) return null;

  return {
    virtualTime: proxy.virtualTime,
    totalDuration: proxy.totalDuration,
    seek: proxy.videoController.seek,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBackward,
    seekForward,
    seekBackward,
    restart,
    isPlaying,
    activeVideoLabel: proxy.activeSlotLabel,
    currentVideoSequence: proxy.timeline?.segments[proxy.currentVideoIndexRef.current]?.videoSequence ?? null,
    currentVideoIndex: proxy.currentVideoIndex,
    fullTimeline: proxy.timeline,
    boundaryOffsets: proxy.boundaryOffsets,
    isLoading: proxy.isLoading,
    error: proxy.error,
    clearError: proxy.clearError,
    retry: proxy.retry,
    videoController,
    videoHandlers: proxy.videoHandlers,
  };
}

export default useMultiVideoScrub;
