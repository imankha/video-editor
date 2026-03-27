import React from 'react';
import { useCropContext } from '../contexts/CropContext';
import { frameToTime } from '../../../utils/videoUtils';
import { KeyframeMarker } from '../../../components/timeline/KeyframeMarker';

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
  // Get isEndKeyframeExplicit from context
  const { isEndKeyframeExplicit } = useCropContext();

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
   * Handle click on keyframes track — select layer and select boundary keyframe
   * if the click is before the first or after the last keyframe.
   */
  const handleTrackClick = (e) => {
    if (onLayerSelect) {
      onLayerSelect();
    }

    // Select boundary keyframe if clicking in the edge zones
    if (keyframes.length >= 2 && trackRef.current && onKeyframeClick) {
      const rect = trackRef.current.getBoundingClientRect();
      const usableWidth = rect.width - (edgePadding * 2);
      const x = e.clientX - rect.left - edgePadding;
      const clickPercent = (x / usableWidth) * 100;

      const firstPosition = frameToPixel(keyframes[0].frame);
      const lastPosition = frameToPixel(keyframes[keyframes.length - 1].frame);

      if (clickPercent <= firstPosition) {
        const time = frameToTime(keyframes[0].frame, framerate);
        onKeyframeClick(time, 0);
      } else if (clickPercent >= lastPosition) {
        const lastIndex = keyframes.length - 1;
        const time = frameToTime(keyframes[lastIndex].frame, framerate);
        onKeyframeClick(time, lastIndex);
      }
    }
  };

  return (
    <div className={`relative bg-gray-800/95 border-t border-gray-700/50 h-12 rounded-r-lg transition-all ${
      isLayerSelected ? 'ring-2 ring-yellow-400 ring-opacity-75' : ''
    }`}>
      {/* Keyframes track */}
      <div
        ref={trackRef}
        className="absolute inset-0 rounded-r-lg"
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
          // Boundary keyframes (at effective start/end) are never deletable
          // Note: user keyframes at trim boundaries are valid — not a bug
          const isBoundaryKeyframe = isStartKeyframe || isEffectiveEndKeyframe;

          // Highlight keyframe if no other keyframe is selected AND:
          // 1. At current time, OR
          // 2. This is end keyframe, end hasn't been explicitly set, and we're at start time
          const shouldHighlight = selectedKeyframeIndex === null && (
            isAtCurrentTime ||
            (isEffectiveEndKeyframe && !isEndKeyframeExplicit && isAtStartTime)
          );

          return (
            <KeyframeMarker
              key={keyframe.frame}
              position={position}
              colorScheme="blue"
              isSelected={isSelected}
              shouldHighlight={shouldHighlight}
              isPermanent={isPermanent}
              isStartKeyframe={isStartKeyframe}
              isEndKeyframe={isEffectiveEndKeyframe}
              onClick={() => onKeyframeClick(keyframeTime, index)}
              onDelete={keyframes.length > 2 && !isBoundaryKeyframe ? () => onKeyframeDelete(keyframeTime, duration) : undefined}
              tooltip={`Keyframe at frame ${keyframe.frame} (${keyframeTime.toFixed(3)}s)${
                isEffectiveEndKeyframe && !isEndKeyframeExplicit ? ' (mirrors start)' : ''
              }${isSelected ? ' [SELECTED]' : ''}`}
              edgePadding={edgePadding}
              showCopyButton={false}
              showDeleteButton={keyframes.length > 2 && !isBoundaryKeyframe}
            />
          );
        })}
      </div>
    </div>
  );
}
