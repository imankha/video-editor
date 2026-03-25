import { useState, useRef, useCallback, useEffect } from 'react';
import { buildVirtualTimeline } from './useVirtualTimeline';

/**
 * PLAYBACK_RATE for annotated clips — 0.5x slow-motion for study/coaching.
 */
const PLAYBACK_RATE = 0.5;

/**
 * CSS opacity transition duration in ms for the swap crossfade.
 */
const CROSSFADE_MS = 80;

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
 * @param {Function} params.getGameVideoUrl — (gameVideos, sequence) → URL
 * @returns {Object} playback state and controls
 */
export function useAnnotationPlayback({ clips, gameVideos, videoUrl }) {
  // --- Refs for the two video elements ---
  const videoARef = useRef(null);
  const videoBRef = useRef(null);

  // --- State ---
  const [isPlaybackMode, setIsPlaybackMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [virtualTime, setVirtualTime] = useState(0);
  const [activeClipId, setActiveClipId] = useState(null);

  // Internal refs (not state to avoid re-render storms during playback)
  const activeVideoRef = useRef('A');       // 'A' or 'B'
  const currentSegmentIndexRef = useRef(0);
  const timelineRef = useRef(null);
  const rafIdRef = useRef(null);
  const isPlayingRef = useRef(false);
  const hasPreloadedNextRef = useRef(false);

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
    inactive.playbackRate = PLAYBACK_RATE;
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

      // Preload next segment when approaching end
      if (!hasPreloadedNextRef.current && segIndex + 1 < timeline.segments.length) {
        const timeRemaining = (seg.endTime - actualTime) / PLAYBACK_RATE;
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
          inactive.playbackRate = PLAYBACK_RATE;
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
          // Use setTimeout to let the swap settle before preloading
          setTimeout(() => preloadNextSegment(nextIndex + 1), 100);
        }
      }

      // Update virtual time
      const vt = timeline.actualToVirtual(currentSegmentIndexRef.current, actualTime);
      setVirtualTime(vt);

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
   * Enter playback mode.
   */
  const enterPlaybackMode = useCallback(() => {
    const timeline = rebuildTimeline();
    if (!timeline || timeline.segments.length === 0) return;

    setIsPlaybackMode(true);
    setVirtualTime(0);
    currentSegmentIndexRef.current = 0;
    activeVideoRef.current = 'A';
    hasPreloadedNextRef.current = false;

    const firstSeg = timeline.segments[0];
    setActiveClipId(firstSeg.clipId);

    // Setup video A with first segment
    const videoA = videoARef.current;
    if (videoA) {
      const url = getSegmentVideoUrl(firstSeg);
      if (videoA.src !== url) {
        videoA.src = url;
        videoA.load();
      }
      videoA.currentTime = firstSeg.startTime;
      videoA.playbackRate = PLAYBACK_RATE;
    }

    // Preload second segment into video B
    if (timeline.segments.length > 1) {
      setTimeout(() => preloadNextSegment(1), 200);
    }
  }, [rebuildTimeline, getSegmentVideoUrl, preloadNextSegment]);

  /**
   * Exit playback mode.
   */
  const exitPlaybackMode = useCallback(() => {
    stopTimeUpdateLoop();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPlaybackMode(false);
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
          videoA.playbackRate = PLAYBACK_RATE;
          await videoA.play().catch(() => {});
        }
        setActiveClipId(firstSeg.clipId);
        setVirtualTime(0);
        if (timeline.segments.length > 1) {
          setTimeout(() => preloadNextSegment(1), 200);
        }
      } else {
        active.playbackRate = PLAYBACK_RATE;
        await active.play().catch(() => {});
      }
      isPlayingRef.current = true;
      setIsPlaying(true);
      startTimeUpdateLoop();
    }
  }, [getVideos, stopTimeUpdateLoop, startTimeUpdateLoop, virtualTime, getSegmentVideoUrl, preloadNextSegment]);

  /**
   * Seek to a virtual time position.
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
    active.playbackRate = PLAYBACK_RATE;

    setVirtualTime(vt);
    setActiveClipId(segment.clipId);

    // Preload next segment
    if (segmentIndex + 1 < timeline.segments.length) {
      setTimeout(() => preloadNextSegment(segmentIndex + 1), 100);
    }
  }, [getVideos, getSegmentVideoUrl, preloadNextSegment]);

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
    isPlaying,
    virtualTime,
    activeClipId,
    activeVideoLabel: activeVideoRef.current,

    // Derived
    timeline: timelineRef.current,

    // Actions
    enterPlaybackMode,
    exitPlaybackMode,
    togglePlay,
    seekVirtual,
  };
}

export default useAnnotationPlayback;
