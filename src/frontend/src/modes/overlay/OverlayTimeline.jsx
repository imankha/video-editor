import React from 'react';
import { Film, Circle, Eye, EyeOff } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import HighlightLayer from './layers/HighlightLayer';

/**
 * OverlayTimeline - Mode-specific timeline for Overlay mode.
 * Renders HighlightLayer (and future overlay layers) within TimelineBase.
 *
 * This is a thin wrapper that composes TimelineBase with overlay-specific layers.
 * It handles:
 * - Layer labels for Video and Highlight
 * - Dynamic height based on highlight enabled state
 * - Passing props to HighlightLayer
 *
 * NOTE: Overlay preview is 100% client-side. No backend calls during editing.
 */
export function OverlayTimeline({
  // TimelineBase props
  currentTime,
  duration,
  visualDuration,
  onSeek,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  timelineZoom = 100,
  onTimelineZoomByWheel,
  timelineScale = 1,
  timelineScrollPosition = 0,
  onTimelineScrollPositionChange,
  selectedLayer = 'playhead',
  onLayerSelect,
  trimRange = null,
  // HighlightLayer props
  highlightKeyframes = [],
  highlightFramerate = 30,
  isHighlightActive = false,
  onHighlightKeyframeClick,
  onHighlightKeyframeDelete,
  onHighlightKeyframeCopy,
  onHighlightKeyframePaste,
  selectedHighlightKeyframeIndex = null,
  onHighlightToggleEnabled,
  onHighlightDurationChange,
}) {
  // Calculate total layer height for playhead line
  const getTotalLayerHeight = () => {
    // Base: Video track (12) + Highlight layer
    // Highlight expands when active
    if (isHighlightActive) {
      return '8.5rem'; // Video (12) + Highlight expanded (20) + gaps
    }
    return '6.5rem'; // Video (12) + Highlight collapsed (12) + gaps
  };

  // Layer labels for the fixed left column
  const layerLabels = (
    <>
      {/* Video Timeline Label */}
      <div
        className={`h-12 flex items-center justify-center border-r border-gray-700 rounded-l-lg transition-colors cursor-pointer ${
          selectedLayer === 'playhead' ? 'bg-blue-900/50' : 'bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect && onLayerSelect('playhead')}
      >
        <Film size={18} className={selectedLayer === 'playhead' ? 'text-blue-300' : 'text-blue-400'} />
      </div>

      {/* Highlight Layer Label */}
      <div
        className={`mt-1 flex items-center justify-center border-r border-gray-700/50 rounded-bl-lg transition-colors cursor-pointer ${
          selectedLayer === 'highlight' ? 'bg-orange-900/30' : 'bg-gray-900 hover:bg-gray-800'
        } ${isHighlightActive ? 'h-20' : 'h-12'}`}
        onClick={(e) => {
          if (!e.target.closest('button')) {
            onLayerSelect && onLayerSelect('highlight');
          }
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onHighlightToggleEnabled();
            onLayerSelect && onLayerSelect('highlight');
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
            isHighlightActive
              ? selectedLayer === 'highlight' ? 'text-orange-300 hover:text-orange-200' : 'text-orange-400 hover:text-orange-300'
              : 'text-gray-500 hover:text-gray-400'
          }`}
          title={isHighlightActive ? 'Disable highlight layer' : 'Enable highlight layer'}
        >
          <Circle size={18} className={isHighlightActive ? 'fill-current' : ''} />
          {isHighlightActive ? (
            <Eye size={14} />
          ) : (
            <EyeOff size={14} />
          )}
        </button>
      </div>

      {/* Future: Additional overlay layer labels (BallGlow, Text, etc.) */}
    </>
  );

  return (
    <TimelineBase
      currentTime={currentTime}
      duration={duration}
      visualDuration={visualDuration}
      onSeek={onSeek}
      sourceTimeToVisualTime={sourceTimeToVisualTime}
      visualTimeToSourceTime={visualTimeToSourceTime}
      timelineZoom={timelineZoom}
      onTimelineZoomByWheel={onTimelineZoomByWheel}
      timelineScale={timelineScale}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineScrollPositionChange={onTimelineScrollPositionChange}
      selectedLayer={selectedLayer}
      onLayerSelect={onLayerSelect}
      layerLabels={layerLabels}
      totalLayerHeight={getTotalLayerHeight()}
      trimRange={trimRange}
    >
      {/* Highlight Layer */}
      <div className="mt-1">
        <HighlightLayer
          keyframes={highlightKeyframes}
          duration={duration}
          visualDuration={visualDuration}
          currentTime={currentTime}
          framerate={highlightFramerate}
          isActive={isHighlightActive}
          onKeyframeClick={onHighlightKeyframeClick}
          onKeyframeDelete={onHighlightKeyframeDelete}
          onKeyframeCopy={onHighlightKeyframeCopy}
          onKeyframePaste={onHighlightKeyframePaste}
          selectedKeyframeIndex={selectedHighlightKeyframeIndex}
          isLayerSelected={selectedLayer === 'highlight'}
          onLayerSelect={() => onLayerSelect && onLayerSelect('highlight')}
          onToggleEnabled={onHighlightToggleEnabled}
          onDurationChange={onHighlightDurationChange}
          sourceTimeToVisualTime={sourceTimeToVisualTime}
          visualTimeToSourceTime={visualTimeToSourceTime}
          timelineScale={timelineScale}
          trimRange={trimRange}
          edgePadding={EDGE_PADDING}
        />
      </div>

      {/* Future: Additional overlay layers (BallGlow, Text, etc.) */}
    </TimelineBase>
  );
}

export default OverlayTimeline;
