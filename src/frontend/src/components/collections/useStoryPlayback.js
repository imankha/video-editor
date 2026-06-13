import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useStoryPlayback - Sequential "story" playback over an ordered list of reels
 * (T3610). Auto-advances on each reel's 'ended'; the last reel fires onAllEnded.
 *
 * Progress is derived from the video ELEMENT's own metadata
 * (currentTime / duration), never from a reel's frozen duration — so a NULL
 * frozen duration can never break the scrubber (the bug useHighlightsPlayback
 * has with `clip.duration || 0`).
 *
 * @param {React.RefObject<HTMLVideoElement>} videoRef
 * @param {Array} reels - ordered [{ id, streamUrl, aspect_ratio, ... }]
 * @param {Object}   opts
 * @param {number=}  opts.initialIndex
 * @param {Function=} opts.onAllEnded   - all reels finished
 * @param {Function=} opts.onReelChange - (index, reel) on each active-reel change
 */
export function useStoryPlayback(videoRef, reels, {
  initialIndex = 0,
  onAllEnded,
  onReelChange,
} = {}) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [segmentProgress, setSegmentProgress] = useState(0); // 0..1 of current element
  const rafRef = useRef(null);

  const count = reels?.length || 0;
  const safeIndex = count ? Math.min(activeIndex, count - 1) : 0;
  const activeReel = count ? reels[safeIndex] : null;

  const next = useCallback(() => {
    setActiveIndex((i) => Math.min(i + 1, count - 1));
  }, [count]);

  const prev = useCallback(() => {
    setActiveIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goTo = useCallback((i) => {
    if (i >= 0 && i < count) setActiveIndex(i);
  }, [count]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, [videoRef]);

  // Notify + reset progress when the active reel changes.
  useEffect(() => {
    setSegmentProgress(0);
    if (activeReel) onReelChange?.(safeIndex, activeReel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex]);

  // Load + autoplay the active reel's source.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeReel) return;
    v.load();
    v.play().catch(() => {}); // autoplay may be blocked until a user gesture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex, activeReel?.streamUrl]);

  // Element listeners + rAF progress tick.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setActiveIndex((i) => {
        if (i + 1 < count) return i + 1;
        onAllEnded?.();
        return i;
      });
    };
    const tick = () => {
      if (v.duration > 0) {
        setSegmentProgress(Math.min(1, v.currentTime / v.duration));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [videoRef, count, onAllEnded]);

  return {
    activeIndex: safeIndex,
    activeReel,
    isPlaying,
    segmentProgress,
    next,
    prev,
    goTo,
    togglePlay,
  };
}

export default useStoryPlayback;
