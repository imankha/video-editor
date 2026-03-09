import { useState, useEffect, useCallback } from 'react';

/**
 * Determines if entering fullscreen would meaningfully increase the video's rendered size.
 * Uses object-contain math to compare fitted video area in current container vs viewport.
 * Returns true when already in fullscreen (so the exit button is always shown).
 */
export function useFullscreenWorthwhile(videoRef, isFullscreen) {
  const [isWorthwhile, setIsWorthwhile] = useState(true);

  const check = useCallback(() => {
    // Always show button when in fullscreen (need exit button)
    if (isFullscreen) {
      setIsWorthwhile(true);
      return;
    }

    const video = videoRef?.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setIsWorthwhile(true);
      return;
    }

    const videoAR = video.videoWidth / video.videoHeight;

    // Find the constraining container
    const container = video.closest('.video-container');
    if (!container) {
      setIsWorthwhile(true);
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setIsWorthwhile(true);
      return;
    }

    // Compute rendered video area in current container (object-contain)
    const containerAR = rect.width / rect.height;
    let currentW, currentH;
    if (videoAR > containerAR) {
      currentW = rect.width;
      currentH = rect.width / videoAR;
    } else {
      currentH = rect.height;
      currentW = rect.height * videoAR;
    }

    // Compute rendered video area if fullscreen
    // Controls + timeline overlay on video letterbox bars, so full viewport is available
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const vpAR = vpW / vpH;
    let fsW, fsH;
    if (videoAR > vpAR) {
      fsW = vpW;
      fsH = vpW / videoAR;
    } else {
      fsH = vpH;
      fsW = vpH * videoAR;
    }

    // Compare areas — if less than 20% area gain, not worthwhile
    const currentArea = currentW * currentH;
    const fsArea = fsW * fsH;
    const gain = fsArea / currentArea;
    setIsWorthwhile(gain > 1.2);
  }, [videoRef, isFullscreen]);

  useEffect(() => {
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [check]);

  // Re-check when video metadata loads
  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return;
    video.addEventListener('loadedmetadata', check);
    return () => video.removeEventListener('loadedmetadata', check);
  }, [videoRef, check]);

  return isWorthwhile;
}
