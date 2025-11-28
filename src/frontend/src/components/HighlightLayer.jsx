import { Circle, Eye, EyeOff } from 'lucide-react';
import React from 'react';
import { useHighlightContext } from '../contexts/HighlightContext';
import { frameToTime } from '../utils/videoUtils';
import { KeyframeMarker } from './timeline/KeyframeMarker';

/**
 * HighlightLayer component - displays highlight keyframes on the timeline
 * Shows diamond indicators for each keyframe with a circle icon for the layer
 *
 * ARCHITECTURE: Keyframes are stored with frame numbers, not time.
 * We convert frame -> source time -> visual time for display.
 */
export default function HighlightLayer({
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
  onToggleEnabled,
  onDurationChange,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  framerate = 30,
  timelineScale = 1,
  trimRange = null,
  edgePadding = 0
}) {
  const { isEndKeyframeExplicit, copiedHighlight, isEnabled, highlightDuration } = useHighlightContext();

  const [isDragging, setIsDragging] = React.useState(false);
  const trackRef = React.useRef(null);
  const sliderTrackRef = React.useRef(null);

  const timelineDuration = visualDuration || duration;

  /**
   * Convert frame number to visual pixel position on timeline
   */
  const frameToPixel = (frame) => {
    if (!timelineDuration) return 0;
    const sourceTime = frameToTime(frame, framerate);
    const visualTime = sourceTimeToVisualTime(sourceTime);
    return (visualTime / timelineDuration) * 100;
  };

  /**
   * Handle click on keyframes track to paste highlight at current playhead position
   */
  const handleTrackClick = (e) => {
    // Select this layer when clicking on it
    if (onLayerSelect) {
      onLayerSelect();
    }

    if (!isEnabled) return;
    if (!copiedHighlight || !onKeyframePaste) return;

    if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.classList.contains('rotate-45')) {
      return;
    }

    // Paste at current playhead position (not click position)
    onKeyframePaste(currentTime);
  };

  /**
   * Handle duration slider mouse down
   */
  const handleSliderMouseDown = (e) => {
    if (!sliderTrackRef.current || !onDurationChange) return;

    setIsDragging(true);
    updateDurationFromMouse(e.clientX);
  };

  /**
   * Update duration based on mouse X position
   */
  const updateDurationFromMouse = (clientX) => {
    if (!sliderTrackRef.current || !onDurationChange) return;

    const rect = sliderTrackRef.current.getBoundingClientRect();

    // Account for edge padding - usable area starts at edgePadding and ends at width - edgePadding
    const usableWidth = rect.width - (edgePadding * 2);
    const mouseX = clientX - rect.left - edgePadding;

    // Clamp to usable area
    const clampedX = Math.max(0, Math.min(mouseX, usableWidth));
    const percentage = (clampedX / usableWidth) * 100;

    // Convert percentage to visual time
    const visualTime = (percentage / 100) * timelineDuration;

    // Convert visual time to source time
    const sourceTime = visualTimeToSourceTime(visualTime);

    // Clamp to valid range and update
    const newDuration = Math.max(0.5, Math.min(sourceTime, duration));
    onDurationChange(newDuration);
  };

  /**
   * Handle window mouse move during drag
   */
  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      updateDurationFromMouse(e.clientX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, timelineDuration, duration, onDurationChange, sourceTimeToVisualTime, visualTimeToSourceTime]);

  // Calculate the highlight end position on timeline
  const highlightEndPosition = frameToPixel(Math.round(highlightDuration * framerate));

  // Debug logging for keyframe rendering (disabled - too frequent)

  return (
    <div className={`relative bg-gray-800/95 border-t border-gray-700/50 rounded-r-lg transition-all ${
      isLayerSelected ? 'ring-2 ring-orange-400 ring-opacity-75' : ''
    } ${isEnabled ? 'h-20' : 'h-12'}`}>
      {/* Main row with toggle and keyframes */}
      <div className="relative h-12">
        {/* Keyframes track */}
        <div
          ref={trackRef}
          className={`absolute inset-0 rounded-r-lg ${
            isEnabled && copiedHighlight ? 'cursor-copy' : ''
          } ${!isEnabled ? 'opacity-50' : ''}`}
          onClick={handleTrackClick}
        >
          {/* Background track */}
          <div className="absolute inset-0 bg-orange-900 bg-opacity-10 rounded-r-lg" />

          {/* Active highlight region indicator */}
          {isEnabled && (
            <div
              className="absolute top-0 bottom-0 bg-orange-500/20 border-r-2 border-orange-400"
              style={{
                left: `${edgePadding}px`,
                width: edgePadding > 0
                  ? `calc((100% - ${edgePadding * 2}px) * ${highlightEndPosition / 100})`
                  : `${highlightEndPosition}%`
              }}
            />
          )}

          {/* Placeholder text */}
          {!isEnabled && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-gray-500 text-sm">Click the circle icon to enable highlight layer</span>
            </div>
          )}

          {isEnabled && keyframes.length === 2 && !isEndKeyframeExplicit && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-gray-400 text-sm">Drag the highlight ellipse on the video to add keyframes</span>
            </div>
          )}

          {/* Keyframe indicators (only show when enabled) */}
          {isEnabled && keyframes.map((keyframe, index) => {
            const position = frameToPixel(keyframe.frame);
            const keyframeTime = frameToTime(keyframe.frame, framerate);
            const isAtCurrentTime = Math.abs(keyframeTime - currentTime) < 0.01;

            // Calculate effective start/end based on trimRange
            // After trimming, keyframes are reconstituted at trim boundaries
            // For highlight, the effective end is the minimum of highlightDuration and trimRange.end
            const effectiveStartTime = trimRange?.start ?? 0;
            const effectiveEndTime = trimRange ? Math.min(highlightDuration, trimRange.end) : highlightDuration;
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
                colorScheme="orange"
                isSelected={isSelected}
                shouldHighlight={shouldHighlight}
                isPermanent={isPermanent}
                isStartKeyframe={isStartKeyframe}
                isEndKeyframe={isEffectiveEndKeyframe}
                onClick={() => onKeyframeClick(keyframeTime, index)}
                onCopy={onKeyframeCopy ? () => onKeyframeCopy(keyframeTime) : undefined}
                onDelete={keyframes.length > 2 && !isPermanent ? () => onKeyframeDelete(keyframeTime, duration) : undefined}
                tooltip={`Highlight keyframe at frame ${keyframe.frame} (${keyframeTime.toFixed(3)}s)${
                  isEffectiveEndKeyframe && !isEndKeyframeExplicit ? ' (mirrors start)' : ''
                }${isSelected ? ' [SELECTED]' : ''}`}
                edgePadding={edgePadding}
                showCopyButton={!!onKeyframeCopy}
                showDeleteButton={keyframes.length > 2 && !isPermanent}
              />
            );
          })}
        </div>
      </div>

      {/* Duration slider row (only when enabled) */}
      {isEnabled && (
        <div className="relative h-8 border-t border-gray-700/30 flex items-center">
          {/* Duration label - positioned on the left outside the timeline */}
          <div className="absolute -left-32 w-32 flex items-center justify-center pr-2">
            <span className="text-xs text-gray-400 whitespace-nowrap">
              Duration
              <span className="ml-1 text-orange-400 font-mono">
                {highlightDuration.toFixed(1)}s
              </span>
            </span>
          </div>

          {/* Custom slider track - aligns with timeline */}
          <div
            ref={sliderTrackRef}
            className="absolute inset-0 cursor-pointer"
            onMouseDown={handleSliderMouseDown}
          >
            {/* Slider background track - with edge padding */}
            <div
              className="absolute inset-y-0 flex items-center"
              style={{
                left: `${edgePadding}px`,
                right: `${edgePadding}px`
              }}
            >
              <div className="w-full h-1.5 bg-gray-700 rounded-full" />
            </div>

            {/* Slider thumb - positioned at highlight end position */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
              style={{
                left: edgePadding > 0
                  ? `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${highlightEndPosition / 100})`
                  : `${highlightEndPosition}%`
              }}
            >
              <div
                className={`w-4 h-4 bg-orange-500 rounded-full border-2 border-white shadow-lg transition-transform ${
                  isDragging ? 'scale-125' : 'scale-100'
                }`}
              />
            </div>

            {/* Active track (filled portion) */}
            <div
              className="absolute inset-y-0 flex items-center pointer-events-none"
              style={{
                left: `${edgePadding}px`,
                width: edgePadding > 0
                  ? `calc((100% - ${edgePadding * 2}px) * ${highlightEndPosition / 100})`
                  : `${highlightEndPosition}%`
              }}
            >
              <div className="w-full h-1.5 bg-orange-500 rounded-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
