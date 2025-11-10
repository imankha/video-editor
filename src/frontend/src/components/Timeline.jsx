import React from 'react';
import { Film } from 'lucide-react';
import { formatTimeSimple } from '../utils/timeFormat';
import CropLayer from './CropLayer';
import SegmentLayer from './SegmentLayer';

/**
 * Timeline component - Shows timeline with playhead and scrubber
 * @param {Object} props
 * @param {number} props.currentTime - Current video time
 * @param {number} props.duration - Total source video duration
 * @param {number} props.visualDuration - Effective duration after speed/trim changes
 * @param {number} props.sourceDuration - Original video duration
 * @param {number} props.trimmedDuration - Total trimmed time
 * @param {Function} props.onSeek - Callback when user seeks
 * @param {Array} props.cropKeyframes - Crop keyframes to display
 * @param {number} props.framerate - Video framerate for frame-based crop keyframes
 * @param {boolean} props.isCropActive - Whether crop layer is active
 * @param {Function} props.onCropKeyframeClick - Callback when crop keyframe is clicked
 * @param {Function} props.onCropKeyframeDelete - Callback when crop keyframe is deleted
 * @param {Function} props.onCropKeyframeCopy - Callback when crop keyframe is copied
 * @param {Function} props.onCropKeyframePaste - Callback when crop is pasted at a time
 * @param {Array} props.segments - Segments to display
 * @param {Array} props.segmentBoundaries - Segment boundaries
 * @param {Array} props.segmentVisualLayout - Pre-calculated segment visual positions
 * @param {boolean} props.isSegmentActive - Whether segment layer is active
 * @param {Function} props.onAddSegmentBoundary - Callback when adding segment boundary
 * @param {Function} props.onRemoveSegmentBoundary - Callback when removing segment boundary
 * @param {Function} props.onSegmentSpeedChange - Callback when segment speed changes
 * @param {Function} props.onSegmentTrim - Callback when segment is trimmed
 * @param {Function} props.sourceTimeToVisualTime - Convert source time to visual time
 * @param {Function} props.visualTimeToSourceTime - Convert visual time to source time
 */
