import React from 'react';
import { Film, Crop, Split, Circle, Eye, EyeOff } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from './timeline/TimelineBase';
import CropLayer from './CropLayer';
import HighlightLayer from './HighlightLayer';
import SegmentLayer from './SegmentLayer';

/**
 * Timeline component - Shows timeline with playhead, scrubber, and all layers.
 * Uses TimelineBase for shared playhead/scrubbing logic.
 * Provides mode-specific layer labels and renders all layer components.
 *
 * NOTE: This is currently a combined timeline showing all layers (Framing + Overlay).
 * After mode switcher implementation, this will be replaced by:
 * - modes/framing/FramingTimeline.jsx (Crop + Segment layers)
 * - modes/overlay/OverlayTimeline.jsx (Highlight + future overlay layers)
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
  selectedCropKeyframeIndex = null,
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
  selectedLayer = 'playhead',
  onLayerSelect,
  segments = [],
  segmentBoundaries = [],
  segmentVisualLayout = [],
  trimRange = null,
  trimHistory = [],
  onDetrimStart,
  onDetrimEnd,
  isSegmentActive = false,
  onAddSegmentBoundary,
  onRemoveSegmentBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  timelineZoom = 100,
  onTimelineZoomByWheel,
  timelineScale = 1,
  timelineScrollPosition = 0,
  onTimelineScrollPositionChange
}) {
  // Calculate total layer height for playhead line
  const getTotalLayerHeight = () => {
    // Base: Video track (12) + Crop layer (12) = 24 + gaps
    let height = '9.5rem'; // Default without segments, highlight inactive

    if (segments.length > 0 && isHighlightActive) {
      height = '100%'; // Full height when both present
    } else if (segments.length > 0) {
      height = '100%'; // With segments
    } else if (isHighlightActive) {
      height = '11.5rem'; // With expanded highlight
    }

    return height;
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

      {/* Crop Layer Label */}
      <div
        className={`mt-1 h-12 flex items-center justify-center border-r border-gray-700/50 rounded-bl-lg transition-colors cursor-pointer ${
          selectedLayer === 'crop' ? 'bg-yellow-900/30' : 'bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect && onLayerSelect('crop')}
      >
        <Crop size={18} className={selectedLayer === 'crop' ? 'text-yellow-300' : 'text-yellow-400'} />
      </div>

      {/* Segment Layer Label (only if segments exist) */}
      {segments.length > 0 && (
        <div className="mt-1 h-16 flex items-center justify-center bg-gray-900 border-r border-gray-700/50 rounded-bl-lg">
          <Split size={18} className="text-purple-400" />
        </div>
      )}

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
      onDetrimStart={onDetrimStart}
      onDetrimEnd={onDetrimEnd}
    >
      {/* Crop Layer */}
      <div className="mt-1">
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
          selectedKeyframeIndex={selectedCropKeyframeIndex}
          isLayerSelected={selectedLayer === 'crop'}
          onLayerSelect={() => onLayerSelect && onLayerSelect('crop')}
          sourceTimeToVisualTime={sourceTimeToVisualTime}
          visualTimeToSourceTime={visualTimeToSourceTime}
          timelineScale={timelineScale}
          trimRange={trimRange}
          edgePadding={EDGE_PADDING}
        />
      </div>

      {/* Segment Layer */}
      {segments.length > 0 && (
        <div className="mt-1">
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
            trimRange={trimRange}
            trimHistory={trimHistory}
            onDetrimStart={onDetrimStart}
            onDetrimEnd={onDetrimEnd}
            sourceTimeToVisualTime={sourceTimeToVisualTime}
            visualTimeToSourceTime={visualTimeToSourceTime}
            timelineScale={timelineScale}
          />
        </div>
      )}

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
    </TimelineBase>
  );
}
