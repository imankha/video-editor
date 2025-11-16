import { useState, useCallback } from 'react';

/**
 * Hook for managing timeline zoom state
 *
 * Zoom interpretation:
 * - 100% = Timeline fits exactly in viewport (no scrollbar needed)
 * - >100% = Timeline is larger than viewport (scrollbar appears)
 * - Cannot zoom out below 100%
 */
export default function useTimelineZoom() {
  // Zoom level as percentage (100 = fits viewport, >100 = larger than viewport)
  const [timelineZoom, setTimelineZoom] = useState(100);

  // Scroll position as percentage (0-100)
  const [scrollPosition, setScrollPosition] = useState(0);

  // Constraints
  const MIN_ZOOM = 100;  // 100% = fits exactly in viewport (no scrollbar)
  const MAX_ZOOM = 500;  // 500% = timeline is 5x wider than viewport
  const ZOOM_STEP = 25;  // 25% per step
  const WHEEL_SENSITIVITY = 0.25; // How much to zoom per wheel delta

  /**
   * Zoom in (increase zoom percentage, up to 100% max)
   */
  const zoomIn = useCallback(() => {
    setTimelineZoom(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  /**
   * Zoom out (decrease zoom percentage)
   */
  const zoomOut = useCallback(() => {
    setTimelineZoom(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, []);

  /**
   * Handle mousewheel zoom
   * @param {number} deltaY - Wheel delta (negative = scroll up = zoom in)
   */
  const zoomByWheel = useCallback((deltaY) => {
    setTimelineZoom(prev => {
      // Negative deltaY = scroll up = zoom in
      // Positive deltaY = scroll down = zoom out
      const delta = -deltaY * WHEEL_SENSITIVITY;
      const newZoom = prev + delta;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
    });
  }, []);

  /**
   * Reset zoom to default (fit in view)
   */
  const resetZoom = useCallback(() => {
    setTimelineZoom(MIN_ZOOM);
    setScrollPosition(0);
  }, []);

  /**
   * Update scroll position
   * @param {number} position - New scroll position (0-100)
   */
  const updateScrollPosition = useCallback((position) => {
    setScrollPosition(Math.max(0, Math.min(100, position)));
  }, []);

  /**
   * Check if timeline is zoomed in (above 100%)
   */
  const isZoomedIn = timelineZoom > MIN_ZOOM;

  /**
   * Get the scale factor for the timeline width
   * At 100% zoom, scale = 1 (timeline fits exactly in viewport)
   * At 200% zoom, scale = 2 (timeline is 2x wider, needs scrollbar)
   * At 500% zoom, scale = 5 (timeline is 5x wider)
   */
  const getTimelineScale = useCallback(() => {
    // Direct mapping: 100% = 1x, 200% = 2x, 500% = 5x
    return timelineZoom / 100;
  }, [timelineZoom]);

  return {
    timelineZoom,
    scrollPosition,
    isZoomedIn,
    MIN_ZOOM,
    MAX_ZOOM,
    zoomIn,
    zoomOut,
    zoomByWheel,
    resetZoom,
    updateScrollPosition,
    getTimelineScale,
  };
}
