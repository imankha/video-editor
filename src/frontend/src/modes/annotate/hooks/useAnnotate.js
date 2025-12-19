import { useState, useCallback, useMemo, useEffect } from 'react';
import { formatTimeSimple } from '../../../utils/timeFormat';

/**
 * useAnnotate - Manages clip regions for extracting clips from full game footage
 *
 * DATA MODEL:
 * - clipRegions: Array of clip region objects, each with:
 *   - id: unique identifier
 *   - startTime: region start in seconds
 *   - endTime: region end in seconds (calculated from startTime + duration)
 *   - name: clip name (auto-generated from rating + tags, or user-provided)
 *   - position: player position (attacker, midfielder, defender, goalie)
 *   - tags: array of tag names for the clip
 *   - notes: user notes (max 280 chars, shown as overlay during playback)
 *   - rating: 1-5 star rating (default 3)
 *   - color: region display color (auto-assigned)
 *   - createdAt: creation timestamp
 *
 * Rating notation on timeline:
 * - 1 star -> ??
 * - 2 star -> ?
 * - 3 star -> !?
 * - 4 star -> !
 * - 5 star -> !!
 */

const DEFAULT_CLIP_DURATION = 15.0; // seconds
const MIN_CLIP_DURATION = 1.0; // seconds (enforced)
const MAX_CLIP_DURATION = 60.0; // seconds (max for slider)
const MAX_NOTES_LENGTH = 280; // characters (like a tweet)
const DEFAULT_RATING = 3; // default star rating

// Rating to notation map
const RATING_NOTATION = {
  1: '??',
  2: '?',
  3: '!?',
  4: '!',
  5: '!!'
};

// Color palette for clip regions (auto-assigned cyclically)
const CLIP_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

/**
 * Format time as HH:MM:SS for clip default names
 */
