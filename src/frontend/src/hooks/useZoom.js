import { useState, useCallback } from 'react';

/**
 * Custom hook for managing video player zoom and pan state
 */
export default function useZoom() {
  const [zoom, setZoom] = useState(1); // 1 = 100%
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  const MIN_ZOOM = 1; // 100% - never zoom out beyond full size to avoid black bars
  const MAX_ZOOM = 4; // 400%
  const ZOOM_STEP = 0.25; // 25% increment

  const applyZoom = useCallback((nextZoom) => {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(nextZoom, MAX_ZOOM));

    setZoom(clampedZoom);
    if (clampedZoom === MIN_ZOOM) {
      setPanOffset((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }));
    }
  }, []);

  /**
   * Zoom in by one step
   */
  const zoomIn = useCallback(() => {
    applyZoom(zoom + ZOOM_STEP);
  }, [applyZoom, zoom]);

  /**
   * Zoom out by one step
   */
  const zoomOut = useCallback(() => {
    applyZoom(zoom - ZOOM_STEP);
  }, [applyZoom, zoom]);

  /**
   * Reset zoom to 100% and center pan. Idempotent -- a caller that resets
   * unconditionally on some OTHER gesture (e.g. a text position preset click,
   * T10790) shouldn't force a fresh panOffset object (and the re-render that
   * comes with it) when the preview is already centered.
   */
  const resetZoom = useCallback(() => {
    setZoom((prev) => (prev === 1 ? prev : 1));
    setPanOffset((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }));
  }, []);

  /**
   * Set zoom to specific level
   */
  const setZoomLevel = useCallback((level) => {
    applyZoom(level);
  }, [applyZoom]);

  /**
   * Zoom by mouse wheel (center-based, no focal point)
   */
  const zoomByWheel = useCallback((delta) => {
    const zoomFactor = delta > 0 ? 1.1 : 0.9;

    applyZoom(zoom * zoomFactor);

    // Always zoom to center - don't adjust pan offset
  }, [applyZoom, zoom]);

  /**
   * Update pan offset
   */
  const updatePan = useCallback((deltaX, deltaY) => {
    setPanOffset(prev => ({
      x: prev.x + deltaX,
      y: prev.y + deltaY
    }));
  }, []);

  /**
   * Set pan offset to specific values
   */
  const setPan = useCallback((x, y) => {
    setPanOffset({ x, y });
  }, []);

  /**
   * Check if zoomed (not at 100%)
   */
  const isZoomed = zoom !== 1 || panOffset.x !== 0 || panOffset.y !== 0;

  return {
    // State
    zoom,
    panOffset,
    isZoomed,
    MIN_ZOOM,
    MAX_ZOOM,
    ZOOM_STEP,

    // Actions
    zoomIn,
    zoomOut,
    resetZoom,
    setZoomLevel,
    zoomByWheel,
    updatePan,
    setPan
  };
}
