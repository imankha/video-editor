import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

export function useHighlightsPlayback(videoRef, clips, getStreamUrl) {
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const isScrubbing = useRef(false);
  const rafRef = useRef(null);
  const pendingSeek = useRef(null);

  const segments = useMemo(() => {
    if (!clips || clips.length === 0) return [];
    let offset = 0;
    return clips.map(clip => {
      const duration = clip.duration || 0;
      const seg = {
        clipId: clip.id,
        startTime: 0,
        endTime: duration,
        virtualStart: offset,
        virtualEnd: offset + duration,
        duration,
      };
      offset += duration;
      return seg;
    });
  }, [clips]);

  const totalVirtualDuration = useMemo(() => {
    if (segments.length === 0) return 0;
    return segments[segments.length - 1].virtualEnd;
  }, [segments]);

  const activeClip = clips?.[activeClipIndex] ?? null;
  const activeClipId = activeClip?.id ?? null;

  const currentSegment = segments[activeClipIndex] || null;

  const virtualTime = useMemo(() => {
    if (!currentSegment) return 0;
    return currentSegment.virtualStart + currentTime;
  }, [currentSegment, currentTime]);

  const activeClipName = activeClip?.name || '';

  const streamUrl = useMemo(() => {
    if (!activeClip) return null;
    return getStreamUrl(activeClip.id);
  }, [activeClip, getStreamUrl]);

  useEffect(() => {
    const tick = () => {
      const video = videoRef.current;
      if (video && !isScrubbing.current) {
        setCurrentTime(video.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setIsPlaying(!video.paused);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (clips && activeClipIndex < clips.length - 1) {
        setActiveClipIndex(prev => prev + 1);
        setCurrentTime(0);
      }
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [videoRef, activeClipIndex, clips, totalVirtualDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [videoRef, playbackRate]);

  useEffect(() => {
    if (pendingSeek.current === null) return;
    const video = videoRef.current;
    if (!video) return;
    const seekTime = pendingSeek.current;
    pendingSeek.current = null;
    const apply = () => {
      video.currentTime = seekTime;
      setCurrentTime(seekTime);
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
  }, [videoRef, activeClipIndex]);

  const seekToClip = useCallback((clipId) => {
    const idx = clips?.findIndex(c => c.id === clipId) ?? -1;
    if (idx < 0) return;
    setActiveClipIndex(idx);
    setCurrentTime(0);
    const video = videoRef.current;
    if (video && idx === activeClipIndex) {
      video.currentTime = 0;
    }
  }, [clips, videoRef, activeClipIndex]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }, [videoRef]);

  const restart = useCallback(() => {
    setActiveClipIndex(0);
    setCurrentTime(0);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.play();
    }
  }, [videoRef]);

  const seekVirtual = useCallback((t) => {
    const clamped = Math.max(0, Math.min(t, totalVirtualDuration));
    for (let i = segments.length - 1; i >= 0; i--) {
      if (clamped >= segments[i].virtualStart - 0.05) {
        const localTime = clamped - segments[i].virtualStart;
        if (i === activeClipIndex) {
          const video = videoRef.current;
          if (video) video.currentTime = localTime;
          setCurrentTime(localTime);
        } else {
          pendingSeek.current = localTime;
          setActiveClipIndex(i);
          setCurrentTime(localTime);
        }
        break;
      }
    }
  }, [segments, totalVirtualDuration, activeClipIndex, videoRef]);

  const seekWithinSegment = useCallback((actualTime) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = actualTime;
    setCurrentTime(actualTime);
  }, [videoRef]);

  const startScrub = useCallback(() => {
    isScrubbing.current = true;
    videoRef.current?.pause();
  }, [videoRef]);

  const endScrub = useCallback(() => {
    isScrubbing.current = false;
    videoRef.current?.play();
  }, [videoRef]);

  const changePlaybackRate = useCallback((rate) => {
    setPlaybackRate(rate);
  }, []);

  return {
    isPlaying,
    virtualTime,
    totalVirtualDuration,
    segments,
    activeClipId,
    activeClipName,
    currentSegment,
    playbackRate,
    seekToClip,
    togglePlay,
    restart,
    seekVirtual,
    seekWithinSegment,
    startScrub,
    endScrub,
    changePlaybackRate,
    streamUrl,
    activeClipIndex,
  };
}