function formatTimestampForName(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Generate a unique ID for clip regions
 */
function generateClipId() {
  return `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default function useAnnotate(videoMetadata) {
  // Clip regions
  const [clipRegions, setClipRegions] = useState([]);

  // Selected region for editing
  const [selectedRegionId, setSelectedRegionId] = useState(null);

  // Source video duration
  const [duration, setDuration] = useState(null);

  // Color index for auto-assignment
  const [colorIndex, setColorIndex] = useState(0);

  /**
   * Auto-initialize duration from videoMetadata when it changes
   */
  useEffect(() => {
    if (videoMetadata?.duration) {
      console.log('[useAnnotate] Auto-initializing with duration:', videoMetadata.duration);
      setDuration(videoMetadata.duration);
    }
  }, [videoMetadata?.duration]);

  /**
   * Initialize with video duration
   */
  const initialize = useCallback((videoDuration) => {
    setDuration(videoDuration);
    setClipRegions([]);
    setSelectedRegionId(null);
    setColorIndex(0);
  }, []);

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    setClipRegions([]);
    setSelectedRegionId(null);
    setDuration(null);
    setColorIndex(0);
  }, []);

  /**
   * Derived: Regions with visual layout info
   */
  const regionsWithLayout = useMemo(() => {
    if (!duration) return [];

    return clipRegions.map((region, index) => {
      const regionDuration = region.endTime - region.startTime;
      return {
        ...region,
        index,
        duration: regionDuration,
        visualStartPercent: (region.startTime / duration) * 100,
        visualWidthPercent: (regionDuration / duration) * 100
      };
    });
  }, [clipRegions, duration]);

  /**
   * Get selected region
   */
  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null;
    return clipRegions.find(r => r.id === selectedRegionId) || null;
  }, [clipRegions, selectedRegionId]);

  /**
   * Add a new clip region at the specified time
   * @param {number} startTime - Start time in seconds
   * @param {number} customDuration - Optional custom duration (default: 15s)
   * @param {string} notes - Optional notes for the clip
   * @param {number} rating - Optional rating (1-5, default: 3)
   * @param {string} position - Optional position (attacker, midfielder, defender, goalie)
   * @param {Array} tags - Optional array of tag names
   * @param {string} name - Optional clip name (auto-generated if not provided)
   */
  const addClipRegion = useCallback((startTime, customDuration = DEFAULT_CLIP_DURATION, notes = '', rating = DEFAULT_RATING, position = '', tags = [], name = '') => {
    console.log('[useAnnotate] addClipRegion called with startTime:', startTime, 'duration:', duration, 'notes:', notes, 'rating:', rating, 'position:', position, 'tags:', tags, 'name:', name);
    if (!duration) {
      console.warn('[useAnnotate] Cannot add clip region - no duration set');
      return null;
    }

    // Clamp start time to valid range
    const clampedStart = Math.max(0, Math.min(startTime, duration - MIN_CLIP_DURATION));

    // Calculate end time, clamping to video duration
    const endTime = Math.min(clampedStart + customDuration, duration);

    // Ensure minimum duration
    const actualEndTime = Math.max(endTime, clampedStart + MIN_CLIP_DURATION);

    // Auto-assign color
    const color = CLIP_COLORS[colorIndex % CLIP_COLORS.length];

    // Create new clip region
    const newRegion = {
      id: generateClipId(),
      startTime: clampedStart,
      endTime: Math.min(actualEndTime, duration),
      name: name || formatTimestampForName(clampedStart),
      position: position || '',
      tags: tags || [],
      notes: notes || '',
      rating: rating || DEFAULT_RATING,
      color,
      createdAt: new Date()
    };

    setClipRegions(prev => [...prev, newRegion]);
    setColorIndex(prev => prev + 1);
    setSelectedRegionId(newRegion.id);

    return newRegion;
  }, [duration, colorIndex]);

  /**
   * Update a clip region's properties
   * @param {string} regionId - Region ID to update
   * @param {Object} updates - Properties to update
   */
  const updateClipRegion = useCallback((regionId, updates) => {
    setClipRegions(prev => prev.map(region => {
      if (region.id !== regionId) return region;

      const updated = { ...region };

      // Handle end time update (recalculate start time based on current duration)
      if (updates.endTime !== undefined) {
        const currentDuration = region.endTime - region.startTime;
        updated.endTime = Math.max(MIN_CLIP_DURATION, Math.min(updates.endTime, duration || Infinity));
        // Recalculate start time to maintain duration
        updated.startTime = Math.max(0, updated.endTime - currentDuration);
      }

      // Handle start time update (recalculate end time based on current duration)
      if (updates.startTime !== undefined) {
        const currentDuration = region.endTime - region.startTime;
        updated.startTime = Math.max(0, Math.min(updates.startTime, (duration || Infinity) - MIN_CLIP_DURATION));
        // Recalculate end time to maintain duration
        updated.endTime = Math.min(updated.startTime + currentDuration, duration || Infinity);
      }

      // Handle duration update (recalculate start time from end - duration)
      if (updates.duration !== undefined) {
        const clampedDuration = Math.max(MIN_CLIP_DURATION, Math.min(updates.duration, MAX_CLIP_DURATION));
        // Keep end time fixed, adjust start time
        updated.startTime = Math.max(0, region.endTime - clampedDuration);
        // If start would go below 0, adjust end time instead
        if (updated.startTime === 0) {
          updated.endTime = Math.min(clampedDuration, duration || Infinity);
        }
      }

      // Handle name update
      if (updates.name !== undefined) {
        updated.name = updates.name;
      }

      // Handle notes update (enforce max length)
      if (updates.notes !== undefined) {
        updated.notes = updates.notes.slice(0, MAX_NOTES_LENGTH);
      }

      // Handle rating update (1-5)
      if (updates.rating !== undefined) {
        updated.rating = Math.max(1, Math.min(5, Math.round(updates.rating)));
      }

      // Handle position update
      if (updates.position !== undefined) {
        updated.position = updates.position;
      }

      // Handle tags update
      if (updates.tags !== undefined) {
        updated.tags = updates.tags;
      }

      return updated;
    }));
  }, [duration]);

  /**
   * Delete a clip region
   * @param {string} regionId - Region ID to delete
   */
  const deleteClipRegion = useCallback((regionId) => {
    setClipRegions(prev => {
      const newRegions = prev.filter(r => r.id !== regionId);

      // If deleted region was selected, select another one
      if (selectedRegionId === regionId) {
        const deletedIndex = prev.findIndex(r => r.id === regionId);
        if (newRegions.length > 0) {
          // Select the previous region, or the first one if deleting the first
          const newSelectedIndex = Math.max(0, deletedIndex - 1);
          setSelectedRegionId(newRegions[newSelectedIndex]?.id || null);
        } else {
          setSelectedRegionId(null);
        }
      }

      return newRegions;
    });
  }, [selectedRegionId]);

  /**
   * Select a clip region
   * @param {string} regionId - Region ID to select (null to deselect)
   */
  const selectRegion = useCallback((regionId) => {
    setSelectedRegionId(regionId);
  }, []);

  /**
   * Move a region's start time (for lever dragging)
   * @param {string} regionId - Region ID
   * @param {number} newStartTime - New start time in seconds
   */
  const moveRegionStart = useCallback((regionId, newStartTime) => {
    updateClipRegion(regionId, { startTime: newStartTime });
  }, [updateClipRegion]);

  /**
   * Move a region's end time (for lever dragging)
   * @param {string} regionId - Region ID
   * @param {number} newEndTime - New end time in seconds
   */
  const moveRegionEnd = useCallback((regionId, newEndTime) => {
    updateClipRegion(regionId, { endTime: newEndTime });
  }, [updateClipRegion]);

  /**
   * Get the region at a specific time
   * @param {number} time - Time in seconds
   * @returns {Object|null} - Region at time or null
   */
  const getRegionAtTime = useCallback((time) => {
    return clipRegions.find(r => time >= r.startTime && time <= r.endTime) || null;
  }, [clipRegions]);

  /**
   * Check if there are any overlapping regions
   * @returns {Array} - Array of overlapping region pairs
   */
  const getOverlappingRegions = useCallback(() => {
    const overlaps = [];
    for (let i = 0; i < clipRegions.length; i++) {
      for (let j = i + 1; j < clipRegions.length; j++) {
        const a = clipRegions[i];
        const b = clipRegions[j];
        // Check if regions overlap
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          overlaps.push([a, b]);
        }
      }
    }
    return overlaps;
  }, [clipRegions]);

  /**
   * Check if any regions exceed the max clip duration
   * @returns {Array} - Array of regions exceeding max duration
   */
  const getLongRegions = useCallback(() => {
    return clipRegions.filter(r => (r.endTime - r.startTime) > MAX_CLIP_DURATION);
  }, [clipRegions]);

  /**
   * Get export data for all clip regions
   * @returns {Array} - Array of clip data for export
   */
  const getExportData = useCallback(() => {
    return clipRegions.map(region => ({
      start_time: region.startTime,
      end_time: region.endTime,
      name: region.name,
      position: region.position,
      tags: region.tags,
      notes: region.notes,
      rating: region.rating
    }));
  }, [clipRegions]);

  /**
   * Check if we have any clips defined
   */
  const hasClips = clipRegions.length > 0;

  /**
   * Get clip count
   */
  const clipCount = clipRegions.length;

  return {
    // State
    clipRegions,
    regionsWithLayout,
    selectedRegionId,
    selectedRegion,
    duration,
    hasClips,
    clipCount,

    // Actions
    initialize,
    reset,
    addClipRegion,
    updateClipRegion,
    deleteClipRegion,
    selectRegion,
    moveRegionStart,
    moveRegionEnd,

    // Queries
    getRegionAtTime,
    getOverlappingRegions,
    getLongRegions,
    getExportData,

    // Constants (exposed for UI)
    MAX_NOTES_LENGTH,
    MIN_CLIP_DURATION,
    MAX_CLIP_DURATION,
    DEFAULT_CLIP_DURATION,
    DEFAULT_RATING,
    RATING_NOTATION
  };
}
