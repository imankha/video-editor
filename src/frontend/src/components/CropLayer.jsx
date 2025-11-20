import { Crop, Trash2, Copy } from 'lucide-react';
import React from 'react';
import { useCropContext } from '../contexts/CropContext';
import { frameToTime } from '../utils/videoUtils';

/**
 * CropLayer component - displays crop keyframes on the timeline
 * Shows diamond indicators for each keyframe
 *
 * ARCHITECTURE: Keyframes are stored with frame numbers, not time.
 * We convert frame -> source time -> visual time for display.
 */
export default function CropLayer({
  keyframes,
  duration,
  visualDuration,
  currentTime,
  onKeyframeClick,
  onKeyframeDelete,
  onKeyframeCopy,
  onKeyframePaste,
  isActive,
  selectedKeyframeIndex = null,
  isLayerSelected = false,
  onLayerSelect,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  framerate = 30,
  timelineScale = 1
}) {
  // Get isEndKeyframeExplicit and copiedCrop from context
  const { isEndKeyframeExplicit, copiedCrop } = useCropContext();

  // Track which keyframe index should show buttons (closest to mouse)
  const [hoveredKeyframeIndex, setHoveredKeyframeIndex] = React.useState(null);
  const trackRef = React.useRef(null);

  // Use visual duration if provided, otherwise fall back to source duration
  const timelineDuration = visualDuration || duration;

  /**
   * Convert frame number to visual pixel position on timeline
   * Frame -> Source Time -> Visual Time -> Percentage
   */
  const frameToPixel = (frame) => {
    if (!timelineDuration) return 0;
    // Convert frame to source time
    const sourceTime = frameToTime(frame, framerate);
    // Convert source time to visual time, then to percentage
    const visualTime = sourceTimeToVisualTime(sourceTime);
    return (visualTime / timelineDuration) * 100;
  };

  /**
   * Handle mouse move to determine which keyframe is closest to cursor
   * This prevents overlapping hit areas from showing wrong keyframe's buttons
   */
  const handleTrackMouseMove = (e) => {
    if (!trackRef.current || keyframes.length === 0) return;

    const rect = trackRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mousePercent = (mouseX / rect.width) * 100;

    // Find the keyframe closest to the mouse position
    let closestIndex = null;
    let minDistance = Infinity;

    keyframes.forEach((keyframe, index) => {
      const keyframePercent = frameToPixel(keyframe.frame);
      const distance = Math.abs(mousePercent - keyframePercent);

      // Only consider keyframes within a reasonable hit area (about 2% of timeline width)
      // This corresponds roughly to the -left-4 -right-4 area
      if (distance < 3 && distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    setHoveredKeyframeIndex(closestIndex);
  };

  /**
   * Handle mouse leave to clear hovered keyframe
   */
  const handleTrackMouseLeave = () => {
    setHoveredKeyframeIndex(null);
  };

  /**
   * Handle click on keyframes track to paste crop at clicked time
   */
  const handleTrackClick = (e) => {
    // Select this layer when clicking on it
    if (onLayerSelect) {
      onLayerSelect();
    }

    // Only paste if we have copied crop and paste handler
    if (!copiedCrop || !onKeyframePaste) return;

    // Don't paste if clicking on a button or keyframe diamond
    if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.classList.contains('rotate-45')) {
      return;
    }

    // Calculate time from click position
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentX = (clickX / rect.width) * 100;

    // Convert percentage to visual time
    const visualTime = (percentX / 100) * timelineDuration;
    // Convert visual time to source time
    const sourceTime = visualTimeToSourceTime(visualTime);

    // Clamp to valid range
    const time = Math.max(0, Math.min(sourceTime, duration));

    console.log('[CropLayer] Paste crop at time:', time);
    onKeyframePaste(time);
  };

  return (
    <div className={`relative bg-gray-800/95 border-t border-gray-700/50 h-12 rounded-r-lg transition-all ${
      isLayerSelected ? 'ring-2 ring-yellow-400 ring-opacity-75' : ''
    }`}>
      {/* Keyframes track */}
      <div
        ref={trackRef}
        className={`absolute inset-0 rounded-r-lg ${copiedCrop ? 'cursor-copy' : ''}`}
        onClick={handleTrackClick}
        onMouseMove={handleTrackMouseMove}
        onMouseLeave={handleTrackMouseLeave}
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-blue-900 bg-opacity-10 rounded-r-lg" />

        {/* Placeholder text when no explicit keyframes (only auto-created start/end) */}
        {keyframes.length === 2 && !isEndKeyframeExplicit && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">Set Crop Keyframes to animate crop window</span>
          </div>
        )}

        {/* Keyframe indicators */}
        {keyframes.map((keyframe, index) => {
          // Convert keyframe frame number to visual position
          const position = frameToPixel(keyframe.frame);
          const keyframeTime = frameToTime(keyframe.frame, framerate);
          const isAtCurrentTime = Math.abs(keyframeTime - currentTime) < 0.01;
          const isStartKeyframe = keyframe.frame === 0;
          const totalFrames = Math.round(duration * framerate);
          const isEndKeyframe = keyframe.frame === totalFrames;
          const isAtStartTime = Math.abs(currentTime) < 0.01;
          const isSelected = selectedKeyframeIndex === index;
          const isPermanent = keyframe.origin === 'permanent';

          // Highlight keyframe if:
          // 1. At current time, OR
          // 2. This is end keyframe, end hasn't been explicitly set, and we're at start time
          const shouldHighlight = isAtCurrentTime ||
                                  (isEndKeyframe && !isEndKeyframeExplicit && isAtStartTime);

          // Check if this keyframe should show its buttons (closest to mouse)
          const isHovered = hoveredKeyframeIndex === index;

          return (
            <div
              key={index}
              className="absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50"
              style={{ left: `${position}%` }}
            >
              {/* Invisible hit area that keeps buttons visible when moving mouse between elements */}
              <div className="absolute -top-5 -bottom-4 -left-4 -right-4" />

              {/* Copy button (shown on hover or when selected, above keyframe) - z-50 to appear above all UI including playhead */}
              {onKeyframeCopy && (
                <button
                  className={`absolute -top-5 left-1/2 transform transition-opacity bg-blue-600 hover:bg-blue-700 text-white rounded-full p-1.5 z-50 ${
                    isPermanent && index === 0
                      ? '-translate-x-[20%]'
                      : isPermanent && index === keyframes.length - 1
                      ? '-translate-x-[80%]'
                      : '-translate-x-1/2'
                  } ${(isHovered || isSelected) ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onKeyframeCopy(keyframeTime);
                  }}
                  title="Copy keyframe"
                >
                  <Copy size={13} />
                </button>
              )}

              {/* Diamond keyframe indicator */}
              <div
                className={`w-3 h-3 transform rotate-45 cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-yellow-300 scale-150 ring-2 ring-yellow-200'
                    : shouldHighlight
                    ? 'bg-yellow-400 scale-125'
                    : 'bg-blue-400 hover:bg-blue-300'
                }`}
                onClick={() => onKeyframeClick(keyframeTime, index)}
                title={`Keyframe at frame ${keyframe.frame} (${keyframeTime.toFixed(3)}s)${
                  isEndKeyframe && !isEndKeyframeExplicit ? ' (mirrors start)' : ''
                }${isSelected ? ' [SELECTED]' : ''}`}
              />

              {/* Delete button (shown on hover or when selected, but not for permanent keyframes) - z-50 to appear above all UI including playhead */}
              {keyframes.length > 2 &&
               !isPermanent && (
                <button
                  className={`absolute top-4 left-1/2 transform -translate-x-1/2 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5 z-50 ${
                    (isHovered || isSelected) ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onKeyframeDelete(keyframeTime, duration);
                  }}
                  title="Delete keyframe"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
