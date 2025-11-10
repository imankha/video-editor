import { Crop, Trash2, Copy } from 'lucide-react';
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
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  framerate = 30
}) {
  // Get isEndKeyframeExplicit and copiedCrop from context
  const { isEndKeyframeExplicit, copiedCrop } = useCropContext();
  if (keyframes.length === 0) {
    return null;
  }

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
   * Handle click on keyframes track to paste crop at clicked time
   */
  const handleTrackClick = (e) => {
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
    <div className={`relative bg-gray-800 border-t border-gray-700 h-12 z-20 ${isActive ? 'ring-2 ring-blue-500' : ''}`}>
      {/* Layer label */}
      <div className="absolute left-0 top-0 h-full flex items-center justify-center bg-gray-900 border-r border-gray-700 w-32">
        <Crop size={18} className="text-blue-400" />
      </div>

      {/* Keyframes track */}
      <div
        className={`absolute left-32 right-0 top-0 h-full ${copiedCrop ? 'cursor-copy' : ''}`}
        onClick={handleTrackClick}
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-blue-900 bg-opacity-20" />

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
              {/* Copy button (shown on hover, above keyframe) - z-50 to appear above all UI including playhead */}
              {onKeyframeCopy && (
                <button
                  className="absolute -top-8 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 hover:bg-blue-700 text-white rounded-full p-1 z-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onKeyframeCopy(keyframeTime);
                  }}
                  title="Copy keyframe"
                >
                  <Copy size={10} />
                </button>
              )}

              {/* Diamond keyframe indicator */}
              <div
                className={`w-3 h-3 transform rotate-45 cursor-pointer transition-all ${
                  shouldHighlight
                    ? 'bg-yellow-400 scale-125'
                    : 'bg-blue-400 hover:bg-blue-300 hover:scale-110'
                }`}
                onClick={() => onKeyframeClick(keyframeTime)}
                title={`Keyframe at frame ${keyframe.frame} (${keyframeTime.toFixed(3)}s)${
                  isEndKeyframe && !isEndKeyframeExplicit ? ' (mirrors start)' : ''
                }`}
              />

              {/* Delete button (shown on hover, but not for permanent start/end keyframes) */}
              {keyframes.length > 2 &&
               !isStartKeyframe &&
               !isEndKeyframe && (
                <button
                  className="absolute top-6 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onKeyframeDelete(keyframeTime, duration);
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
