import { useState, useCallback, useMemo } from 'react';
import { timeToFrame, frameToTime } from '../../../utils/videoUtils';
import { interpolateHighlightSpline } from '../../../utils/splineInterpolation';

/**
 * useHighlightRegions - Manages highlight regions as self-contained units
 *
 * DATA MODEL:
 * - regions: Array of region objects, each with:
 *   - id: unique identifier
 *   - startTime: region start in seconds
 *   - endTime: region end in seconds
 *   - enabled: boolean
 *   - keyframes: Array of keyframes within this region
 *
 * Each region has at least 2 keyframes (start and end, both permanent).
 * When user clicks on timeline, a 5-second region is created with auto-generated keyframes.
 */

const DEFAULT_REGION_DURATION = 5.0; // seconds
const MIN_REGION_DURATION = 0.5; // seconds
const TIME_EPSILON = 0.001; // 1ms tolerance for floating point comparison
const MIN_KEYFRAME_DISTANCE_FRAMES = 5; // Minimum 5 frames (~0.167s at 30fps) between keyframes

export default function useHighlightRegions(videoMetadata) {
  // Store regions directly (not derived from boundaries)
  const [regions, setRegions] = useState([]);

  // Selected region for editing
  const [selectedRegionId, setSelectedRegionId] = useState(null);

  // Copied keyframe data for paste
  const [copiedData, setCopiedData] = useState(null);

  // Duration and framerate
  const [duration, setDuration] = useState(null);
  const framerate = 30;

  /**
   * Derived: All boundaries from regions (for compatibility with RegionLayer)
   */
  const boundaries = useMemo(() => {
    if (!duration) return [0];
    const allBoundaries = new Set([0, duration]);
    regions.forEach(region => {
      allBoundaries.add(region.startTime);
      allBoundaries.add(region.endTime);
    });
    return Array.from(allBoundaries).sort((a, b) => a - b);
  }, [regions, duration]);

  /**
   * Derived: Regions with visual layout info for RegionLayer
   */
  const regionsWithLayout = useMemo(() => {
    if (!duration) return [];

    return regions.map((region, index) => {
      const regionDuration = region.endTime - region.startTime;
      return {
        ...region,
        index,
        duration: regionDuration,
        isFirst: index === 0,
        isLast: index === regions.length - 1,
        visualStartPercent: (region.startTime / duration) * 100,
        visualWidthPercent: (regionDuration / duration) * 100
      };
    });
  }, [regions, duration]);

  /**
   * Get all keyframes from all regions (for compatibility)
   */
  const allKeyframes = useMemo(() => {
    return regions.flatMap(region => region.keyframes || []);
  }, [regions]);

  /**
   * Calculate the default highlight ellipse (centered in video)
   */
  const calculateDefaultHighlight = useCallback((videoWidth, videoHeight) => {
    if (!videoWidth || !videoHeight) {
      return { x: 0, y: 0, radiusX: 30, radiusY: 50, opacity: 0.15, color: '#FFFF00' };
    }

    const radiusX = Math.round(videoHeight * 0.06);
    const radiusY = Math.round(videoHeight * 0.12);
    const x = Math.round(videoWidth / 2);
    const y = Math.round(videoHeight / 2);

    return {
      x,
      y,
      radiusX,
      radiusY,
      opacity: 0.15,
      color: '#FFFF00'
    };
  }, []);

  /**
   * Initialize with video duration
   */
  const initializeWithDuration = useCallback((videoDuration) => {
    setDuration(videoDuration);
  }, []);

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    setRegions([]);
    setSelectedRegionId(null);
    setCopiedData(null);
    setDuration(null);
  }, []);

  /**
   * Generate unique region ID
   */
  const generateRegionId = () => `region-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  /**
   * Check if a new region would overlap with existing regions
   */
  const wouldOverlap = useCallback((startTime, endTime, excludeRegionId = null) => {
    return regions.some(region => {
      if (region.id === excludeRegionId) return false;
      // Check for overlap: regions overlap if one starts before the other ends
      return startTime < region.endTime && endTime > region.startTime;
    });
  }, [regions]);

  /**
   * Add a new 5-second region at the given time
   * Creates start and end keyframes automatically
   */
  const addRegion = useCallback((clickTime) => {
    if (!duration) return null;

    // Calculate region bounds
    let startTime = clickTime;
    let endTime = Math.min(clickTime + DEFAULT_REGION_DURATION, duration);

    // Ensure minimum duration
    if (endTime - startTime < MIN_REGION_DURATION) {
      // Try to extend backwards if at end of video
      startTime = Math.max(0, endTime - MIN_REGION_DURATION);
      if (endTime - startTime < MIN_REGION_DURATION) {
        console.warn('[useHighlightRegions] Cannot create region - not enough space');
        return null;
      }
    }

    // Check for overlap
    if (wouldOverlap(startTime, endTime)) {
      console.warn('[useHighlightRegions] Cannot create region - would overlap existing region');
      return null;
    }

    // Create default highlight data
    const defaultHighlight = calculateDefaultHighlight(
      videoMetadata?.width,
      videoMetadata?.height
    );

    const regionId = generateRegionId();
    const startFrame = timeToFrame(startTime, framerate);
    const endFrame = timeToFrame(endTime, framerate);

    // Snap times to exact frame boundaries to avoid floating point precision issues
    const snappedStartTime = frameToTime(startFrame, framerate);
    const snappedEndTime = frameToTime(endFrame, framerate);

    const newRegion = {
      id: regionId,
      startTime: snappedStartTime,
      endTime: snappedEndTime,
      enabled: true,
      keyframes: [
        {
          frame: startFrame,
          ...defaultHighlight,
          origin: 'permanent'
        },
        {
          frame: endFrame,
          ...defaultHighlight,
          origin: 'permanent'
        }
      ]
    };

    setRegions(prev => [...prev, newRegion].sort((a, b) => a.startTime - b.startTime));
    setSelectedRegionId(regionId);

    return regionId;
  }, [duration, wouldOverlap, calculateDefaultHighlight, videoMetadata, framerate]);

  /**
   * Delete a region by ID
   */
  const deleteRegion = useCallback((regionId) => {
    setRegions(prev => prev.filter(r => r.id !== regionId));
    if (selectedRegionId === regionId) {
      setSelectedRegionId(null);
    }
  }, [selectedRegionId]);

  /**
   * Delete a region by index
   */
  const deleteRegionByIndex = useCallback((regionIndex) => {
    const region = regions[regionIndex];
    if (region) {
      deleteRegion(region.id);
    }
  }, [regions, deleteRegion]);

  /**
   * Move region start boundary (for lever dragging)
   */
  const moveRegionStart = useCallback((regionId, newStartTime) => {
    setRegions(prev => prev.map(region => {
      if (region.id !== regionId) return region;

      // Clamp to valid range
      const minStart = 0;
      const maxStart = region.endTime - MIN_REGION_DURATION;
      const clampedStart = Math.max(minStart, Math.min(newStartTime, maxStart));

      // Check for overlap with previous region
      const prevRegion = prev.filter(r => r.endTime <= region.startTime).pop();
      const actualStart = prevRegion
        ? Math.max(clampedStart, prevRegion.endTime)
        : clampedStart;

      // Update start keyframe frame number
      const startFrame = timeToFrame(actualStart, framerate);
      // Snap time to exact frame boundary to avoid floating point precision issues
      const snappedStart = frameToTime(startFrame, framerate);

      const updatedKeyframes = region.keyframes.map((kf, idx) => {
        if (idx === 0 && kf.origin === 'permanent') {
          return { ...kf, frame: startFrame };
        }
        return kf;
      });

      return {
        ...region,
        startTime: snappedStart,
        keyframes: updatedKeyframes
      };
    }));
  }, [framerate]);

  /**
   * Move region end boundary (for lever dragging)
   */
  const moveRegionEnd = useCallback((regionId, newEndTime) => {
    setRegions(prev => prev.map(region => {
      if (region.id !== regionId) return region;

      // Clamp to valid range
      const minEnd = region.startTime + MIN_REGION_DURATION;
      const maxEnd = duration || Infinity;
      const clampedEnd = Math.max(minEnd, Math.min(newEndTime, maxEnd));

      // Check for overlap with next region
      const nextRegion = prev.find(r => r.startTime >= region.endTime);
      const actualEnd = nextRegion
        ? Math.min(clampedEnd, nextRegion.startTime)
        : clampedEnd;

      // Update end keyframe frame number
      const endFrame = timeToFrame(actualEnd, framerate);
      // Snap time to exact frame boundary to avoid floating point precision issues
      const snappedEnd = frameToTime(endFrame, framerate);

      const updatedKeyframes = region.keyframes.map((kf, idx) => {
        if (idx === region.keyframes.length - 1 && kf.origin === 'permanent') {
          return { ...kf, frame: endFrame };
        }
        return kf;
      });

      return {
        ...region,
        endTime: snappedEnd,
        keyframes: updatedKeyframes
      };
    }));
  }, [duration, framerate]);

  /**
   * Toggle enabled state for a region by index
   */
  const toggleRegionEnabled = useCallback((regionIndex, enabled) => {
    setRegions(prev => prev.map((region, idx) =>
      idx === regionIndex ? { ...region, enabled } : region
    ));
  }, []);

  /**
   * Select a region
   */
  const selectRegion = useCallback((regionId) => {
    setSelectedRegionId(regionId);
  }, []);

  /**
   * Get the region at a specific time
   * Note: Uses inclusive bounds with epsilon tolerance for floating point precision
   */
  const getRegionAtTime = useCallback((time) => {
    return regions.find(r =>
      time >= r.startTime - TIME_EPSILON && time <= r.endTime + TIME_EPSILON
    ) || null;
  }, [regions]);

  /**
   * Check if time is in an enabled region
   */
  const isTimeInEnabledRegion = useCallback((time) => {
    const region = getRegionAtTime(time);
    return region?.enabled === true;
  }, [getRegionAtTime]);

  /**
   * Check if time is exactly on a keyframe frame within an enabled region
   * Only returns true for exact frame match (no threshold)
   */
  const isTimeAtRegionKeyframe = useCallback((time) => {
    const currentFrame = timeToFrame(time, framerate);
    for (const region of regions) {
      if (!region.enabled) continue;
      for (const kf of region.keyframes || []) {
        if (kf.frame === currentFrame) {
          return true;
        }
      }
    }
    return false;
  }, [regions, framerate]);

  /**
   * Get keyframe data if time is exactly on a keyframe frame within an enabled region
   * Returns the keyframe's highlight data or null (exact frame match only)
   */
  const getKeyframeAtTimeInRegion = useCallback((time) => {
    const currentFrame = timeToFrame(time, framerate);
    for (const region of regions) {
      if (!region.enabled) continue;
      for (const kf of region.keyframes || []) {
        if (kf.frame === currentFrame) {
          const { frame, origin, ...data } = kf;
          return data;
        }
      }
    }
    return null;
  }, [regions, framerate]);

  /**
   * Add or update a keyframe at the specified time
   * Only works if time is within an enabled region
   *
   * RULES:
   * 1. If there's a keyframe at the exact current frame → update it
   * 2. If there's a keyframe within MIN_KEYFRAME_DISTANCE_FRAMES → MOVE it to current frame and update
   * 3. Otherwise → create new keyframe at current frame
   *
   * This ensures the edited keyframe is always at the exact frame the user is viewing,
   * preventing the "snapping" issue where display shows different position than what was set.
   */
  const addOrUpdateKeyframe = useCallback((time, data) => {
    const region = getRegionAtTime(time);

    if (!region || !region.enabled) {
      console.warn('[useHighlightRegions] Cannot add keyframe - not in enabled region');
      return false;
    }

    const targetFrame = timeToFrame(time, framerate);

    setRegions(prev => prev.map(r => {
      if (r.id !== region.id) return r;

      // First, check for exact frame match
      const exactMatchIndex = r.keyframes.findIndex(kf => kf.frame === targetFrame);

      if (exactMatchIndex >= 0) {
        // Update existing keyframe at exact frame
        return {
          ...r,
          keyframes: r.keyframes.map((kf, idx) =>
            idx === exactMatchIndex ? { ...kf, ...data } : kf
          )
        };
      }

      // Check for nearby keyframe within MIN_KEYFRAME_DISTANCE_FRAMES
      const nearbyIndex = r.keyframes.findIndex(kf =>
        Math.abs(kf.frame - targetFrame) <= MIN_KEYFRAME_DISTANCE_FRAMES
      );

      if (nearbyIndex >= 0) {
        // MOVE the nearby keyframe to current frame and update its data
        // This ensures the keyframe is at the exact frame the user is viewing
        console.log(`[useHighlightRegions] Moving keyframe from frame ${r.keyframes[nearbyIndex].frame} to ${targetFrame}`);
        return {
          ...r,
          keyframes: r.keyframes.map((kf, idx) =>
            idx === nearbyIndex ? { ...kf, ...data, frame: targetFrame } : kf
          ).sort((a, b) => a.frame - b.frame)
        };
      }

      // No nearby keyframe - add new one and sort
      return {
        ...r,
        keyframes: [...r.keyframes, { frame: targetFrame, ...data, origin: 'user' }]
          .sort((a, b) => a.frame - b.frame)
      };
    }));

    return true;
  }, [getRegionAtTime, framerate]);

  /**
   * Remove a keyframe at the specified time
   * Cannot remove permanent keyframes
   */
  const removeKeyframe = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    const region = getRegionAtTime(time);
    if (!region) return;

    setRegions(prev => prev.map(r => {
      if (r.id !== region.id) return r;

      // Don't remove permanent keyframes
      return {
        ...r,
        keyframes: r.keyframes.filter(kf =>
          kf.frame !== frame || kf.origin === 'permanent'
        )
      };
    }));
  }, [framerate, getRegionAtTime]);

  /**
   * Get keyframe at exact time (if exists)
   */
  const getKeyframeAtTime = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return allKeyframes.find(kf => kf.frame === frame) || null;
  }, [allKeyframes, framerate]);

  /**
   * Interpolate highlight data at a specific time
   * Returns default highlight if no keyframes exist in the region
   */
  const getHighlightAtTime = useCallback((time) => {
    const region = getRegionAtTime(time);
    if (!region || !region.enabled) return null;

    const regionKeyframes = region.keyframes || [];

    // If no keyframes in this region, use default
    if (regionKeyframes.length === 0) {
      return calculateDefaultHighlight(
        videoMetadata?.width,
        videoMetadata?.height
      );
    }

    const currentFrame = timeToFrame(time, framerate);

    // Use spline interpolation
    const result = interpolateHighlightSpline(regionKeyframes, currentFrame);
    if (result) {
      const { frame, origin, ...data } = result;
      return data;
    }

    // Fallback to first keyframe in region
    const { frame, origin, ...data } = regionKeyframes[0];
    return data;
  }, [getRegionAtTime, framerate, calculateDefaultHighlight, videoMetadata]);

  /**
   * Copy keyframe data at time
   */
  const copyKeyframe = useCallback((time) => {
    const highlight = getHighlightAtTime(time);
    if (highlight) {
      setCopiedData(highlight);
      return true;
    }
    return false;
  }, [getHighlightAtTime]);

  /**
   * Paste copied data at time
   */
  const pasteKeyframe = useCallback((time) => {
    if (!copiedData) return false;
    return addOrUpdateKeyframe(time, copiedData);
  }, [copiedData, addOrUpdateKeyframe]);

  /**
   * Get regions for export
   */
  const getRegionsForExport = useCallback(() => {
    return regions
      .filter(r => r.enabled)
      .map(region => {
        // Use keyframes from the region itself
        const regionKeyframes = (region.keyframes || []).map(kf => ({
          time: frameToTime(kf.frame, framerate),
          x: kf.x,
          y: kf.y,
          radiusX: kf.radiusX,
          radiusY: kf.radiusY,
          opacity: kf.opacity,
          color: kf.color
        }));

        // If no keyframes, add default at start
        if (regionKeyframes.length === 0) {
          const defaultHighlight = calculateDefaultHighlight(
            videoMetadata?.width,
            videoMetadata?.height
          );
          regionKeyframes.push({
            time: region.startTime,
            ...defaultHighlight
          });
        }

        return {
          id: region.id,
          start_time: region.startTime,
          end_time: region.endTime,
          keyframes: regionKeyframes
        };
      });
  }, [regions, framerate, calculateDefaultHighlight, videoMetadata]);

  /**
   * Get keyframes in a region for display
   */
  const getKeyframesInRegion = useCallback((regionIndex) => {
    const region = regions[regionIndex];
    if (!region) return [];
    return region.keyframes || [];
  }, [regions]);

  /**
   * Initialize highlight regions from clip metadata (auto-generated from Framing export)
   * Creates a 5-second region at the start of each clip
   *
   * @param {Object} metadata - Clip metadata with source_clips array
   * @param {number} videoWidth - Video width for default highlight calculation
   * @param {number} videoHeight - Video height for default highlight calculation
   * @returns {number} Number of regions created
   */
  const initializeFromClipMetadata = useCallback((metadata, videoWidth, videoHeight) => {
    if (!metadata || !metadata.source_clips || metadata.source_clips.length === 0) {
      return 0;
    }

    const newRegions = [];

    metadata.source_clips.forEach((clip, index) => {
      const regionStart = clip.start_time;
      const regionEnd = Math.min(clip.start_time + DEFAULT_REGION_DURATION, clip.end_time);

      // Only create if region would be at least MIN_REGION_DURATION seconds
      if (regionEnd - regionStart < MIN_REGION_DURATION) return;

      const regionId = `region-auto-${index}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Create default highlight keyframes for start and end
      const defaultHighlight = calculateDefaultHighlight(videoWidth, videoHeight);

      const startFrame = timeToFrame(regionStart, framerate);
      const endFrame = timeToFrame(regionEnd, framerate);

      // Snap times to exact frame boundaries
      const snappedStartTime = frameToTime(startFrame, framerate);
      const snappedEndTime = frameToTime(endFrame, framerate);

      newRegions.push({
        id: regionId,
        startTime: snappedStartTime,
        endTime: snappedEndTime,
        enabled: true,
        label: clip.name,  // Store clip name for display
        autoGenerated: true,  // Flag to identify auto-created regions
        keyframes: [
          {
            frame: startFrame,
            ...defaultHighlight,
            origin: 'permanent'
          },
          {
            frame: endFrame,
            ...defaultHighlight,
            origin: 'permanent'
          }
        ]
      });
    });

    // Set all regions at once
    setRegions(newRegions);

    console.log(`[useHighlightRegions] Initialized ${newRegions.length} regions from clip metadata`);
    return newRegions.length;
  }, [calculateDefaultHighlight, framerate]);

  return {
    // State
    boundaries,
    regions: regionsWithLayout,  // Use layout-enhanced regions for UI
    keyframes: allKeyframes,     // Flattened keyframes for compatibility
    selectedRegionId,
    copiedData,
    duration,
    framerate,

    // Initialization
    initializeWithDuration,
    initializeFromClipMetadata,  // Auto-create regions from clip boundaries

    // Region operations (new API)
    addRegion,                   // Creates 5-second region with keyframes
    deleteRegion,
    deleteRegionByIndex,
    moveRegionStart,             // For lever dragging
    moveRegionEnd,               // For lever dragging
    toggleRegionEnabled,
    selectRegion,

    // Keyframe operations
    addOrUpdateKeyframe,
    removeKeyframe,
    copyKeyframe,
    pasteKeyframe,

    // Queries
    getRegionAtTime,
    isTimeInEnabledRegion,
    isTimeAtRegionKeyframe,      // Check if at keyframe (larger threshold)
    getKeyframeAtTimeInRegion,   // Get keyframe data if at keyframe
    getHighlightAtTime,
    getKeyframeAtTime,
    getKeyframesInRegion,
    calculateDefaultHighlight,

    // Export
    getRegionsForExport,

    // Reset
    reset
  };
}
