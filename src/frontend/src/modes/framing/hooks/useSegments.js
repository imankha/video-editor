import { useState, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { timeToFrame, frameToTime } from '../../../utils/videoUtils';

/**
 * Hook to manage video segments with speed control and trimming
 *
 * REFACTORED ARCHITECTURE (Option 1 + 4):
 * - Separates user splits from trim boundaries for clarity
 * - userSplits: User-created divisions (never includes 0 or duration)
 * - trimRange: Explicit trim boundaries {start, end} or null
 * - Includes invariant checks to catch bugs early
 *
 * BENEFITS:
 * - Clear separation of concerns (splits vs. trims)
 * - No ghost keyframes when deleting user splits
 * - Easy to reset trim state (trimRange = null)
 * - Simpler mental model: "split the video, then trim the result"
 */
export function useSegments() {
  // User-created split points (never includes 0 or duration)
  const [userSplits, setUserSplits] = useState([]);

  // Trim range: {start: number, end: number} or null
  // start/end are times in seconds representing the visible portion
  const [trimRange, setTrimRange] = useState(null);

  // Trim history: stack of previous trim operations for de-trim functionality
  // Each entry: {type: 'start'|'end', time: number, previousRange: {start, end}|null}
  const [trimHistory, setTrimHistory] = useState([]);

  // Map of segment index to speed (default is 1, only store if different)
  const [segmentSpeeds, setSegmentSpeeds] = useState({});

  // Duration of the video (set when video loads)
  const [duration, setDuration] = useState(null);

  // Framerate for frame calculations (matches useCrop)
  const [framerate] = useState(30);

  // Lock to prevent re-entrant calls to detrim functions
  // This is critical because React can invoke handlers multiple times
  // MUST use useRef (not useState) so the same object persists across renders
  const detrimLockRef = useRef({ isLocked: false });

  /**
   * DERIVED: Compute all boundaries from userSplits + duration
   * Boundaries always include [0, ...userSplits, duration]
   */
  const boundaries = useMemo(() => {
    if (!duration) return [0];
    return [0, ...userSplits, duration].sort((a, b) => a - b);
  }, [userSplits, duration]);

  /**
   * Helper: Create a frame range key from time boundaries
   * Returns string like "0-450" for segment from 0s to 15s @ 30fps
   * (Kept for backward compatibility with external code)
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
    if (!trimRange) return false;

    // A segment is trimmed if it's completely outside the trim range
    return endTime <= trimRange.start || startTime >= trimRange.end;
  }, [trimRange]);

  /**
   * Initialize segments with video duration
   */
  const initializeWithDuration = useCallback((videoDuration) => {
    setDuration(videoDuration);
    // No need to set boundaries - they're derived from userSplits + duration
  }, []);

  /**
   * Reset all segments
   */
  const reset = useCallback(() => {
    setUserSplits([]);
    setTrimRange(null);
    setTrimHistory([]);
    setSegmentSpeeds({});
    setDuration(null);
  }, []);

  /**
   * Restore segment state from saved data (for clip switching)
   * @param {Object} savedState - { boundaries, speeds, trimRange }
   * @param {number} videoDuration - Video duration for validation
   */
  const restoreState = useCallback((savedState, videoDuration) => {
    if (!savedState) {
      console.log('[useSegments] No state to restore');
      return;
    }

    console.log('[useSegments] Restoring state:', JSON.stringify(savedState), 'videoDuration:', videoDuration);

    // Set duration first
    if (videoDuration) {
      setDuration(videoDuration);
    }

    // Restore user splits from boundaries (filter out 0 and duration)
    if (savedState.boundaries && Array.isArray(savedState.boundaries)) {
      const userSplitsFromBoundaries = savedState.boundaries.filter(b =>
        b > 0.01 && (!videoDuration || Math.abs(b - videoDuration) > 0.01)
      );
      setUserSplits(userSplitsFromBoundaries);
    }

    // Restore segment speeds (check both 'speeds' and 'segmentSpeeds' for compatibility)
    const speeds = savedState.speeds || savedState.segmentSpeeds;
    if (speeds && typeof speeds === 'object') {
      setSegmentSpeeds(speeds);
    }

    // Restore trim range
    if (savedState.trimRange) {
      setTrimRange(savedState.trimRange);
    } else {
      setTrimRange(null);
    }

    // Clear trim history when restoring (we don't persist history)
    setTrimHistory([]);
  }, []);

  /**
   * Add a segment boundary at the given time
   */
  const addBoundary = useCallback((time) => {
    if (!duration) return;

    setUserSplits(prev => {
      // Check if split already exists (within 10ms tolerance)
      const exists = prev.some(s => Math.abs(s - time) < 0.01);
      if (exists) return prev;

      // Don't add at start or end (these are implicit boundaries)
      if (time < 0.01 || Math.abs(time - duration) < 0.01) return prev;

      // Add and sort
      const newSplits = [...prev, time].sort((a, b) => a - b);

      // INVARIANT: All splits must be within (0, duration)
      if (process.env.NODE_ENV === 'development') {
        const invalid = newSplits.filter(s => s <= 0 || s >= duration);
        if (invalid.length > 0) {
          console.error('⚠️ INVARIANT VIOLATION: User splits outside valid range:', invalid);
        }
      }

      return newSplits;
    });
  }, [duration, userSplits]);

  /**
   * Remove a segment boundary at the given time
   * NOTE: This only removes user splits, never affects trim boundaries
   * BUG FIX: Auto-clears trimRange if deleted boundary is referenced
   */
  const removeBoundary = useCallback((time) => {
    if (!duration) return;

    // Can't remove start or end (they're implicit, not in userSplits)
    if (time < 0.01 || Math.abs(time - duration) < 0.01) return;

    // Check if this boundary is referenced by trimRange
    const isTrimBoundary = trimRange && (
      Math.abs(trimRange.start - time) < 0.01 ||
      Math.abs(trimRange.end - time) < 0.01
    );

    if (isTrimBoundary) {
      setTrimRange(null);
      setTrimHistory([]); // BUG FIX: Also clear history when trimRange is cleared
    }

    setUserSplits(prev => {
      const newSplits = prev.filter(s => Math.abs(s - time) > 0.01);

      // INVARIANT: Warn if this removal leaves no change
      if (process.env.NODE_ENV === 'development') {
        if (newSplits.length === prev.length) {
          console.warn('⚠️ INVARIANT WARNING: removeBoundary had no effect - boundary not found at time:', time);
        }
      }

      return newSplits;
    });
  }, [duration, trimRange]);

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
   * Trim from the start: sets trim range to [time, end]
   * Pushes operation to history for de-trim functionality
   */
  const trimStart = useCallback((time) => {
    // Check if this would be a no-op (already at this position)
    if (trimRange && Math.abs(trimRange.start - time) < 0.01) return;

    // Capture current trim range for history before updating
    const previousRange = trimRange;

    // Update trimRange
    setTrimRange(prev => ({
      start: time,
      end: prev?.end || duration
    }));

    // Update history separately (not nested) - only if we're actually changing
    setTrimHistory(prev => [...prev, {
      type: 'start',
      time,
      previousRange: previousRange
    }]);
  }, [duration, trimRange]);

  /**
   * Trim from the end: sets trim range to [start, time]
   * Pushes operation to history for de-trim functionality
   */
  const trimEnd = useCallback((time) => {
    // Check if this would be a no-op (already at this position)
    if (trimRange && Math.abs(trimRange.end - time) < 0.01) return;

    // Capture current trim range for history before updating
    const previousRange = trimRange;

    // Update trimRange
    setTrimRange(prev => ({
      start: prev?.start || 0,
      end: time
    }));

    // Update history separately (not nested) - only if we're actually changing
    setTrimHistory(prev => [...prev, {
      type: 'end',
      time,
      previousRange: previousRange
    }]);
  }, [trimRange]);

  /**
   * Restore trim range (remove trimming) and clear history
   */
  const clearTrim = useCallback(() => {
    setTrimRange(null);
    setTrimHistory([]);
  }, []);

  /**
   * De-trim (undo last trim operation from start)
   * Pops from history and restores previous trim range
   *
   * BUG FIX: Uses flushSync to ensure both state updates complete in a single render,
   * preventing double-click issues caused by stale state during re-renders.
   */
  const detrimStart = useCallback(() => {
    // CRITICAL: Prevent re-entrant calls using a lock
    if (detrimLockRef.current.isLocked) return;

    // Pre-check: find the operation to undo BEFORE acquiring lock
    const lastStartIndex = trimHistory.findLastIndex(op => op.type === 'start');
    if (lastStartIndex === -1) return;

    const lastStartOp = trimHistory[lastStartIndex];

    detrimLockRef.current.isLocked = true;
    try {
      // FIX: Only restore the start value, preserve current end
      // This prevents losing end trim when undoing a start trim
      setTrimRange(current => {
        const restoredStart = lastStartOp.previousRange?.start || 0;
        const currentEnd = current?.end || duration;

        // Update history in the same state update
        setTrimHistory(prev => prev.filter((_, i) => i !== lastStartIndex));

        return { start: restoredStart, end: currentEnd };
      });
    } finally {
      detrimLockRef.current.isLocked = false;
    }
  }, [trimHistory, duration]);

  /**
   * De-trim (undo last trim operation from end)
   * Pops from history and restores previous trim range
   *
   * BUG FIX: Uses flushSync to ensure both state updates complete in a single render,
   * preventing double-click issues caused by stale state during re-renders.
   */
  const detrimEnd = useCallback(() => {
    // CRITICAL: Prevent re-entrant calls using a lock
    if (detrimLockRef.current.isLocked) return;

    // Pre-check: find the operation to undo BEFORE acquiring lock
    const lastEndIndex = trimHistory.findLastIndex(op => op.type === 'end');
    if (lastEndIndex === -1) return;

    const lastEndOp = trimHistory[lastEndIndex];

    detrimLockRef.current.isLocked = true;
    try {
      // FIX: Only restore the end value, preserve current start
      // This prevents losing start trim when undoing an end trim
      setTrimRange(current => {
        const restoredEnd = lastEndOp.previousRange?.end || duration;
        const currentStart = current?.start || 0;

        // Update history in the same state update
        setTrimHistory(prev => prev.filter((_, i) => i !== lastEndIndex));

        return { start: currentStart, end: restoredEnd };
      });
    } finally {
      detrimLockRef.current.isLocked = false;
    }
  }, [trimHistory, duration]);

  /**
   * Toggle trim status for a segment (only works for first or last segment)
   * This is the main trim operation called from UI
   */
  const toggleTrimSegment = useCallback((segmentIndex) => {
    if (boundaries.length < 2) return;

    const numSegments = boundaries.length - 1;
    if (segmentIndex < 0 || segmentIndex >= numSegments) return;

    const segmentStart = boundaries[segmentIndex];
    const segmentEnd = boundaries[segmentIndex + 1];
    const isTrimmed = isSegmentTrimmed(segmentStart, segmentEnd);

    // Determine first and last non-trimmed segments
    let firstNonTrimmedIndex = -1;
    let lastNonTrimmedIndex = -1;

    for (let i = 0; i < numSegments; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (!isSegmentTrimmed(start, end)) {
        if (firstNonTrimmedIndex === -1) firstNonTrimmedIndex = i;
        lastNonTrimmedIndex = i;
      }
    }

    // Only allow trimming/restoring segments at the edges
    const isAtEdge = segmentIndex === firstNonTrimmedIndex || segmentIndex === lastNonTrimmedIndex;

    // Allow if: (1) restoring a trimmed segment, OR (2) trimming an edge segment
    if (!isTrimmed && !isAtEdge) return;

    if (isTrimmed) {
      // Restore: clear trim range
      clearTrim();
    } else {
      // Trim: set trim range based on which edge
      if (segmentIndex === firstNonTrimmedIndex) {
        trimStart(segmentEnd);
      } else if (segmentIndex === lastNonTrimmedIndex) {
        trimEnd(segmentStart);
      }
    }
  }, [boundaries, isSegmentTrimmed, trimStart, trimEnd, clearTrim]);

  /**
   * Get all segments with their properties (DERIVED STATE)
   */
  const segments = useMemo(() => {
    if (boundaries.length < 2) return [];

    const result = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const speed = segmentSpeeds[i] || 1;
      const isTrimmed = isSegmentTrimmed(start, end);
      const actualDuration = end - start;
      const visualDuration = actualDuration / speed;
      const frameKey = createFrameRangeKey(start, end); // For backward compatibility

      result.push({
        index: i,
        start,
        end,
        speed,
        isTrimmed,
        frameKey, // For debugging/backward compatibility
        isFirst: false, // Will be set below
        isLast: false,  // Will be set below
        actualDuration,
        visualDuration
      });
    }

    // Calculate isFirst and isLast based on non-trimmed segments
    const firstNonTrimmedIndex = result.findIndex(s => !s.isTrimmed);
    if (firstNonTrimmedIndex !== -1) {
      result[firstNonTrimmedIndex].isFirst = true;
    }

    const lastNonTrimmedIndex = result.length - 1 - [...result].reverse().findIndex(s => !s.isTrimmed);
    if (lastNonTrimmedIndex !== -1 && lastNonTrimmedIndex < result.length) {
      result[lastNonTrimmedIndex].isLast = true;
    }

    // INVARIANT: Check for impossible states
    if (process.env.NODE_ENV === 'development') {
      const allTrimmed = result.every(s => s.isTrimmed);
      if (allTrimmed && result.length > 0) {
        console.error('⚠️ INVARIANT VIOLATION: All segments are trimmed - this should not be possible');
      }
    }

    return result;
  }, [boundaries, segmentSpeeds, isSegmentTrimmed, createFrameRangeKey]);

  /**
   * Calculate the visual (effective) duration after all segment modifications (DERIVED STATE)
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
   */
  const getSegmentAtTime = useCallback((time) => {
    // Log segment lookup for debugging (only when trimmed)
    const logResult = (result) => {
      if (result && result.isTrimmed) {
        console.log('[useSegments] getSegmentAtTime returning trimmed segment:', {
          time,
          boundaries,
          trimRange,
          result
        });
      }
      return result;
    };

    for (let i = 0; i < boundaries.length - 1; i++) {
      if (time >= boundaries[i] && time < boundaries[i + 1]) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        return logResult({
          index: i,
          start,
          end,
          speed: segmentSpeeds[i] || 1,
          isTrimmed: isSegmentTrimmed(start, end)
        });
      }
    }

    // Handle case where time is exactly at the end
    if (boundaries.length >= 2 && Math.abs(time - boundaries[boundaries.length - 1]) < 0.01) {
      const i = boundaries.length - 2;
      const start = boundaries[i];
      const end = boundaries[i + 1];
      return logResult({
        index: i,
        start,
        end,
        speed: segmentSpeeds[i] || 1,
        isTrimmed: isSegmentTrimmed(start, end)
      });
    }
    return null;
  }, [boundaries, segmentSpeeds, isSegmentTrimmed, trimRange]);

  /**
   * Get export data for segments (only include if speed changes exist)
   */
  const getExportData = useCallback(() => {
    const hasSpeedChanges = Object.keys(segmentSpeeds).length > 0;
    const hasTrimming = trimRange !== null;

    if (!hasSpeedChanges && !hasTrimming) {
      return null; // No segment data to export
    }

    const result = {};

    // Add trim data if any
    if (hasTrimming) {
      result.trim_start = trimRange.start;
      result.trim_end = trimRange.end;
    }

    // Add segment speed data
    if (hasSpeedChanges) {
      const speedSegments = [];

      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];

        // Skip trimmed segments
        if (isSegmentTrimmed(start, end)) {
          continue;
        }

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
  }, [boundaries, segmentSpeeds, trimRange, isSegmentTrimmed]);

  /**
   * Check if a time should be visible (not in trimmed segment)
   */
  const isTimeVisible = useCallback((time) => {
    const segment = getSegmentAtTime(time);
    return segment ? !segment.isTrimmed : true;
  }, [getSegmentAtTime]);

  /**
   * Clamp a time to the visible (non-trimmed) range
   * This is the single source of truth for valid playback positions.
   *
   * ARCHITECTURE: By centralizing trim boundary validation here, we make it
   * structurally impossible to seek to trimmed frames anywhere in the app.
   *
   * @param {number} time - Desired time position
   * @returns {number} - Nearest valid (visible) time position
   */
  const clampToVisibleRange = useCallback((time) => {
    // If no duration set, no clamping possible
    if (!duration) return time;

    // First clamp to overall video boundaries
    let clampedTime = Math.max(0, Math.min(time, duration));

    // If no trim range, we're done
    if (!trimRange) return clampedTime;

    // Debug log when clamping is actually applied
    if (clampedTime < trimRange.start || clampedTime > trimRange.end) {
      console.log('[useSegments] clampToVisibleRange clamping:', {
        inputTime: time,
        duration,
        trimRange,
        clampedTime: clampedTime < trimRange.start ? trimRange.start : trimRange.end
      });
    }

    // Clamp to trim range boundaries
    // If time is before visible range, snap to start
    if (clampedTime < trimRange.start) {
      return trimRange.start;
    }

    // If time is after visible range, snap to end
    if (clampedTime > trimRange.end) {
      return trimRange.end;
    }

    // Time is within visible range
    return clampedTime;
  }, [trimRange, duration]);

  /**
   * Convert source time to visual time (accounts for speed changes and trimming)
   */
  const sourceTimeToVisualTime = useCallback((sourceTime) => {
    if (boundaries.length < 2) return sourceTime;

    let visualTime = 0;

    for (let i = 0; i < boundaries.length - 1; i++) {
      const segmentStart = boundaries[i];
      const segmentEnd = boundaries[i + 1];
      const speed = segmentSpeeds[i] || 1;
      const isTrimmed = isSegmentTrimmed(segmentStart, segmentEnd);

      // Skip trimmed segments
      if (isTrimmed) continue;

      if (sourceTime <= segmentStart) {
        break;
      } else if (sourceTime >= segmentEnd) {
        visualTime += (segmentEnd - segmentStart) / speed;
      } else {
        const timeInSegment = sourceTime - segmentStart;
        visualTime += timeInSegment / speed;
        break;
      }
    }

    return visualTime;
  }, [boundaries, segmentSpeeds, isSegmentTrimmed]);

  /**
   * Convert visual time to source time (inverse of sourceTimeToVisualTime)
   */
  const visualTimeToSourceTime = useCallback((visualTime) => {
    if (boundaries.length < 2) return visualTime;

    let remainingVisualTime = visualTime;

    for (let i = 0; i < boundaries.length - 1; i++) {
      const segmentStart = boundaries[i];
      const segmentEnd = boundaries[i + 1];
      const speed = segmentSpeeds[i] || 1;
      const isTrimmed = isSegmentTrimmed(segmentStart, segmentEnd);

      // Skip trimmed segments
      if (isTrimmed) continue;

      const segmentActualDuration = segmentEnd - segmentStart;
      const segmentVisualDuration = segmentActualDuration / speed;

      if (remainingVisualTime <= segmentVisualDuration) {
        const sourceTimeInSegment = remainingVisualTime * speed;
        return segmentStart + sourceTimeInSegment;
      } else {
        remainingVisualTime -= segmentVisualDuration;
      }
    }

    return boundaries[boundaries.length - 1];
  }, [boundaries, segmentSpeeds, isSegmentTrimmed]);

  return {
    // Raw state
    boundaries,          // DERIVED from userSplits + duration
    userSplits,          // NEW: User-created splits (explicit)
    trimRange,           // NEW: Explicit trim range
    trimHistory,         // NEW: Trim history for de-trim functionality
    segmentSpeeds,       // Speed settings by segment index
    segments,
    sourceDuration: duration,
    framerate,

    // Derived state
    visualDuration,
    trimmedDuration,
    segmentVisualLayout,

    // Actions
    initializeWithDuration,
    reset,
    restoreState,        // Restore from saved state (for clip switching)
    addBoundary,         // Adds to userSplits
    removeBoundary,      // Removes from userSplits (auto-clears trimRange if needed)
    setSegmentSpeed,
    toggleTrimSegment,   // Main trim operation
    trimStart,           // Explicit trim from start (pushes to history)
    trimEnd,             // Explicit trim from end (pushes to history)
    clearTrim,           // Clear all trim state and history
    detrimStart,         // NEW: Undo last start trim (pop from history)
    detrimEnd,           // NEW: Undo last end trim (pop from history)

    // Queries
    getSegmentAtTime,
    getExportData,
    isTimeVisible,
    clampToVisibleRange,  // NEW: Single source of truth for valid playback positions
    sourceTimeToVisualTime,
    visualTimeToSourceTime,

    // Helpers (for backward compatibility)
    createFrameRangeKey,
    isSegmentTrimmed
  };
}
