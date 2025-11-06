import React from 'react';
import { formatTimeSimple } from '../utils/timeFormat';
import CropLayer from './CropLayer';

/**
 * Timeline component - Shows timeline with playhead and scrubber
 * @param {Object} props
 * @param {number} props.currentTime - Current video time
 * @param {number} props.duration - Total video duration
 * @param {Function} props.onSeek - Callback when user seeks
 * @param {Array} props.cropKeyframes - Crop keyframes to display
 * @param {boolean} props.isCropActive - Whether crop layer is active
 * @param {boolean} props.isEndKeyframeExplicit - Whether end keyframe has been explicitly set
 * @param {Function} props.onCropKeyframeClick - Callback when crop keyframe is clicked
 * @param {Function} props.onCropKeyframeDelete - Callback when crop keyframe is deleted
 */
export function Timeline({
  currentTime,
  duration,
  onSeek,
  cropKeyframes = [],
  isCropActive = false,
  isEndKeyframeExplicit = false,
  onCropKeyframeClick,
  onCropKeyframeDelete
}) {
  const timelineRef = React.useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [hoverTime, setHoverTime] = React.useState(null);
  const [hoverX, setHoverX] = React.useState(0);

  const getTimeFromPosition = (clientX) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const time = (x / rect.width) * duration;
    return Math.max(0, Math.min(time, duration));
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
    const time = getTimeFromPosition(e.clientX);

    setHoverX(x);
    setHoverTime(time);

    if (isDragging) {
      onSeek(time);
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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="timeline-container py-4">
      {/* Video Timeline Layer */}
      <div className="relative bg-gray-800 h-12 rounded-lg">
        {/* Layer label */}
        <div className="absolute left-0 top-0 h-full flex items-center px-3 bg-gray-900 border-r border-gray-700 w-32 rounded-l-lg">
          <span className="text-xs text-gray-300 font-medium">Video</span>
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

          {/* Playhead */}
          <div
            className="absolute top-0 w-1 h-full bg-white shadow-lg pointer-events-none"
            style={{ left: `${progress}%` }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full" />
          </div>

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

      {/* Time labels */}
      <div className="flex justify-between mt-2 text-xs text-gray-400">
        <span>{formatTimeSimple(currentTime)}</span>
        <span>{formatTimeSimple(duration)}</span>
      </div>

      {/* Crop Layer */}
      {cropKeyframes.length > 0 && (
        <div className="mt-2">
          <CropLayer
            keyframes={cropKeyframes}
            duration={duration}
            currentTime={currentTime}
            isActive={isCropActive}
            isEndKeyframeExplicit={isEndKeyframeExplicit}
            onKeyframeClick={onCropKeyframeClick}
            onKeyframeDelete={onCropKeyframeDelete}
          />
        </div>
      )}
    </div>
  );
}
