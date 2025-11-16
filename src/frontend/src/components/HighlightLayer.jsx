import { Circle, Trash2, Copy, Eye, EyeOff } from 'lucide-react';
import React from 'react';
import { useHighlightContext } from '../contexts/HighlightContext';
import { frameToTime } from '../utils/videoUtils';

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
  framerate = 30
}) {
  const { isEndKeyframeExplicit, copiedHighlight, isEnabled, highlightDuration } = useHighlightContext();

  const [hoveredKeyframeIndex, setHoveredKeyframeIndex] = React.useState(null);
  const trackRef = React.useRef(null);

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
   * Handle mouse move to determine which keyframe is closest to cursor
   */
  const handleTrackMouseMove = (e) => {
    if (!trackRef.current || keyframes.length === 0 || !isEnabled) return;

    const rect = trackRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mousePercent = (mouseX / rect.width) * 100;

    let closestIndex = null;
    let minDistance = Infinity;

    keyframes.forEach((keyframe, index) => {
      const keyframePercent = frameToPixel(keyframe.frame);
      const distance = Math.abs(mousePercent - keyframePercent);

      if (distance < 3 && distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    setHoveredKeyframeIndex(closestIndex);
  };

  const handleTrackMouseLeave = () => {
    setHoveredKeyframeIndex(null);
  };

  /**
   * Handle click on keyframes track to paste highlight at clicked time
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

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentX = (clickX / rect.width) * 100;

    const visualTime = (percentX / 100) * timelineDuration;
    const sourceTime = visualTimeToSourceTime(visualTime);
    const time = Math.max(0, Math.min(sourceTime, duration));

    console.log('[HighlightLayer] Paste highlight at time:', time);
    onKeyframePaste(time);
  };

  /**
   * Handle duration slider change
   */
  const handleDurationSliderChange = (e) => {
    const newDuration = parseFloat(e.target.value);
    if (onDurationChange) {
      onDurationChange(newDuration);
    }
  };

  // Calculate the highlight end position on timeline
  const highlightEndPosition = frameToPixel(Math.round(highlightDuration * framerate));

  return (
    <div className={`relative bg-gray-800/95 border-t border-gray-700/50 rounded-b-lg transition-all ${
      isLayerSelected ? 'ring-2 ring-orange-400 ring-opacity-75' : ''
    }`}>
      {/* Main row with toggle and keyframes */}
      <div className="relative h-12">
        {/* Layer label with toggle button */}
        <div className={`absolute left-0 top-0 h-full flex items-center justify-center border-r border-gray-700/50 w-32 rounded-bl-lg transition-colors ${
          isLayerSelected ? 'bg-orange-900/30' : 'bg-gray-900'
        }`}>
          <button
            onClick={onToggleEnabled}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              isEnabled
                ? isLayerSelected ? 'text-orange-300 hover:text-orange-200' : 'text-orange-400 hover:text-orange-300'
                : 'text-gray-500 hover:text-gray-400'
            }`}
            title={isEnabled ? 'Disable highlight layer' : 'Enable highlight layer'}
          >
            <Circle size={18} className={isEnabled ? 'fill-current' : ''} />
            {isEnabled ? (
              <Eye size={14} />
            ) : (
              <EyeOff size={14} />
            )}
          </button>
        </div>

        {/* Keyframes track */}
        <div
          ref={trackRef}
          className={`absolute left-32 right-0 top-0 h-full ${
            isEnabled && copiedHighlight ? 'cursor-copy' : ''
          } ${!isEnabled ? 'opacity-50' : ''}`}
          onClick={handleTrackClick}
          onMouseMove={handleTrackMouseMove}
          onMouseLeave={handleTrackMouseLeave}
        >
          {/* Background track */}
          <div className="absolute inset-0 bg-orange-900 bg-opacity-10" />

          {/* Active highlight region indicator */}
          {isEnabled && (
            <div
              className="absolute top-0 bottom-0 bg-orange-500/20 border-r-2 border-orange-400"
              style={{
                left: 0,
                width: `${highlightEndPosition}%`
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
            const isStartKeyframe = keyframe.frame === 0;
            const highlightEndFrame = Math.round(highlightDuration * framerate);
            const isEndKeyframe = keyframe.frame === highlightEndFrame;
            const isAtStartTime = Math.abs(currentTime) < 0.01;
            const isSelected = selectedKeyframeIndex === index;

            const shouldHighlight = isAtCurrentTime ||
                                    (isEndKeyframe && !isEndKeyframeExplicit && isAtStartTime);

            const isHovered = hoveredKeyframeIndex === index;

            return (
              <div
                key={index}
                className="absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50"
                style={{ left: `${position}%` }}
              >
                {/* Hit area */}
                <div className="absolute -top-5 -bottom-4 -left-4 -right-4" />

                {/* Copy button */}
                {onKeyframeCopy && (
                  <button
                    className={`absolute -top-5 left-1/2 transform -translate-x-1/2 transition-opacity bg-blue-600 hover:bg-blue-700 text-white rounded-full p-1 z-50 ${
                      isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
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
                    isSelected
                      ? 'bg-orange-300 scale-150 ring-2 ring-orange-200'
                      : shouldHighlight
                      ? 'bg-orange-400 scale-125'
                      : 'bg-orange-500 hover:bg-orange-400'
                  }`}
                  onClick={() => onKeyframeClick(keyframeTime, index)}
                  title={`Highlight keyframe at frame ${keyframe.frame} (${keyframeTime.toFixed(3)}s)${
                    isEndKeyframe && !isEndKeyframeExplicit ? ' (mirrors start)' : ''
                  }${isSelected ? ' [SELECTED]' : ''}`}
                />

                {/* Delete button */}
                {keyframes.length > 2 &&
                 !isStartKeyframe &&
                 !isEndKeyframe && (
                  <button
                    className={`absolute top-4 left-1/2 transform -translate-x-1/2 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1 z-50 ${
                      isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
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

      {/* Duration slider row (only when enabled) */}
      {isEnabled && (
        <div className="relative h-8 border-t border-gray-700/30">
          <div className="absolute left-0 top-0 h-full flex items-center justify-end bg-gray-900 border-r border-gray-700/50 w-32 pr-2">
            <span className="text-xs text-gray-400">
              Duration
              <span className="ml-1 text-orange-400 font-mono">
                {highlightDuration.toFixed(1)}s
              </span>
            </span>
          </div>
          <div className="absolute left-32 right-0 top-0 h-full flex items-center">
            <input
              type="range"
              min="0.5"
              max={duration || 60}
              step="0.1"
              value={highlightDuration}
              onChange={handleDurationSliderChange}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
              title={`Highlight duration: ${highlightDuration.toFixed(1)}s`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
