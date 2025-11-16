import { useState, useCallback } from 'react';

/**
 * Hook for managing timeline zoom state
 *
 * Zoom interpretation:
 * - 100% = Maximum zoom (most detail, timeline is widest, scrollbar needed)
 * - Lower percentages = More zoomed out (timeline fits more content)
 * - Cannot zoom in past 100%
 */
export default function useTimelineZoom() {
  // Zoom level as percentage (100 = max zoom, lower = more zoomed out)
  // Start at MIN_ZOOM so timeline fits in view initially
  const [timelineZoom, setTimelineZoom] = useState(10);

  // Scroll position as percentage (0-100)
  const [scrollPosition, setScrollPosition] = useState(0);

  // Constraints
  const MIN_ZOOM = 10;  // 10% = very zoomed out (fits in view, no scrollbar)
  const MAX_ZOOM = 100; // 100% = maximum zoom (can't go past this, needs scrollbar)
  const ZOOM_STEP = 10; // 10% per step
  const WHEEL_SENSITIVITY = 0.1; // How much to zoom per wheel delta

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
   * Check if timeline is zoomed out (less than 100%)
   */
  const isZoomedOut = timelineZoom < MAX_ZOOM;

  /**
   * Get the scale factor for the timeline width
   * At 100% zoom, scale = 1 (timeline fits exactly)
   * At 50% zoom, scale = 0.5 (timeline is half width)
   * At 200% zoom (if we allowed it), scale = 2 (timeline is double width)
   *
   * But since we want scrollbar when zoomed in (to 100%), we invert:
   * At 100% zoom = maximum detail = timeline should be wide (e.g., 5x normal)
   * At lower zoom = less detail = timeline fits in view
   */
  const getTimelineScale = useCallback(() => {
    // Map 10-100% zoom to 1x-5x scale
    // 100% zoom = 5x scale (widest, needs scroll)
    // 10% zoom = 1x scale (fits in view)
    const minScale = 1;
    const maxScale = 5;
    const normalizedZoom = (timelineZoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
    return minScale + normalizedZoom * (maxScale - minScale);
  }, [timelineZoom]);

  return {
    timelineZoom,
    scrollPosition,
    isZoomedOut,
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
