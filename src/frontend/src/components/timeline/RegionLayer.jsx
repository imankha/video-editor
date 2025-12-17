import { Trash2 } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { PLAYHEAD_WIDTH_PX } from './TimelineBase';
import { KeyframeMarker } from './KeyframeMarker';
import { frameToTime } from '../../utils/videoUtils';

/**
 * RegionLayer - Reusable component for displaying regions on the timeline
 *
 * Supports two modes:
 * - 'segment': Shows speed controls and trim buttons (for framing mode)
 * - 'highlight': Shows enable/disable toggle + keyframes + delete button (for overlay mode)
 *
 * @param {string} mode - 'segment' | 'highlight'
 * @param {Array} regions - Array of region objects with visual layout info
 * @param {Array} boundaries - Array of boundary times
 * @param {Array} keyframes - Array of keyframes (only for highlight mode)
 * @param {number} framerate - Framerate for keyframe conversion
 * @param {number} duration - Total video duration
 * @param {number} visualDuration - Visual duration (accounting for speed changes)
 * @param {number} currentTime - Current playhead time
 * @param {Function} onAddBoundary - Callback when clicking to add a boundary (segment mode)
 * @param {Function} onAddRegion - Callback when clicking to add a region (highlight mode)
 * @param {Function} onRemoveBoundary - Callback to remove a boundary (segment mode)
 * @param {Function} onMoveRegionStart - Callback to move region start (highlight mode lever drag)
 * @param {Function} onMoveRegionEnd - Callback to move region end (highlight mode lever drag)
 * @param {Function} onRemoveKeyframe - Callback to remove a keyframe (highlight mode)
 * @param {Function} onRegionAction - Callback for region-specific action (speed change, trim, toggle enable, delete)
 * @param {Function} onSelectedKeyframeChange - Callback when selected keyframe changes (highlight mode)
 * @param {Object} colorScheme - Color configuration { bg, hover, accent, line }
 * @param {string} emptyMessage - Message to show when no regions exist
 * @param {number} edgePadding - Edge padding for timeline
 */
