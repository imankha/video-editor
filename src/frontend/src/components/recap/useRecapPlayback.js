import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

export function useRecapPlayback(videoRef, clips) {
  const segments = useMemo(() => {
    if (!clips || clips.length === 0) return [];
    return clips.map(clip => ({
      clipId: clip.id,
      startTime: clip.recap_start,
      endTime: clip.recap_end,
      virtualStart: clip.recap_start,
      virtualEnd: clip.recap_end,
      duration: clip.recap_end - clip.recap_start,
    }));
  }, [clips]);

  const totalVirtualDuration = useMemo(() => {
    if (segments.length === 0) return 0;
    return segments[segments.length - 1].virtualEnd;
  }, [segments]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [virtualTime, setVirtualTime] = useState(0);
  const [activeClipId, setActiveClipId] = useState(clips?.[0]?.id ?? null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const isScrubbing = useRef(false);
  const rafRef = useRef(null);

  const findActiveSegment = useCallback((time) => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (time >= segments[i].startTime - 0.05) return segments[i];
    }
    return segments[0] || null;
  }, [segments]);

  useEffect(() => {
    const tick = () => {
      const video = videoRef.current;
      if (!video || isScrubbing.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const t = video.currentTime;
      setVirtualTime(t);

      const seg = findActiveSegment(t);
      if (seg) setActiveClipId(seg.clipId);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [videoRef, findActiveSegment]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [videoRef, playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setIsPlaying(!video.paused);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [videoRef, totalVirtualDuration]);

  const seekToClip = useCallback((clipId) => {
    const seg = segments.find(s => s.clipId === clipId);
    if (!seg || !videoRef.current) return;
    videoRef.current.currentTime = seg.startTime;
    setVirtualTime(seg.startTime);
    setActiveClipId(clipId);
  }, [segments, videoRef]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }, [videoRef]);

  const restart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setVirtualTime(0);
    setActiveClipId(segments[0]?.clipId ?? null);
    video.play();
  }, [videoRef, segments]);

  const seekVirtual = useCallback((t) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(t, totalVirtualDuration));
    video.currentTime = clamped;
    setVirtualTime(clamped);
    const seg = findActiveSegment(clamped);
    if (seg) setActiveClipId(seg.clipId);
  }, [videoRef, totalVirtualDuration, findActiveSegment]);

  const seekWithinSegment = useCallback((actualTime) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = actualTime;
    setVirtualTime(actualTime);
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

  const currentSegment = useMemo(() => {
    return segments.find(s => s.clipId === activeClipId) || null;
  }, [segments, activeClipId]);

  const activeClipName = useMemo(() => {
    if (!clips || !activeClipId) return '';
    const clip = clips.find(c => c.id === activeClipId);
    return clip?.name || '';
  }, [clips, activeClipId]);

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
  };
}
