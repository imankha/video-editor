import { Crop, Trash2 } from 'lucide-react';
import { useCropContext } from '../contexts/CropContext';

/**
 * CropLayer component - displays crop keyframes on the timeline
 * Shows diamond indicators for each keyframe
 */
export default function CropLayer({
  keyframes,
  duration,
  currentTime,
  onKeyframeClick,
  onKeyframeDelete,
  isActive
}) {
  // Get isEndKeyframeExplicit from context instead of props
  const { isEndKeyframeExplicit } = useCropContext();
  if (keyframes.length === 0) {
    return null;
  }

  /**
   * Convert time to pixel position on timeline
   */
  const timeToPixel = (time) => {
    if (!duration) return 0;
    // Timeline width is 100%, so we return percentage
    return (time / duration) * 100;
  };

  return (
    <div className={`relative bg-gray-800 border-t border-gray-700 h-12 ${isActive ? 'ring-2 ring-blue-500' : ''}`}>
      {/* Layer label */}
      <div className="absolute left-0 top-0 h-full flex items-center px-3 bg-gray-900 border-r border-gray-700 w-32">
        <Crop size={14} className="text-blue-400 mr-2" />
        <span className="text-xs text-gray-300 font-medium">Crop Layer</span>
      </div>

      {/* Keyframes track */}
      <div className="absolute left-32 right-0 top-0 h-full">
        {/* Background track */}
        <div className="absolute inset-0 bg-blue-900 bg-opacity-20" />

        {/* Keyframe indicators */}
        {keyframes.map((keyframe, index) => {
          const position = timeToPixel(keyframe.time);
          const isAtCurrentTime = Math.abs(keyframe.time - currentTime) < 0.01;
          const isStartKeyframe = Math.abs(keyframe.time) < 0.01;
          const isEndKeyframe = Math.abs(keyframe.time - duration) < 0.01;
          const isAtStartTime = Math.abs(currentTime) < 0.01;

          // Highlight keyframe if:
          // 1. At current time, OR
          // 2. This is end keyframe, end hasn't been explicitly set, and we're at start time
          const shouldHighlight = isAtCurrentTime ||
                                  (isEndKeyframe && !isEndKeyframeExplicit && isAtStartTime);

          return (
            <div
              key={index}
              className="absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 group"
              style={{ left: `${position}%` }}
            >
              {/* Diamond keyframe indicator */}
              <div
                className={`w-3 h-3 transform rotate-45 cursor-pointer transition-all ${
                  shouldHighlight
                    ? 'bg-yellow-400 scale-125'
                    : 'bg-blue-400 hover:bg-blue-300 hover:scale-110'
                }`}
                onClick={() => onKeyframeClick(keyframe.time)}
                title={`Keyframe at ${keyframe.time.toFixed(3)}s${
                  isEndKeyframe && !isEndKeyframeExplicit ? ' (mirrors start)' : ''
                }`}
              />

              {/* Delete button (shown on hover, but not for permanent start/end keyframes) */}
              {keyframes.length > 2 &&
               Math.abs(keyframe.time) > 0.01 &&
               Math.abs(keyframe.time - duration) > 0.01 && (
                <button
                  className="absolute top-6 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onKeyframeDelete(keyframe.time, duration);
                  }}
                  title="Delete keyframe"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
