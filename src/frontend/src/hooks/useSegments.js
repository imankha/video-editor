import { useState, useCallback, useMemo } from 'react';
import { timeToFrame, frameToTime } from '../utils/videoUtils';

/**
 * Hook to manage video segments with speed control and trimming
 *
 * ARCHITECTURE: Uses frame-based identifiers for stability
 * - Boundaries are stored as times (seconds) for easy display/editing
 * - Trimmed segments are identified by frame ranges (e.g., "0-450")
 * - This avoids index shifting bugs when boundaries are added/removed
 * - Frame numbers are integers, avoiding floating-point comparison issues
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

  // Set of frame range keys for trimmed segments (e.g., "0-450", "900-1200")
  // Using frame ranges instead of indices prevents bugs when boundaries shift
  const [trimmedSegments, setTrimmedSegments] = useState(new Set());

  // Duration of the video (set when video loads)
  const [duration, setDuration] = useState(null);

  // Framerate for frame calculations (matches useCrop)
  const [framerate] = useState(30);

  /**
   * Helper: Create a frame range key from time boundaries
   * Returns string like "0-450" for segment from 0s to 15s @ 30fps
   */
  const createFrameRangeKey = useCallback((startTime, endTime) => {
    const startFrame = timeToFrame(startTime, framerate);
    const endFrame = timeToFrame(endTime, framerate);
    return `${startFrame}-${endFrame}`;
  }, [framerate]);

  /**
   * Helper: Check if a segment (by time range) is trimmed
   */
  const isSegmentTrimmed = useCallback((startTime, endTime) => {
    const key = createFrameRangeKey(startTime, endTime);
    return trimmedSegments.has(key);
  }, [trimmedSegments, createFrameRangeKey]);

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
   * Uses frame-based range keys for stable identification
   */
  const toggleTrimSegment = useCallback((segmentIndex) => {
    if (boundaries.length < 2) return;

    const numSegments = boundaries.length - 1;
    if (segmentIndex < 0 || segmentIndex >= numSegments) return;

    // Get the time range for this segment
    const segmentStart = boundaries[segmentIndex];
    const segmentEnd = boundaries[segmentIndex + 1];
    const segmentKey = createFrameRangeKey(segmentStart, segmentEnd);

    setTrimmedSegments(prev => {
      const currentTrimmed = new Set(prev);

      // Find first and last non-trimmed segments
      let firstNonTrimmed = -1;
      let lastNonTrimmed = -1;

      for (let i = 0; i < numSegments; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const key = createFrameRangeKey(start, end);

        if (!currentTrimmed.has(key)) {
          if (firstNonTrimmed === -1) firstNonTrimmed = i;
          lastNonTrimmed = i;
        }
      }

      // Only allow trimming/restoring segments at the edges of visible segments
      const isAtEdge = segmentIndex === firstNonTrimmed || segmentIndex === lastNonTrimmed;
      const isCurrentlyTrimmed = currentTrimmed.has(segmentKey);

      // Allow if: (1) restoring a trimmed segment, OR (2) trimming an edge segment
      if (!isCurrentlyTrimmed && !isAtEdge) return prev;

      const newSet = new Set(prev);
      if (newSet.has(segmentKey)) {
        console.log('[useSegments] Restoring segment', segmentIndex, 'with key:', segmentKey);
        newSet.delete(segmentKey);
      } else {
        console.log('[useSegments] Trimming segment', segmentIndex, 'with key:', segmentKey);
        newSet.add(segmentKey);
      }
      return newSet;
    });
  }, [boundaries, createFrameRangeKey]);

  /**
   * Get all segments with their properties (DERIVED STATE)
   * Uses frame-based keys to check trim status
   */
  const segments = useMemo(() => {
    if (boundaries.length < 2) return [];

    const result = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const speed = segmentSpeeds[i] || 1;
      const frameKey = createFrameRangeKey(start, end);
      const isTrimmed = trimmedSegments.has(frameKey);
      const actualDuration = end - start;
      const visualDuration = actualDuration / speed;

      result.push({
        index: i,
        start,
        end,
        speed,
        isTrimmed,
        frameKey, // Include for debugging/reference
        isFirst: false, // Will be set below
        isLast: false,  // Will be set below
        actualDuration,
        visualDuration
      });
    }

    // Calculate isFirst and isLast based on non-trimmed segments
    // Find first non-trimmed segment
    const firstNonTrimmedIndex = result.findIndex(s => !s.isTrimmed);
    if (firstNonTrimmedIndex !== -1) {
      result[firstNonTrimmedIndex].isFirst = true;
    }

    // Find last non-trimmed segment
    const lastNonTrimmedIndex = result.length - 1 - [...result].reverse().findIndex(s => !s.isTrimmed);
    if (lastNonTrimmedIndex !== -1 && lastNonTrimmedIndex < result.length) {
      result[lastNonTrimmedIndex].isLast = true;
    }

    return result;
  }, [boundaries, segmentSpeeds, trimmedSegments, createFrameRangeKey]);

  /**
   * Calculate the visual (effective) duration after all segment modifications (DERIVED STATE)
   * This is what the user will actually see/experience
   */
  const visualDuration = useMemo(() => {
    return segments
      .filter(s => !s.isTrimmed)
      .reduce((sum, s) => sum + s.visualDuration, 0);
  }, [segments]);

  /**
   * Calculate total trimmed duration (DERIVED STATE)
   */
  const trimmedDuration = useMemo(() => {
    return segments
      .filter(s => s.isTrimmed)
      .reduce((sum, s) => sum + s.actualDuration, 0);
  }, [segments]);

  /**
   * Calculate segment visual positions for rendering (DERIVED STATE)
   * Returns array of {segment, visualStart%, visualWidth%}
   */
  const segmentVisualLayout = useMemo(() => {
    if (visualDuration === 0) return [];

    let cumulativeVisualPosition = 0;

    return segments
      .filter(s => !s.isTrimmed)
      .map(segment => {
        const visualWidthPercent = (segment.visualDuration / visualDuration) * 100;
        const visualStartPercent = cumulativeVisualPosition;

        cumulativeVisualPosition += visualWidthPercent;

        return {
          segment,
          visualStartPercent,
          visualWidthPercent
        };
      });
  }, [segments, visualDuration]);

  /**
   * Get the current segment and speed at a given time
   * Uses frame-based keys to check trim status
   */
  const getSegmentAtTime = useCallback((time) => {
    for (let i = 0; i < boundaries.length - 1; i++) {
      if (time >= boundaries[i] && time < boundaries[i + 1]) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const frameKey = createFrameRangeKey(start, end);
        return {
          index: i,
          start,
          end,
          speed: segmentSpeeds[i] || 1,
          isTrimmed: trimmedSegments.has(frameKey)
        };
      }
    }
    // Handle case where time is exactly at the end
    if (boundaries.length >= 2 && Math.abs(time - boundaries[boundaries.length - 1]) < 0.01) {
      const i = boundaries.length - 2;
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const frameKey = createFrameRangeKey(start, end);
      return {
        index: i,
        start,
        end,
        speed: segmentSpeeds[i] || 1,
        isTrimmed: trimmedSegments.has(frameKey)
      };
    }
    return null;
  }, [boundaries, segmentSpeeds, trimmedSegments, createFrameRangeKey]);

  /**
   * Get export data for segments (only include if speed changes exist)
   * Uses frame-based keys to check trim status
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

      // Check if first segment is trimmed (using frame-based key)
      if (boundaries.length >= 2) {
        const firstSegmentKey = createFrameRangeKey(boundaries[0], boundaries[1]);
        if (trimmedSegments.has(firstSegmentKey)) {
          startTime = boundaries[1];
        }
      }

      // Check if last segment is trimmed (using frame-based key)
      if (boundaries.length >= 2) {
        const lastIndex = boundaries.length - 2;
        const lastSegmentKey = createFrameRangeKey(boundaries[lastIndex], boundaries[lastIndex + 1]);
        if (trimmedSegments.has(lastSegmentKey)) {
          endTime = boundaries[lastIndex];
        }
      }

      result.trim_start = startTime;
      result.trim_end = endTime;
    }

    // Add segment speed data
    // IMPORTANT: If we have any speed changes, we must send ALL segments (including normal ones)
    // because FFmpeg needs to concat them together in the correct order
    if (hasSpeedChanges) {
      const speedSegments = [];

      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const frameKey = createFrameRangeKey(start, end);

        // Skip trimmed segments (using frame-based key)
        if (trimmedSegments.has(frameKey)) {
          continue;
        }

        // Include ALL non-trimmed segments, with their speed (default to 1 if not set)
        const speed = segmentSpeeds[i] || 1;
        speedSegments.push({
          start,
          end,
          speed
        });
      }

      if (speedSegments.length > 0) {
        result.segments = speedSegments;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }, [boundaries, segmentSpeeds, trimmedSegments, duration, createFrameRangeKey]);

  /**
   * Check if a time should be visible (not in trimmed segment)
   */
  const isTimeVisible = useCallback((time) => {
    const segment = getSegmentAtTime(time);
    return segment ? !segment.isTrimmed : true;
  }, [getSegmentAtTime]);

  /**
   * Convert source time to visual time (accounts for speed changes)
   * Uses frame-based keys to check trim status
   * @param {number} sourceTime - Time in the original video
   * @returns {number} - Visual time after speed adjustments
   */
  const sourceTimeToVisualTime = useCallback((sourceTime) => {
    if (boundaries.length < 2) return sourceTime;

    let visualTime = 0;

    for (let i = 0; i < boundaries.length - 1; i++) {
      const segmentStart = boundaries[i];
      const segmentEnd = boundaries[i + 1];
      const speed = segmentSpeeds[i] || 1;
      const frameKey = createFrameRangeKey(segmentStart, segmentEnd);
      const isTrimmed = trimmedSegments.has(frameKey);

      // Skip trimmed segments
      if (isTrimmed) continue;

      if (sourceTime <= segmentStart) {
        // Before this segment
        break;
      } else if (sourceTime >= segmentEnd) {
        // After this segment - add its full visual duration
        visualTime += (segmentEnd - segmentStart) / speed;
      } else {
        // Within this segment
        const timeInSegment = sourceTime - segmentStart;
        visualTime += timeInSegment / speed;
        break;
      }
    }

    return visualTime;
  }, [boundaries, segmentSpeeds, trimmedSegments, createFrameRangeKey]);

  /**
   * Convert visual time to source time (inverse of sourceTimeToVisualTime)
   * Uses frame-based keys to check trim status
   * @param {number} visualTime - Visual time after speed adjustments
   * @returns {number} - Time in the original video
   */
  const visualTimeToSourceTime = useCallback((visualTime) => {
    if (boundaries.length < 2) return visualTime;

    let remainingVisualTime = visualTime;

    for (let i = 0; i < boundaries.length - 1; i++) {
      const segmentStart = boundaries[i];
      const segmentEnd = boundaries[i + 1];
      const speed = segmentSpeeds[i] || 1;
      const frameKey = createFrameRangeKey(segmentStart, segmentEnd);
      const isTrimmed = trimmedSegments.has(frameKey);

      // Skip trimmed segments
      if (isTrimmed) continue;

      const segmentActualDuration = segmentEnd - segmentStart;
      const segmentVisualDuration = segmentActualDuration / speed;

      if (remainingVisualTime <= segmentVisualDuration) {
        // Time is within this segment
        const sourceTimeInSegment = remainingVisualTime * speed;
        return segmentStart + sourceTimeInSegment;
      } else {
        // Time is beyond this segment
        remainingVisualTime -= segmentVisualDuration;
      }
    }

    // If we've gone through all segments, return the end
    return boundaries[boundaries.length - 1];
  }, [boundaries, segmentSpeeds, trimmedSegments, createFrameRangeKey]);

  return {
    // Raw state
    boundaries,
    segments,
    sourceDuration: duration, // Original video duration
    framerate,                 // Frame rate for frame-based calculations

    // Derived state (auto-updates when segments change)
    visualDuration,      // Effective duration after speed/trim
    trimmedDuration,     // Total trimmed time
    segmentVisualLayout, // Pre-calculated visual positions

    // Actions
    initializeWithDuration,
    reset,
    addBoundary,
    removeBoundary,
    setSegmentSpeed,
    toggleTrimSegment,

    // Queries
    getSegmentAtTime,
    getExportData,
    isTimeVisible,
    sourceTimeToVisualTime,
    visualTimeToSourceTime,

    // Helpers (for coordinated operations with crop)
    createFrameRangeKey,
    isSegmentTrimmed
  };
}
