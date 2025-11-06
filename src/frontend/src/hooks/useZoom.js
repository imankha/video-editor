import { useState, useCallback } from 'react';

/**
 * Custom hook for managing video player zoom and pan state
 */
export default function useZoom() {
  const [zoom, setZoom] = useState(1); // 1 = 100%
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  const MIN_ZOOM = 0.25; // 25%
  const MAX_ZOOM = 4; // 400%
  const ZOOM_STEP = 0.25; // 25% increment

  /**
   * Zoom in by one step
   */
  const zoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  /**
   * Zoom out by one step
   */
  const zoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, []);

  /**
   * Reset zoom to 100% and center pan
   */
  const resetZoom = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  /**
   * Set zoom to specific level
   */
  const setZoomLevel = useCallback((level) => {
    setZoom(Math.max(MIN_ZOOM, Math.min(level, MAX_ZOOM)));
  }, []);

  /**
   * Zoom by mouse wheel (with focal point)
   */
  const zoomByWheel = useCallback((delta, focalPoint = null) => {
    const zoomFactor = delta > 0 ? 1.1 : 0.9;

    setZoom(prev => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(prev * zoomFactor, MAX_ZOOM));

      // If focal point provided, adjust pan to zoom towards that point
      if (focalPoint && newZoom !== prev) {
        setPanOffset(prevOffset => {
          const zoomChange = newZoom / prev;
          return {
            x: focalPoint.x - (focalPoint.x - prevOffset.x) * zoomChange,
            y: focalPoint.y - (focalPoint.y - prevOffset.y) * zoomChange
          };
        });
      }

      return newZoom;
    });
  }, []);

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
