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
  timelineScale = 1,
  trimRange = null,
  edgePadding = 0
}) {
  // Get isEndKeyframeExplicit and copiedCrop from context
  const { isEndKeyframeExplicit, copiedCrop } = useCropContext();

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
   * Handle click on keyframes track to paste crop at current playhead position
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

    // Paste at current playhead position (not click position)
    console.log('[CropLayer] Paste crop at current time:', currentTime);
    onKeyframePaste(currentTime);
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

          // Calculate effective start/end based on trimRange
          // After trimming, keyframes are reconstituted at trim boundaries
          const effectiveStartTime = trimRange?.start ?? 0;
          const effectiveEndTime = trimRange?.end ?? duration;
          const effectiveStartFrame = Math.round(effectiveStartTime * framerate);
          const effectiveEndFrame = Math.round(effectiveEndTime * framerate);

          // Check if this is a boundary keyframe (at effective start or end)
          // Use tolerance of 1 frame to handle floating point precision issues
          const FRAME_TOLERANCE = 1;
          const isStartKeyframe = Math.abs(keyframe.frame - effectiveStartFrame) <= FRAME_TOLERANCE;
          const isEndKeyframe = Math.abs(keyframe.frame - effectiveEndFrame) <= FRAME_TOLERANCE;
          // Also consider the last keyframe in the array as the end keyframe (fallback for edge cases)
          const isLastKeyframe = index === keyframes.length - 1 && keyframe.origin === 'permanent';
          const isEffectiveEndKeyframe = isEndKeyframe || isLastKeyframe;

          const isAtStartTime = Math.abs(currentTime - effectiveStartTime) < 0.01;
          const isSelected = selectedKeyframeIndex === index;
          const isPermanent = keyframe.origin === 'permanent';

          // Highlight keyframe if:
          // 1. At current time, OR
          // 2. This is end keyframe, end hasn't been explicitly set, and we're at start time
          const shouldHighlight = isAtCurrentTime ||
                                  (isEffectiveEndKeyframe && !isEndKeyframeExplicit && isAtStartTime);

          return (
            <div
              key={index}
              className="absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50"
              style={{
                left: edgePadding > 0
                  ? `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${position / 100})`
                  : `${position}%`
              }}
            >
              {/* Invisible hit area that keeps buttons visible when moving mouse between elements */}
              <div className="absolute -top-5 -bottom-4 -left-4 -right-4" />

              {/* Copy button (shown when selected, above keyframe) - z-50 to appear above all UI including playhead */}
              {onKeyframeCopy && (
                <button
                  className={`absolute -top-5 left-1/2 transform transition-opacity bg-blue-600 hover:bg-blue-700 text-white rounded-full p-1.5 z-50 ${
                    isPermanent && isStartKeyframe
                      ? '-translate-x-[20%]'
                      : isPermanent && isEffectiveEndKeyframe
                      ? '-translate-x-[80%]'
                      : '-translate-x-1/2'
                  } ${isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'
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
                  isEffectiveEndKeyframe && !isEndKeyframeExplicit ? ' (mirrors start)' : ''
                }${isSelected ? ' [SELECTED]' : ''}`}
              />

              {/* Delete button (shown when selected, but not for permanent keyframes) - z-50 to appear above all UI including playhead */}
              {keyframes.length > 2 &&
               !isPermanent && (
                <button
                  className={`absolute top-4 left-1/2 transform -translate-x-1/2 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5 z-50 ${
                    isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'
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
