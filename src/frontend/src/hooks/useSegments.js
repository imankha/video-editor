import { useState, useCallback, useMemo } from 'react';

/**
 * Hook to manage video segments with speed control and trimming
 *
 * Segments are defined by boundaries (vertical lines at specific times).
 * Each segment between boundaries can have a speed (0.5x, 1x, 2x).
 * Segments at the start or end can be trimmed (hidden).
 */
export function useSegments() {
  // Array of boundary times (always includes 0 and will include duration when set)
  const [boundaries, setBoundaries] = useState([0]);

  // Map of segment index to speed (default is 1, only store if different)
  const [segmentSpeeds, setSegmentSpeeds] = useState({});

  // Set of segment indices that are trimmed
  const [trimmedSegments, setTrimmedSegments] = useState(new Set());

  // Duration of the video (set when video loads)
  const [duration, setDuration] = useState(null);

  /**
   * Initialize segments with video duration
   */
  const initializeWithDuration = useCallback((videoDuration) => {
    setDuration(videoDuration);
    // Ensure we have end boundary
    setBoundaries(prev => {
      if (prev.length === 1 && prev[0] === 0) {
        return [0, videoDuration];
      }
      return prev;
    });
  }, []);

  /**
   * Reset all segments
   */
  const reset = useCallback(() => {
    setBoundaries([0]);
    setSegmentSpeeds({});
    setTrimmedSegments(new Set());
    setDuration(null);
  }, []);

  /**
   * Add a segment boundary at the given time
   */
  const addBoundary = useCallback((time) => {
    console.log('[useSegments] addBoundary called with time:', time);
    console.log('[useSegments] Current duration:', duration);
    console.log('[useSegments] Current boundaries:', boundaries);

    if (!duration) {
      console.log('[useSegments] No duration set, ignoring');
      return;
    }

    setBoundaries(prev => {
      // Check if boundary already exists (within 10ms tolerance)
      const exists = prev.some(b => Math.abs(b - time) < 0.01);
      if (exists) {
        console.log('[useSegments] Boundary already exists at this time');
        return prev;
      }

      // Don't add at start or end
      if (time < 0.01 || Math.abs(time - duration) < 0.01) {
        console.log('[useSegments] Cannot add boundary at start or end');
        return prev;
      }

      // Add and sort
      const newBoundaries = [...prev, time].sort((a, b) => a - b);
      console.log('[useSegments] New boundaries:', newBoundaries);
      return newBoundaries;
    });
  }, [duration, boundaries]);

  /**
   * Remove a segment boundary at the given time
   */
  const removeBoundary = useCallback((time) => {
    if (!duration) return;

    setBoundaries(prev => {
      // Can't remove start or end boundaries
      if (time < 0.01 || Math.abs(time - duration) < 0.01) return prev;

      // Must keep at least 2 boundaries (start and end)
      if (prev.length <= 2) return prev;

      return prev.filter(b => Math.abs(b - time) > 0.01);
    });
  }, [duration]);

  /**
   * Set speed for a segment (identified by index)
   */
  const setSegmentSpeed = useCallback((segmentIndex, speed) => {
    setSegmentSpeeds(prev => {
      // If speed is 1 (default), remove from map
      if (speed === 1) {
        const newSpeeds = { ...prev };
        delete newSpeeds[segmentIndex];
        return newSpeeds;
      }

      return {
        ...prev,
        [segmentIndex]: speed
      };
    });
  }, []);

  /**
   * Toggle trim status for a segment (only works for first or last segment)
   */
  const toggleTrimSegment = useCallback((segmentIndex) => {
    const numSegments = boundaries.length - 1;

    // Only allow trimming first or last segment
    if (segmentIndex !== 0 && segmentIndex !== numSegments - 1) return;

    setTrimmedSegments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(segmentIndex)) {
        newSet.delete(segmentIndex);
      } else {
        newSet.add(segmentIndex);
      }
      return newSet;
    });
  }, [boundaries]);

  /**
   * Get all segments with their properties
   */
  const segments = useMemo(() => {
    if (boundaries.length < 2) return [];

    const result = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      result.push({
        index: i,
        start: boundaries[i],
        end: boundaries[i + 1],
        speed: segmentSpeeds[i] || 1,
        isTrimmed: trimmedSegments.has(i),
        isFirst: i === 0,
        isLast: i === boundaries.length - 2
      });
    }
    return result;
  }, [boundaries, segmentSpeeds, trimmedSegments]);

  /**
   * Get the current segment and speed at a given time
   */
  const getSegmentAtTime = useCallback((time) => {
    for (let i = 0; i < boundaries.length - 1; i++) {
      if (time >= boundaries[i] && time < boundaries[i + 1]) {
        return {
          index: i,
          start: boundaries[i],
          end: boundaries[i + 1],
          speed: segmentSpeeds[i] || 1,
          isTrimmed: trimmedSegments.has(i)
        };
      }
    }
    // Handle case where time is exactly at the end
    if (boundaries.length >= 2 && Math.abs(time - boundaries[boundaries.length - 1]) < 0.01) {
      const i = boundaries.length - 2;
      return {
        index: i,
        start: boundaries[i],
        end: boundaries[i + 1],
        speed: segmentSpeeds[i] || 1,
        isTrimmed: trimmedSegments.has(i)
      };
    }
    return null;
  }, [boundaries, segmentSpeeds, trimmedSegments]);

  /**
   * Get export data for segments (only include if speed changes exist)
   */
  const getExportData = useCallback(() => {
    // Check if we have any non-default speeds
    const hasSpeedChanges = Object.keys(segmentSpeeds).length > 0;
    const hasTrimming = trimmedSegments.size > 0;

    if (!hasSpeedChanges && !hasTrimming) {
      return null; // No segment data to export
    }

    const result = {};

    // Add trim data if any
    if (hasTrimming) {
      let startTime = 0;
      let endTime = duration;

      // If first segment is trimmed
      if (trimmedSegments.has(0) && boundaries.length >= 2) {
        startTime = boundaries[1];
      }

      // If last segment is trimmed
      const lastIndex = boundaries.length - 2;
      if (trimmedSegments.has(lastIndex) && boundaries.length >= 2) {
        endTime = boundaries[lastIndex];
      }

      result.trim_start = startTime;
      result.trim_end = endTime;
    }

    // Add segment speed data (only for segments with speed != 1)
    if (hasSpeedChanges) {
      const speedSegments = [];

      for (let i = 0; i < boundaries.length - 1; i++) {
        const speed = segmentSpeeds[i];
        if (speed && speed !== 1 && !trimmedSegments.has(i)) {
          speedSegments.push({
            start: boundaries[i],
            end: boundaries[i + 1],
            speed: speed
          });
        }
      }

      if (speedSegments.length > 0) {
        result.segments = speedSegments;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }, [boundaries, segmentSpeeds, trimmedSegments, duration]);

  /**
   * Check if a time should be visible (not in trimmed segment)
   */
  const isTimeVisible = useCallback((time) => {
    const segment = getSegmentAtTime(time);
    return segment ? !segment.isTrimmed : true;
  }, [getSegmentAtTime]);

  return {
    boundaries,
    segments,
    duration,
    initializeWithDuration,
    reset,
    addBoundary,
    removeBoundary,
    setSegmentSpeed,
    toggleTrimSegment,
    getSegmentAtTime,
    getExportData,
    isTimeVisible
  };
}
