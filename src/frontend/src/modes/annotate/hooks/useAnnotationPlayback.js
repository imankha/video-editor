import { useState, useRef, useCallback, useEffect } from 'react';
import { buildVirtualTimeline } from './useVirtualTimeline';
import { useQuestStore } from '../../../stores/questStore';

/**
 * Default playback rate for annotated clips — 0.5x slow-motion for study/coaching.
 */
const DEFAULT_PLAYBACK_RATE = 0.5;

/**
 * How far before segment end (in seconds of actual video time) to trigger preload
 * of the next segment. Must be long enough for the browser to seek and buffer.
 */
const PRELOAD_AHEAD_SECONDS = 1.0;

/**
 * useAnnotationPlayback — Dual-video ping-pong playback controller.
 *
 * Two <video> elements alternate: one plays the current segment while the other
 * pre-seeks to the next segment's start. At segment boundaries, visibility swaps
 * via CSS opacity with an ~80ms crossfade.
 *
 * @param {Object} params
 * @param {Array} params.clips — clip regions (sorted by startTime)
 * @param {Array|null} params.gameVideos — multi-video game videos array
 * @param {string} params.videoUrl — current single-video URL
 * @returns {Object} playback state and controls
 */
export function useAnnotationPlayback({ clips, gameVideos, videoUrl }) {
  // --- Refs for the two video elements ---
  const videoARef = useRef(null);
  const videoBRef = useRef(null);

  // --- State ---
  const [isPlaybackMode, setIsPlaybackMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [virtualTime, setVirtualTime] = useState(0);
  const [activeClipId, setActiveClipId] = useState(null);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_PLAYBACK_RATE);

  // Internal refs (not state to avoid re-render storms during playback)
  const activeVideoRef = useRef('A');       // 'A' or 'B'
  const currentSegmentIndexRef = useRef(0);
  const timelineRef = useRef(null);
  const rafIdRef = useRef(null);
  const isPlayingRef = useRef(false);
  const hasPreloadedNextRef = useRef(false);
  const playbackRateRef = useRef(DEFAULT_PLAYBACK_RATE);
  const hasRecordedPlaybackAchievementRef = useRef(false);

  // Keep ref in sync with state for use in RAF loop
  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  // Build timeline from clips (stable reference via ref)
  const rebuildTimeline = useCallback(() => {
    const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
    timelineRef.current = buildVirtualTimeline(sorted);
    return timelineRef.current;
  }, [clips]);

  /**
   * Get the video URL for a given segment.
   * For multi-video games, each segment may reference a different video.
   */
  const getSegmentVideoUrl = useCallback((segment) => {
    if (!gameVideos || !segment.videoSequence) return videoUrl;
    const video = gameVideos.find(v => v.sequence === segment.videoSequence);
    return video?.url || video?.serverUrl || videoUrl;
  }, [gameVideos, videoUrl]);

  /**
   * Get the active and inactive video elements.
   */
  const getVideos = useCallback(() => {
    const isA = activeVideoRef.current === 'A';
    return {
      active: isA ? videoARef.current : videoBRef.current,
      inactive: isA ? videoBRef.current : videoARef.current,
      activeLabel: isA ? 'A' : 'B',
      inactiveLabel: isA ? 'B' : 'A',
    };
  }, []);

  /**
   * Preload the next segment into the inactive video element.
   */
  const preloadNextSegment = useCallback((nextIndex) => {
    const timeline = timelineRef.current;
    if (!timeline || nextIndex >= timeline.segments.length) return;

    const nextSeg = timeline.segments[nextIndex];
    const { inactive } = getVideos();
    if (!inactive) return;

    const nextUrl = getSegmentVideoUrl(nextSeg);

    // If URL differs (cross-video), load new source
    if (inactive.src !== nextUrl) {
      inactive.src = nextUrl;
      inactive.load();
    }

    // Seek to next segment start
    inactive.currentTime = nextSeg.startTime;
    inactive.playbackRate = playbackRateRef.current;
    inactive.pause();
    hasPreloadedNextRef.current = true;
  }, [getVideos, getSegmentVideoUrl]);

  /**
   * Swap active/inactive video elements (the ping-pong swap).
   */
  const swapVideos = useCallback(() => {
    activeVideoRef.current = activeVideoRef.current === 'A' ? 'B' : 'A';
    hasPreloadedNextRef.current = false;
  }, []);

  /**
   * RAF-based time update loop.
   * Updates virtual time and handles segment transitions.
   */
  const startTimeUpdateLoop = useCallback(() => {
    const tick = () => {
      if (!isPlayingRef.current) return;

      const timeline = timelineRef.current;
      const { active } = getVideos();
      if (!timeline || !active || timeline.segments.length === 0) {
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      const segIndex = currentSegmentIndexRef.current;
      const seg = timeline.segments[segIndex];
      if (!seg) {
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      const actualTime = active.currentTime;
      const rate = playbackRateRef.current;

      // Preload next segment when approaching end
      if (!hasPreloadedNextRef.current && segIndex + 1 < timeline.segments.length) {
        const timeRemaining = (seg.endTime - actualTime) / rate;
        if (timeRemaining <= PRELOAD_AHEAD_SECONDS) {
          preloadNextSegment(segIndex + 1);
        }
      }

      // Check if we've passed the segment end
      if (actualTime >= seg.endTime - 0.02) {
        const nextIndex = segIndex + 1;

        if (nextIndex >= timeline.segments.length) {
          // End of all segments — pause
          active.pause();
          isPlayingRef.current = false;
          setIsPlaying(false);
          // Set virtual time to end
          setVirtualTime(timeline.totalVirtualDuration);
          setActiveClipId(null);
          rafIdRef.current = null;
          return;
        }

        // Swap to next segment
        currentSegmentIndexRef.current = nextIndex;
        const nextSeg = timeline.segments[nextIndex];

        const { inactive } = getVideos();
        if (inactive) {
          // Start playing the preloaded video
          inactive.currentTime = nextSeg.startTime;
          inactive.playbackRate = rate;
          inactive.play().catch(() => {});
        }

        // Pause the old active
        active.pause();

        // Swap visibility
        swapVideos();

        // Update state
        setActiveClipId(nextSeg.clipId);

        // Preload the segment after next
        if (nextIndex + 1 < timeline.segments.length) {
          setTimeout(() => preloadNextSegment(nextIndex + 1), 100);
        }
      }

      // Update virtual time
      const vt = timeline.actualToVirtual(currentSegmentIndexRef.current, actualTime);
      setVirtualTime(vt);

      // Record quest achievement after 2s of watching
      if (!hasRecordedPlaybackAchievementRef.current && vt >= 2) {
        hasRecordedPlaybackAchievementRef.current = true;
        useQuestStore.getState().recordAchievement('played_annotations');
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, [getVideos, preloadNextSegment, swapVideos]);

  /**
   * Stop the RAF loop.
   */
  const stopTimeUpdateLoop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  /**
   * Wait for a video element to be ready (seeked + enough data).
   * Returns a promise that resolves when the video can play from currentTime.
   */
  const waitForVideoReady = useCallback((video, timeoutMs = 5000) => {
    return new Promise((resolve) => {
      // Already ready?
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve();
        return;
      }

      const cleanup = () => {
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('seeked', onReady);
        clearTimeout(timer);
      };
      const onReady = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          cleanup();
          resolve();
        }
      };
      // Timeout fallback — don't block forever
      const timer = setTimeout(() => {
        cleanup();
        resolve(); // proceed anyway
      }, timeoutMs);

      video.addEventListener('canplay', onReady);
      video.addEventListener('seeked', onReady);
    });
  }, []);

  /**
   * Enter playback mode.
   * Loads and seeks video A, waits until ready, then auto-plays.
   */
  const enterPlaybackMode = useCallback(async () => {
    const timeline = rebuildTimeline();
    if (!timeline || timeline.segments.length === 0) return;

    // Show loading state while we prepare
    setIsLoading(true);
    setIsPlaybackMode(true);
    setVirtualTime(0);
    currentSegmentIndexRef.current = 0;
    activeVideoRef.current = 'A';
    hasPreloadedNextRef.current = false;

    const firstSeg = timeline.segments[0];
    setActiveClipId(firstSeg.clipId);

    // Wait a frame for refs to mount (the dual video elements appear after isPlaybackMode=true)
    await new Promise(r => requestAnimationFrame(r));

    const videoA = videoARef.current;
    if (videoA) {
      const url = getSegmentVideoUrl(firstSeg);
      videoA.src = url;
      videoA.load();
      videoA.currentTime = firstSeg.startTime;
      videoA.playbackRate = playbackRateRef.current;

      // Wait until the video has enough data to play
      await waitForVideoReady(videoA);

      // Auto-play
      setIsLoading(false);
      await videoA.play().catch(() => {});
      isPlayingRef.current = true;
      setIsPlaying(true);
      startTimeUpdateLoop();
    } else {
      setIsLoading(false);
    }

    // Preload second segment into video B
    if (timeline.segments.length > 1) {
      setTimeout(() => preloadNextSegment(1), 200);
    }
  }, [rebuildTimeline, getSegmentVideoUrl, preloadNextSegment, waitForVideoReady, startTimeUpdateLoop]);

  /**
   * Exit playback mode.
   */
  const exitPlaybackMode = useCallback(() => {
    stopTimeUpdateLoop();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPlaybackMode(false);
    setIsLoading(false);
    setVirtualTime(0);
    setActiveClipId(null);

    // Pause both videos
    if (videoARef.current) videoARef.current.pause();
    if (videoBRef.current) videoBRef.current.pause();
  }, [stopTimeUpdateLoop]);

  /**
   * Toggle play/pause within playback mode.
   */
  const togglePlay = useCallback(async () => {
    const { active } = getVideos();
    if (!active) return;

    if (isPlayingRef.current) {
      active.pause();
      isPlayingRef.current = false;
      setIsPlaying(false);
      stopTimeUpdateLoop();
    } else {
      const rate = playbackRateRef.current;
      // If at the end, restart from beginning
      const timeline = timelineRef.current;
      if (timeline && virtualTime >= timeline.totalVirtualDuration - 0.1) {
        currentSegmentIndexRef.current = 0;
        activeVideoRef.current = 'A';
        hasPreloadedNextRef.current = false;
        const firstSeg = timeline.segments[0];
        const videoA = videoARef.current;
        if (videoA) {
          const url = getSegmentVideoUrl(firstSeg);
          if (videoA.src !== url) {
            videoA.src = url;
            videoA.load();
          }
          videoA.currentTime = firstSeg.startTime;
          videoA.playbackRate = rate;
          await videoA.play().catch(() => {});
        }
        setActiveClipId(firstSeg.clipId);
        setVirtualTime(0);
        if (timeline.segments.length > 1) {
          setTimeout(() => preloadNextSegment(1), 200);
        }
      } else {
        active.playbackRate = rate;
        await active.play().catch(() => {});
      }
      isPlayingRef.current = true;
      setIsPlaying(true);
      startTimeUpdateLoop();
    }
  }, [getVideos, stopTimeUpdateLoop, startTimeUpdateLoop, virtualTime, getSegmentVideoUrl, preloadNextSegment]);

  /**
   * Change playback speed. Updates the currently-playing video element immediately.
   */
  const changePlaybackRate = useCallback((newRate) => {
    setPlaybackRate(newRate);
    playbackRateRef.current = newRate;
    // Apply immediately to the active video element
    const { active } = getVideos();
    if (active) {
      active.playbackRate = newRate;
    }
  }, [getVideos]);

  // Track whether we were playing before a scrub started, so we can resume after
  const wasPlayingBeforeScrubRef = useRef(false);
  const isScrrubbingRef = useRef(false);
  // Throttle state updates during scrub — seek video immediately, batch React renders
  const scrubStateRafRef = useRef(null);
  const pendingScrubVtRef = useRef(null);
  const pendingScrubClipIdRef = useRef(null);

  /**
   * Flush any pending scrub state to React (called on RAF or endScrub).
   */
  const flushScrubState = useCallback(() => {
    if (pendingScrubVtRef.current !== null) {
      setVirtualTime(pendingScrubVtRef.current);
      pendingScrubVtRef.current = null;
    }
    if (pendingScrubClipIdRef.current !== null) {
      setActiveClipId(pendingScrubClipIdRef.current);
      pendingScrubClipIdRef.current = null;
    }
    scrubStateRafRef.current = null;
  }, []);

  /**
   * Schedule a batched state update during scrub (once per animation frame).
   */
  const scheduleScrubStateUpdate = useCallback((vt, clipId) => {
    pendingScrubVtRef.current = vt;
    pendingScrubClipIdRef.current = clipId;
    if (!scrubStateRafRef.current) {
      scrubStateRafRef.current = requestAnimationFrame(flushScrubState);
    }
  }, [flushScrubState]);

  /**
   * Seek to a virtual time position.
   * During scrub: seeks video immediately, batches React state updates per frame.
   * Outside scrub: seeks video and updates state synchronously.
   */
  const seekVirtual = useCallback((vt) => {
    const timeline = timelineRef.current;
    if (!timeline || timeline.segments.length === 0) return;

    const result = timeline.virtualToActual(vt);
    if (!result) return;

    const { segmentIndex, actualTime, segment } = result;
    currentSegmentIndexRef.current = segmentIndex;
    hasPreloadedNextRef.current = false;

    // Load the correct segment into the active video
    const { active } = getVideos();
    if (!active) return;

    const url = getSegmentVideoUrl(segment);
    if (active.src !== url) {
      active.src = url;
      active.load();
    }
    active.currentTime = actualTime;
    active.playbackRate = playbackRateRef.current;

    if (isScrrubbingRef.current) {
      // During scrub: batch state updates to avoid choking video decode
      scheduleScrubStateUpdate(vt, segment.clipId);
    } else {
      setVirtualTime(vt);
      setActiveClipId(segment.clipId);
      // Preload next segment
      if (segmentIndex + 1 < timeline.segments.length) {
        setTimeout(() => preloadNextSegment(segmentIndex + 1), 100);
      }
    }
  }, [getVideos, getSegmentVideoUrl, preloadNextSegment, scheduleScrubStateUpdate]);

  /**
   * Seek playback to a specific clip by its ID.
   * Finds the clip's segment and seeks to its virtual start.
   */
  const seekToClip = useCallback((clipId) => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const seg = timeline.segments.find(s => s.clipId === clipId);
    if (seg) {
      seekVirtual(seg.virtualStart);
    }
  }, [seekVirtual]);

  /**
   * Seek to a specific actual time within the current segment.
   * Used by the clip scrub bar for frame-level control.
   * Seeks video immediately; batches React state update during drag.
   */
  const seekWithinSegment = useCallback((actualTime) => {
    const timeline = timelineRef.current;
    const segIndex = currentSegmentIndexRef.current;
    const seg = timeline?.segments[segIndex];
    if (!seg) return;

    // Clamp to segment bounds
    const clamped = Math.max(seg.startTime, Math.min(actualTime, seg.endTime));

    const { active } = getVideos();
    if (active) {
      active.currentTime = clamped;
    }

    // Keep virtual time in sync (batched during scrub)
    const vt = timeline.actualToVirtual(segIndex, clamped);
    if (isScrrubbingRef.current) {
      scheduleScrubStateUpdate(vt, seg.clipId);
    } else {
      setVirtualTime(vt);
    }
  }, [getVideos, scheduleScrubStateUpdate]);

  /**
   * Start scrubbing — pauses playback so seeks show each frame.
   */
  const startScrub = useCallback(() => {
    isScrrubbingRef.current = true;
    wasPlayingBeforeScrubRef.current = isPlayingRef.current;
    if (isPlayingRef.current) {
      const { active } = getVideos();
      if (active) active.pause();
      isPlayingRef.current = false;
      setIsPlaying(false);
      stopTimeUpdateLoop();
    }
  }, [getVideos, stopTimeUpdateLoop]);

  /**
   * End scrubbing — resumes playback if it was playing before the scrub.
   */
  const endScrub = useCallback(async () => {
    isScrrubbingRef.current = false;

    // Flush any pending state updates from the drag
    if (scrubStateRafRef.current) {
      cancelAnimationFrame(scrubStateRafRef.current);
      scrubStateRafRef.current = null;
    }
    flushScrubState();

    // Preload the next segment from wherever we landed
    const timeline = timelineRef.current;
    const segIndex = currentSegmentIndexRef.current;
    if (timeline && segIndex + 1 < timeline.segments.length) {
      preloadNextSegment(segIndex + 1);
    }

    if (wasPlayingBeforeScrubRef.current) {
      const { active } = getVideos();
      if (active) {
        active.playbackRate = playbackRateRef.current;
        await active.play().catch(() => {});
      }
      isPlayingRef.current = true;
      setIsPlaying(true);
      startTimeUpdateLoop();
    }
  }, [getVideos, preloadNextSegment, startTimeUpdateLoop]);

  /**
   * Get the current segment object (for clip scrub bar).
   */
  const getCurrentSegment = useCallback(() => {
    const timeline = timelineRef.current;
    if (!timeline) return null;
    return timeline.segments[currentSegmentIndexRef.current] || null;
  }, []);


  /**
   * Restart playback from the beginning.
   * Pauses, seeks to virtual time 0, and stops the loop.
   */
  const restart = useCallback(() => {
    const { active } = getVideos();
    if (active) active.pause();
    stopTimeUpdateLoop();
    isPlayingRef.current = false;
    setIsPlaying(false);
    seekVirtual(0);
  }, [getVideos, stopTimeUpdateLoop, seekVirtual]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimeUpdateLoop();
    };
  }, [stopTimeUpdateLoop]);

  // Rebuild timeline when clips change while in playback mode
  useEffect(() => {
    if (isPlaybackMode) {
      rebuildTimeline();
    }
  }, [clips, isPlaybackMode, rebuildTimeline]);

  return {
    // Refs for the two video elements (mount in JSX)
    videoARef,
    videoBRef,

    // State
    isPlaybackMode,
    isLoading,
    isPlaying,
    virtualTime,
    activeClipId,
    playbackRate,
    activeVideoLabel: activeVideoRef.current,

    // Derived
    timeline: timelineRef.current,

    // Actions
    enterPlaybackMode,
    exitPlaybackMode,
    togglePlay,
    restart,
    seekVirtual,
    seekToClip,
    seekWithinSegment,
    getCurrentSegment,
    startScrub,
    endScrub,
    changePlaybackRate,
  };
}

export default useAnnotationPlayback;