export function Timeline({
  currentTime,
  duration,
  visualDuration,
  sourceDuration,
  trimmedDuration,
  onSeek,
  cropKeyframes = [],
  framerate = 30,
  isCropActive = false,
  onCropKeyframeClick,
  onCropKeyframeDelete,
  onCropKeyframeCopy,
  onCropKeyframePaste,
  segments = [],
  segmentBoundaries = [],
  segmentVisualLayout = [],
  isSegmentActive = false,
  onAddSegmentBoundary,
  onRemoveSegmentBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t
}) {
  const timelineRef = React.useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [hoverTime, setHoverTime] = React.useState(null);
  const [hoverX, setHoverX] = React.useState(0);

  const getTimeFromPosition = (clientX) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));

    // Calculate visual time from position (timeline displays visual duration)
    const effectiveDuration = visualDuration || duration;
    const visualTime = (x / rect.width) * effectiveDuration;

    // Convert visual time to source time for seeking
    const sourceTime = visualTimeToSourceTime(visualTime);

    return Math.max(0, Math.min(sourceTime, duration));
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    const time = getTimeFromPosition(e.clientX);
    onSeek(time);
  };

  const handleMouseMove = (e) => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));

    // Calculate visual time for display
    const effectiveDuration = visualDuration || duration;
    const visualTime = (x / rect.width) * effectiveDuration;

    setHoverX(x);
    setHoverTime(visualTime); // Store visual time for display

    if (isDragging) {
      // Get source time for seeking
      const sourceTime = getTimeFromPosition(e.clientX);
      onSeek(sourceTime);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
    setIsDragging(false);
  };

  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isDragging]);

  // Convert current source time to visual time for correct playhead positioning
  const visualCurrentTime = sourceTimeToVisualTime(currentTime);

  // Calculate progress using visual time and visual duration
  const effectiveDuration = visualDuration || duration;
  const progress = effectiveDuration > 0 ? (visualCurrentTime / effectiveDuration) * 100 : 0;

  // Use visual duration for display (if segments exist), otherwise use source duration
  const displayDuration = visualDuration || duration;

  return (
    <div className="timeline-container py-4">
      {/* Time labels - shows visual duration (after speed/trim adjustments) */}
      <div className="flex justify-between mb-2 text-xs text-gray-400 pl-32">
        <span>{formatTimeSimple(visualCurrentTime)}</span>
        <span title={visualDuration !== duration ? `Source: ${formatTimeSimple(duration)}` : undefined}>
          {formatTimeSimple(displayDuration)}
        </span>
      </div>

      {/* Timeline layers container with unified playhead */}
      <div className="relative">
        {/* Video Timeline Layer */}
        <div className="relative bg-gray-800 h-12 rounded-lg">
          {/* Layer label */}
          <div className="absolute left-0 top-0 h-full flex items-center justify-center bg-gray-900 border-r border-gray-700 w-32 rounded-l-lg">
            <Film size={18} className="text-blue-400" />
          </div>

          {/* Timeline track */}
          <div
            ref={timelineRef}
            className="absolute left-32 right-0 top-0 h-full bg-gray-700 rounded-r-lg cursor-pointer select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Progress bar */}
            <div
              className="absolute top-0 left-0 h-full bg-blue-600 rounded-r-lg transition-all pointer-events-none"
              style={{ width: `${progress}%` }}
            />

            {/* Hover tooltip */}
            {hoverTime !== null && !isDragging && (
              <div
                className="absolute -top-8 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded pointer-events-none"
                style={{ left: `${hoverX}px` }}
              >
                {formatTimeSimple(hoverTime)}
              </div>
            )}
          </div>
        </div>

        {/* Crop Layer */}
        {cropKeyframes.length > 0 && (
          <div className="mt-2">
            <CropLayer
              keyframes={cropKeyframes}
              duration={duration}
              visualDuration={visualDuration}
              currentTime={currentTime}
              framerate={framerate}
              isActive={isCropActive}
              onKeyframeClick={onCropKeyframeClick}
              onKeyframeDelete={onCropKeyframeDelete}
              onKeyframeCopy={onCropKeyframeCopy}
              onKeyframePaste={onCropKeyframePaste}
              sourceTimeToVisualTime={sourceTimeToVisualTime}
              visualTimeToSourceTime={visualTimeToSourceTime}
            />
          </div>
        )}

        {/* Segment Layer */}
        {segments.length > 0 && (
          <div className="mt-2">
            <SegmentLayer
              segments={segments}
              boundaries={segmentBoundaries}
              duration={duration}
              visualDuration={visualDuration}
              currentTime={currentTime}
              isActive={isSegmentActive}
              segmentVisualLayout={segmentVisualLayout}
              onAddBoundary={onAddSegmentBoundary}
              onRemoveBoundary={onRemoveSegmentBoundary}
              onSegmentSpeedChange={onSegmentSpeedChange}
              onSegmentTrim={onSegmentTrim}
              sourceTimeToVisualTime={sourceTimeToVisualTime}
              visualTimeToSourceTime={visualTimeToSourceTime}
            />
          </div>
        )}

        {/* Unified Playhead - extends through all layers */}
        <div
          className="absolute top-0 w-1 bg-white shadow-lg pointer-events-none left-32 z-30"
          style={{
            left: `calc(8rem + (100% - 8rem) * ${progress / 100})`,  // 8rem label + progress% of remaining width
            height: (cropKeyframes.length > 0 || segments.length > 0) ? 'calc(100% - 0.25rem)' : '3rem'  // Extend through all layers
          }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full" />
        </div>
      </div>
    </div>
  );
}
