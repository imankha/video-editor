import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { buildFullVideoTimeline, buildGameTimeline, hasOverlappingAngles } from '../modes/annotate/hooks/useVirtualTimeline';
import { classifyVideoError, VideoErrorKind } from '../utils/videoErrorClassifier';

/**
 * useVideoProxy -- Virtualizes N video files behind a single controller interface.
 *
 * Multi-video (videos.length > 1): 2-slot ping-pong. One active (visible, playing),
 * one inactive (hidden, preloaded). Handles cross-boundary seeking with swap logic.
 *
 * Single-video (videos null/empty or length <= 1): 1 slot, no timeline, direct DOM ops.
 * Same controller interface -- consumers don't know how many elements exist.
 *
 * Does NOT own playback state (isPlaying) or RAF loops -- those belong to the
 * consuming hook (useMultiVideoScrub, useAnnotationPlayback).
 */
export function useVideoProxy({ videos, playbackRate = 1, onRefreshUrls = null }) {
  const isMultiVideo = !!videos && videos.length > 1;

  const videoARef = useRef(null);
  const videoBRef = useRef(null);
  const activeVideoRef = useRef('A');
  const currentVideoIndexRef = useRef(0);
  const playbackRateRef = useRef(playbackRate);
  const pendingSwapRef = useRef(null);
  const retryCountRef = useRef(0);
  const MAX_RETRY_ATTEMPTS = 2;
  // T8890: sequence of the source file currently in the ACTIVE slot. For a
  // backbone-only (angle-free) game this stays in lockstep with the current
  // playback segment; switchSource sets it to an angle's sequence when an angle
  // is showing. Null for single/legacy paths (unused there).
  const activeSourceSeqRef = useRef(null);

  const [virtualTime, setVirtualTime] = useState(0);
  const [activeSlotLabel, setActiveSlotLabel] = useState('A');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // T8890: an overlap game drives playback off buildGameTimeline (backbone +
  // coverage extensions); every angle-free multi-video game (incl. halftime
  // gaps) stays on the byte-identical buildFullVideoTimeline path -- same
  // selector AnnotateContainer uses.
  const fullTimeline = useMemo(
    () => {
      if (!isMultiVideo) return null;
      return hasOverlappingAngles(videos) ? buildGameTimeline(videos) : buildFullVideoTimeline(videos);
    },
    [videos, isMultiVideo],
  );
  const isOverlap = fullTimeline?.kind === 'overlap';

  // --- Internal helpers (also exposed for consuming hooks' RAF loops) ---

  const getVideos = useCallback(() => {
    const isA = activeVideoRef.current === 'A';
    return {
      active: isA ? videoARef.current : videoBRef.current,
      inactive: isA ? videoBRef.current : videoARef.current,
    };
  }, []);

  const swapVideos = useCallback(() => {
    activeVideoRef.current = activeVideoRef.current === 'A' ? 'B' : 'A';
    setActiveSlotLabel(activeVideoRef.current);
  }, []);

  const getVideoUrl = useCallback((index) => {
    if (!videos) return null;
    const v = videos[index];
    return v?.url || v?.serverUrl;
  }, [videos]);

  // T8890: resolve a source URL by its sequence (overlap playback maps segments
  // to source files by sequence, not array position, since the backbone is a
  // subset of videos and extensions reference their owning angle).
  const getVideoUrlBySeq = useCallback((seq) => {
    if (!videos || seq == null) return null;
    const v = videos.find((x) => x.sequence === seq);
    return v?.url || v?.serverUrl || null;
  }, [videos]);

  // URL for playback SEGMENT index: sequence-keyed for overlap, array-keyed for
  // the legacy concatenated timeline (keeps the halftime path byte-identical).
  const getSegmentUrl = useCallback((segIndex) => {
    if (isOverlap) return getVideoUrlBySeq(fullTimeline.segments[segIndex]?.videoSequence);
    return getVideoUrl(segIndex);
  }, [isOverlap, fullTimeline, getVideoUrlBySeq, getVideoUrl]);

  const cancelPendingSwap = useCallback(() => {
    if (pendingSwapRef.current) {
      const prev = pendingSwapRef.current;
      prev.el.removeEventListener('seeked', prev.handler);
      prev.el.removeEventListener('canplay', prev.handler);
      pendingSwapRef.current = null;
    }
  }, []);

  // --- Effects ---

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (isMultiVideo) {
      const { active } = getVideos();
      if (active) active.playbackRate = playbackRate;
    } else if (videoARef.current) {
      videoARef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, getVideos, isMultiVideo]);

  useEffect(() => {
    if (!fullTimeline || !isMultiVideo) return;
    const a = videoARef.current;
    const b = videoBRef.current;
    const segCount = isOverlap ? fullTimeline.segments.length : videos.length;
    if (a) {
      a.src = getSegmentUrl(0);
      a.load();
    }
    if (b && segCount > 1) {
      b.src = getSegmentUrl(1);
      b.load();
    }
    activeVideoRef.current = 'A';
    currentVideoIndexRef.current = 0;
    activeSourceSeqRef.current = isOverlap ? (fullTimeline.segments[0]?.videoSequence ?? null) : null;
    setActiveSlotLabel('A');
    setVirtualTime(0);
  }, [fullTimeline, isMultiVideo, isOverlap, getSegmentUrl, videos?.length]);

  useEffect(() => {
    if (videos) setError(null);
  }, [videos]);

  useEffect(() => {
    return () => {
      cancelPendingSwap();
      if (videoARef.current) videoARef.current.pause();
      if (videoBRef.current) videoBRef.current.pause();
    };
  }, [cancelPendingSwap]);

  // --- Seek (cross-boundary for multi, direct for single) ---

  const seek = useCallback((vt) => {
    if (!isMultiVideo) {
      if (videoARef.current) videoARef.current.currentTime = vt;
      setVirtualTime(vt);
      return;
    }

    if (!fullTimeline) return;
    const result = fullTimeline.virtualToActual(vt);
    const { active, inactive } = getVideos();
    if (!active) return;

    // T8890: a plain seek always follows the BACKBONE spine. If an angle is
    // currently showing (activeSourceSeqRef diverged from this segment's source),
    // swap back to the backbone source even when the segment index is unchanged.
    const targetSeq = isOverlap ? result.videoSequence : null;
    const needSwap = result.videoIndex !== currentVideoIndexRef.current
      || (isOverlap && activeSourceSeqRef.current !== targetSeq);

    if (needSwap) {
      const wasPlaying = !active.paused;
      active.pause();

      const targetUrl = isOverlap ? getVideoUrlBySeq(targetSeq) : getVideoUrl(result.videoIndex);
      if (inactive && inactive.src !== targetUrl) {
        inactive.src = targetUrl;
        inactive.load();
      }
      if (inactive) {
        cancelPendingSwap();
        inactive.currentTime = result.actualTime;
        setIsLoading(true);

        const onReady = () => {
          inactive.removeEventListener('seeked', onReady);
          inactive.removeEventListener('canplay', onReady);
          pendingSwapRef.current = null;
          swapVideos();
          currentVideoIndexRef.current = result.videoIndex;
          activeSourceSeqRef.current = targetSeq;
          setIsLoading(false);

          const { active: newActive, inactive: newInactive } = getVideos();
          if (newInactive && !newInactive.paused) newInactive.pause();

          if (wasPlaying && newActive) {
            newActive.playbackRate = playbackRateRef.current;
            newActive.play().catch(() => {});
          }

          const segCount = isOverlap ? fullTimeline.segments.length : videos.length;
          const adjacentIndex = result.videoIndex === 0 ? 1 : result.videoIndex - 1;
          if (newInactive && adjacentIndex >= 0 && adjacentIndex < segCount) {
            const adjUrl = getSegmentUrl(adjacentIndex);
            if (adjUrl && newInactive.src !== adjUrl) {
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
        activeSourceSeqRef.current = targetSeq;
      }
    } else {
      active.currentTime = result.actualTime;
    }
    setVirtualTime(vt);
  }, [isMultiVideo, fullTimeline, isOverlap, getVideos, getVideoUrl, getVideoUrlBySeq, getSegmentUrl, swapVideos, cancelPendingSwap, videos]);

  // --- T8890: source switching (angles) ---
  // The SAME idle-slot swap as a cross-boundary seek, but the target is an
  // arbitrary source file (an angle) at a given file-relative time rather than
  // the next backbone segment. currentVideoIndexRef keeps pointing at the
  // underlying backbone segment (the fallback target); only activeSourceSeqRef
  // moves. Switching back to the backbone source is just switchSource(backboneSeq).
  const switchSource = useCallback((sequence, fileTime) => {
    if (!isMultiVideo || !isOverlap || !fullTimeline) return;
    const targetUrl = getVideoUrlBySeq(sequence);
    if (!targetUrl) return;
    const { active, inactive } = getVideos();
    if (!active) return;

    // Same source already showing -> just seek it (no swap needed).
    if (activeSourceSeqRef.current === sequence) {
      active.currentTime = fileTime;
      return;
    }
    if (!inactive) return;

    const wasPlaying = !active.paused;
    active.pause();
    if (inactive.src !== targetUrl) {
      inactive.src = targetUrl;
      inactive.load();
    }
    cancelPendingSwap();
    inactive.currentTime = fileTime;
    setIsLoading(true);

    const onReady = () => {
      inactive.removeEventListener('seeked', onReady);
      inactive.removeEventListener('canplay', onReady);
      pendingSwapRef.current = null;
      swapVideos();
      activeSourceSeqRef.current = sequence;
      setIsLoading(false);

      const { active: newActive, inactive: newInactive } = getVideos();
      if (newInactive && !newInactive.paused) newInactive.pause();
      if (wasPlaying && newActive) {
        newActive.playbackRate = playbackRateRef.current;
        newActive.play().catch(() => {});
      }
    };
    pendingSwapRef.current = { el: inactive, handler: onReady };
    inactive.addEventListener('seeked', onReady, { once: true });
    inactive.addEventListener('canplay', onReady, { once: true });
  }, [isMultiVideo, isOverlap, fullTimeline, getVideoUrlBySeq, getVideos, swapVideos, cancelPendingSwap]);

  // --- Error handling ---

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
      [VideoErrorKind.NETWORK_ERROR]: 'Network error -- video URL may have expired',
      [VideoErrorKind.DECODE_ERROR]: 'Video decode error -- file may be corrupt',
      [VideoErrorKind.FORMAT_ERROR]: 'Video format not supported',
      [VideoErrorKind.STALE_BLOB]: 'Video source expired',
    };
    setError(messages[kind] || 'Video failed to load');
  }, [onRefreshUrls]);

  const handleVideoWaiting = useCallback(() => {
    if (pendingSwapRef.current) setIsLoading(true);
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
    if (onRefreshUrls) onRefreshUrls();
  }, [clearError, onRefreshUrls]);

  // --- Video controller (stable across slot swaps) ---

  const videoController = useMemo(() => ({
    play: async () => {
      const el = isMultiVideo ? getVideos().active : videoARef.current;
      if (!el) return;
      el.playbackRate = playbackRateRef.current;
      await el.play();
    },
    pause: () => {
      if (videoARef.current) videoARef.current.pause();
      if (videoBRef.current) videoBRef.current.pause();
    },
    seek,
    setVolume: (v) => {
      [videoARef, videoBRef].forEach(r => { if (r.current) r.current.volume = v; });
    },
    setMuted: (m) => {
      [videoARef, videoBRef].forEach(r => { if (r.current) r.current.muted = m; });
    },
    getCurrentTime: () => {
      if (isMultiVideo) {
        const active = getVideos().active;
        if (!active || !fullTimeline) return 0;
        // T8890: when an angle is showing (its source != the backbone segment's
        // source), the active element's currentTime is angle-file time -- map it
        // through the wall axis, not the backbone segment's time base.
        if (isOverlap && activeSourceSeqRef.current != null
            && activeSourceSeqRef.current !== fullTimeline.segments[currentVideoIndexRef.current]?.videoSequence) {
          return fullTimeline.sourceTimeToVirtual(activeSourceSeqRef.current, active.currentTime);
        }
        return fullTimeline.actualToVirtual(currentVideoIndexRef.current, active.currentTime);
      }
      return videoARef.current?.currentTime ?? 0;
    },
    isPaused: () => {
      const el = isMultiVideo ? getVideos().active : videoARef.current;
      return el ? el.paused : true;
    },
    getActiveElement: () => isMultiVideo ? getVideos().active : videoARef.current,
    _renderRefs: isMultiVideo ? { videoARef, videoBRef } : { videoARef },
  }), [isMultiVideo, isOverlap, seek, getVideos, fullTimeline]);

  return {
    videoController,
    virtualTime,
    totalDuration: fullTimeline?.totalDuration ?? 0,
    isLoading,
    error,
    clearError,
    retry,
    videoHandlers: {
      onError: handleVideoError,
      onWaiting: handleVideoWaiting,
      onCanPlay: handleVideoCanPlay,
    },
    isMultiVideo,
    activeSlotLabel,
    currentVideoIndex: currentVideoIndexRef.current,
    timeline: fullTimeline,
    boundaryOffsets: fullTimeline?.getVideoBoundaries() ?? [],
    // Internal API for consuming hooks (RAF loops, boundary transitions)
    getVideos,
    swapVideos,
    currentVideoIndexRef,
    playbackRateRef,
    setVirtualTime,
    // T8890: source switching (angles)
    switchSource,
    activeSourceSeqRef,
    getVideoUrlBySeq,
  };
}

export default useVideoProxy;
