import { useState, useRef, useCallback } from 'react';
import { pixelToTime, timeToPixel } from '../utils/timeFormat';

/**
 * Custom hook for timeline interaction
 * @param {number} duration - Video duration in seconds
 * @param {Function} onSeek - Callback when user seeks to new time
 * @returns {Object} Timeline state and handlers
 */
export function useTimeline(duration, onSeek) {
  const timelineRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState(null);

  /**
   * Get timeline width in pixels
   * @returns {number} Timeline width
   */
  const getTimelineWidth = useCallback(() => {
    if (!timelineRef.current) return 0;
    return timelineRef.current.offsetWidth;
  }, []);

  /**
   * Get X coordinate relative to timeline
   * @param {MouseEvent} event - Mouse event
   * @returns {number} X coordinate in pixels
   */
  const getRelativeX = useCallback((event) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(event.clientX - rect.left, rect.width));
  }, []);

  /**
   * Handle timeline click
   */
  const handleTimelineClick = useCallback((event) => {
    const x = getRelativeX(event);
    const width = getTimelineWidth();
    const time = pixelToTime(x, duration, width);
    onSeek(time);
  }, [duration, onSeek, getRelativeX, getTimelineWidth]);

  /**
   * Start dragging
   */
  const handleMouseDown = useCallback((event) => {
    setIsDragging(true);
    handleTimelineClick(event);
  }, [handleTimelineClick]);

  /**
   * Update during drag
   */
  const handleMouseMove = useCallback((event) => {
    const x = getRelativeX(event);
    const width = getTimelineWidth();
    const time = pixelToTime(x, duration, width);

    setHoverTime(time);

    if (isDragging) {
      onSeek(time);
    }
  }, [isDragging, duration, onSeek, getRelativeX, getTimelineWidth]);

  /**
   * End dragging
   */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  /**
   * Handle mouse leave
   */
  const handleMouseLeave = useCallback(() => {
    setHoverTime(null);
    setIsDragging(false);
  }, []);

  /**
   * Calculate playhead position
   * @param {number} currentTime - Current video time
   * @returns {number} Playhead position in pixels
   */
  const getPlayheadPosition = useCallback((currentTime) => {
    const width = getTimelineWidth();
    return timeToPixel(currentTime, duration, width);
  }, [duration, getTimelineWidth]);

  return {
    timelineRef,
    isDragging,
    hoverTime,
    getPlayheadPosition,
    handlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
      onClick: handleTimelineClick,
    }
  };
}