export default function RegionLayer({
  mode = 'segment',
  regions = [],
  boundaries = [],
  keyframes = [],
  framerate = 30,
  duration,
  visualDuration,
  currentTime,
  onAddBoundary,
  onAddRegion,
  onRemoveBoundary,
  onMoveRegionStart,
  onMoveRegionEnd,
  onRemoveKeyframe,
  onRegionAction,
  onSelectedKeyframeChange,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  colorScheme = {
    bg: 'bg-purple-900',
    hover: 'bg-purple-500',
    accent: 'bg-purple-600',
    line: 'bg-purple-400',
    lineHover: 'bg-purple-300'
  },
  emptyMessage = 'Click to add a region',
  edgePadding = 20
}) {
  const [hoveredRegionIndex, setHoveredRegionIndex] = useState(null);
  const [draggingLever, setDraggingLever] = useState(null); // { regionId, type: 'start' | 'end' }
  const trackRef = useRef(null);

  // Convert pixel X position to time
  const pixelToTimeValue = useCallback((clientX) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const usableWidth = rect.width - (edgePadding * 2);
    const x = clientX - rect.left - edgePadding;
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percentX = (clampedX / usableWidth) * 100;
    const visualTime = (percentX / 100) * (visualDuration || duration);
    return visualTimeToSourceTime(visualTime);
  }, [edgePadding, visualDuration, duration, visualTimeToSourceTime]);

  // Handle lever drag
  useEffect(() => {
    if (!draggingLever) return;

    const handleMouseMove = (e) => {
      const newTime = pixelToTimeValue(e.clientX);
      const region = regions.find(r => r.id === draggingLever.regionId);
      if (!region) return;

      if (draggingLever.type === 'start' && onMoveRegionStart) {
        onMoveRegionStart(draggingLever.regionId, newTime);
      } else if (draggingLever.type === 'end' && onMoveRegionEnd) {
        onMoveRegionEnd(draggingLever.regionId, newTime);
      }
    };

    const handleMouseUp = () => {
      setDraggingLever(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingLever, regions, onMoveRegionStart, onMoveRegionEnd, pixelToTimeValue]);

  if (!duration) return null;

  const effectiveDuration = visualDuration || duration;

  /**
   * Convert source time to visual pixel position percentage
   */
  const sourceTimeToPixel = (sourceTime) => {
    if (!effectiveDuration) return 0;
    const visualTime = sourceTimeToVisualTime(sourceTime);
    return (visualTime / effectiveDuration) * 100;
  };

  /**
   * Convert frame to pixel position percentage
   */
  const frameToPixel = (frame) => {
    const sourceTime = frameToTime(frame, framerate);
    return sourceTimeToPixel(sourceTime);
  };

  /**
   * Convert pixel position to source time
   */
  const pixelToTime = (pixelPercent) => {
    const visualTime = (pixelPercent / 100) * effectiveDuration;
    return visualTimeToSourceTime(visualTime);
  };

  /**
   * Handle click to add boundary (segment mode) or region (highlight mode)
   */
  const handleTrackClick = (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    // Don't add when clicking on keyframe diamond
    if (e.target.classList.contains('rotate-45')) return;
    // Don't add when clicking on lever handle
    if (e.target.closest('.lever-handle')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const usableWidth = rect.width - (edgePadding * 2);
    const x = e.clientX - rect.left - edgePadding;
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percentX = (clampedX / usableWidth) * 100;
    const clickTime = pixelToTime(percentX);

    // Snap to playhead if near
    const pixelThreshold = 15;
    const timeThreshold = effectiveDuration > 0
      ? (pixelThreshold / usableWidth) * effectiveDuration
      : 0.1;

    const clickVisualTime = (percentX / 100) * effectiveDuration;
    const playheadVisualTime = sourceTimeToVisualTime(currentTime);
    const shouldSnap = Math.abs(clickVisualTime - playheadVisualTime) < timeThreshold;
    const time = shouldSnap ? currentTime : clickTime;

    // Use different callbacks based on mode
    if (mode === 'highlight' && onAddRegion) {
      onAddRegion(time);
    } else if (onAddBoundary) {
      onAddBoundary(time);
    }
  };

  /**
   * Render controls for a segment region
   */
  const renderSegmentControls = (region) => {
    const canTrim = (region.isFirst || region.isLast) &&
                    regions.filter(r => !r.isTrimmed).length >= 2;

    return (
      <>
        {/* Trash button for first/last segments */}
        {canTrim && (
          <button
            className="p-1.5 rounded transition-colors bg-red-600 hover:bg-red-700 text-white"
            onClick={(e) => {
              e.stopPropagation();
              onRegionAction?.(region.index, 'trim');
            }}
            title="Trim segment"
          >
            <Trash2 size={12} />
          </button>
        )}

        {/* Speed buttons */}
        {region.speed !== 0.5 && (
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onRegionAction?.(region.index, 'speed', 0.5);
            }}
            title="Set speed to 0.5x"
          >
            0.5x
          </button>
        )}
        {region.speed !== 1 && (
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onRegionAction?.(region.index, 'speed', 1);
            }}
            title="Set speed to 1x (normal)"
          >
            1x
          </button>
        )}
      </>
    );
  };

  /**
   * Render controls for a highlight region
   */
  const renderHighlightControls = (region) => {
    return (
      <button
        className="p-1 rounded transition-colors bg-red-600 hover:bg-red-700 text-white"
        onClick={(e) => {
          e.stopPropagation();
          onRegionAction?.(region.index, 'delete');
        }}
        title="Delete region"
      >
        <Trash2 size={12} />
      </button>
    );
  };

  /**
   * Render region indicator badge (segment mode only - shows speed)
   */
  const renderRegionBadge = (region) => {
    if (mode === 'segment' && region.speed !== 1) {
      return (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className={`${colorScheme.accent} text-white text-xs px-2 py-0.5 rounded font-semibold`}>
            {region.speed}x
          </div>
        </div>
      );
    }
    return null;
  };

  /**
   * Determine which keyframe is "selected" based on exact frame match
   * Returns the keyframe time only if playhead is at the exact frame
   */
  const getSelectedKeyframeTime = () => {
    if (mode !== 'highlight' || keyframes.length === 0) return null;

    // Convert currentTime to frame for exact match
    const currentFrame = Math.round(currentTime * framerate);

    for (const keyframe of keyframes) {
      if (keyframe.frame === currentFrame) {
        return frameToTime(keyframe.frame, framerate);
      }
    }
    return null;
  };

  const selectedKeyframeTime = getSelectedKeyframeTime();

  // Notify parent when selected keyframe changes
  useEffect(() => {
    if (mode === 'highlight' && onSelectedKeyframeChange) {
      onSelectedKeyframeChange(selectedKeyframeTime);
    }
  }, [mode, selectedKeyframeTime, onSelectedKeyframeChange]);

  /**
   * Render keyframes for highlight mode
   * Uses CSS calc() for positioning to match playhead exactly
   */
  const renderKeyframes = () => {
    if (mode !== 'highlight' || keyframes.length === 0) return null;

    // Get current frame for exact matching
    const currentFrame = Math.round(currentTime * framerate);

    return keyframes.map((keyframe) => {
      // Is this keyframe selected (playhead is at exact frame)?
      const isSelected = keyframe.frame === currentFrame;

      // When selected, use currentTime for position so keyframe aligns with playhead
      // Otherwise use the keyframe's frame time
      const displayTime = isSelected ? currentTime : frameToTime(keyframe.frame, framerate);
      const positionPercent = sourceTimeToPixel(displayTime);
      const keyframeTime = frameToTime(keyframe.frame, framerate);

      // Can delete if: user-created (not permanent) AND we have a delete callback
      const canDelete = keyframe.origin !== 'permanent' && onRemoveKeyframe;
      const isPermanent = keyframe.origin === 'permanent';

      // Click on keyframe: delete it if possible (only for non-permanent keyframes)
      const handleClick = canDelete ? () => onRemoveKeyframe(keyframeTime) : undefined;

      // Use CSS calc() matching playhead positioning formula exactly
      const leftCalc = `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${positionPercent / 100})`;

      return (
        <div
          key={`kf-${keyframe.frame}`}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-50"
          style={{ left: leftCalc }}
        >
          {/* Diamond keyframe indicator */}
          <div
            className={`w-3 h-3 transform rotate-45 transition-all cursor-pointer ${
              isSelected
                ? 'bg-orange-300 scale-150 ring-2 ring-orange-200'
                : 'bg-orange-500 hover:bg-orange-400'
            }`}
            onClick={handleClick}
            title={isPermanent
              ? `Auto keyframe at ${keyframeTime.toFixed(2)}s`
              : `Keyframe at ${keyframeTime.toFixed(2)}s (click to delete)`
            }
          />
        </div>
      );
    });
  };

  return (
    <div className="relative bg-gray-800/95 border-t border-gray-700/50 overflow-visible rounded-r-lg h-20 pb-2">
      {/* Track */}
      <div
        ref={trackRef}
        className="region-track absolute inset-x-0 top-0 h-12 cursor-pointer overflow-visible rounded-r-lg"
        onClick={handleTrackClick}
      >
        {/* Background track */}
        <div className={`absolute inset-0 ${colorScheme.bg} bg-opacity-10 region-bg rounded-r-lg`} />

        {/* Empty state message */}
        {((mode === 'highlight' && regions.length === 0) ||
          (mode === 'segment' && regions.length <= 1 && keyframes.length === 0)) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">{emptyMessage}</span>
          </div>
        )}

        {/* Render regions */}
        {regions.map((region) => {
          const isHovered = hoveredRegionIndex === region.index;
          const isDraggingThisRegion = draggingLever?.regionId === region.id;

          return (
            <div
              key={region.id || region.index}
              className="absolute top-0 h-12 overflow-visible"
              style={{
                left: `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${region.visualStartPercent / 100})`,
                width: `calc((100% - ${edgePadding * 2}px) * ${region.visualWidthPercent / 100})`
              }}
              onMouseEnter={() => setHoveredRegionIndex(region.index)}
              onMouseLeave={() => !draggingLever && setHoveredRegionIndex(null)}
            >
              {/* Region background with border for highlight mode */}
              <div
                className={`h-full transition-all relative overflow-hidden ${
                  mode === 'highlight'
                    ? `${colorScheme.hover} bg-opacity-20 border-l-2 border-r-2 border-orange-400`
                    : isHovered
                      ? `${colorScheme.hover} bg-opacity-30`
                      : ''
                }`}
                title={mode === 'segment'
                  ? `Segment ${region.index + 1}: ${region.speed}x`
                  : `Highlight Region ${region.index + 1}`
                }
              >
                {renderRegionBadge(region)}
              </div>

              {/* Lever handles for highlight mode - positioned outside region, using transform to extend */}
              {mode === 'highlight' && (
                <>
                  {/* Start lever (left) */}
                  <div
                    className="absolute top-0 h-full flex items-end pointer-events-auto"
                    style={{ left: '-16px', width: '32px', zIndex: 100 }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setDraggingLever({ regionId: region.id, type: 'start' });
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className={`w-4 h-4 rounded-full border-2 border-orange-400 cursor-ew-resize transition-all ${
                        isDraggingThisRegion && draggingLever?.type === 'start'
                          ? 'bg-orange-400 scale-125'
                          : 'bg-gray-900 hover:bg-orange-400'
                      }`}
                    />
                  </div>

                  {/* End lever (right) */}
                  <div
                    className="absolute top-0 h-full flex items-end justify-end pointer-events-auto"
                    style={{ right: '-16px', width: '32px', zIndex: 100 }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setDraggingLever({ regionId: region.id, type: 'end' });
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className={`w-4 h-4 rounded-full border-2 border-orange-400 cursor-ew-resize transition-all ${
                        isDraggingThisRegion && draggingLever?.type === 'end'
                          ? 'bg-orange-400 scale-125'
                          : 'bg-gray-900 hover:bg-orange-400'
                      }`}
                    />
                  </div>
                </>
              )}

              {/* Region controls */}
              <div
                className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 flex gap-1 z-10"
              >
                {mode === 'segment'
                  ? renderSegmentControls(region)
                  : renderHighlightControls(region)
                }
              </div>
            </div>
          );
        })}

        {/* Render keyframes (highlight mode only) */}
        {renderKeyframes()}

        {/* Render boundaries (vertical lines) - only for segment mode */}
        {mode === 'segment' && boundaries.map((time, index) => {
          const position = sourceTimeToPixel(time);
          const isStart = Math.abs(time) < 0.01;
          const isEnd = Math.abs(time - duration) < 0.01;

          // Don't show start and end boundaries
          if (isStart || isEnd) return null;

          const containerWidth = trackRef.current?.getBoundingClientRect().width || 0;
          const usableWidth = containerWidth - (edgePadding * 2);
          const playheadCenterOffset = PLAYHEAD_WIDTH_PX / 2;
          const leftPx = edgePadding + (usableWidth * position / 100) + playheadCenterOffset;

          return (
            <div
              key={index}
              className="absolute top-0 h-full cursor-pointer group z-20"
              style={{
                left: `${leftPx}px`,
                width: '16px',
                marginLeft: '-8px'
              }}
              title={`Boundary at ${time.toFixed(2)}s`}
            >
              {/* Vertical line */}
              <div className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 ${colorScheme.line} group-hover:${colorScheme.lineHover} pointer-events-none`} />

              {/* Delete button */}
              {onRemoveBoundary && (
                <button
                  className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveBoundary(time);
                  }}
                  title="Delete boundary"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
