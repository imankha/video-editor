import React from 'react';
import { Film, Crop, Split } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import CropLayer from './layers/CropLayer';
import SegmentLayer from './layers/SegmentLayer';

/**
 * FramingTimeline - Mode-specific timeline for Framing mode.
 * Renders CropLayer and SegmentLayer within TimelineBase.
 *
 * This is a thin wrapper that composes TimelineBase with framing-specific layers.
 * It handles:
 * - Layer labels for Video, Crop, and Segments
 * - Dynamic height based on whether segments exist
 * - Passing props to CropLayer and SegmentLayer
 */
export function FramingTimeline({
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
  onDetrimStart,
  onDetrimEnd,
  // CropLayer props
  cropKeyframes = [],
  framerate = 30,
  isCropActive = false,
  onCropKeyframeClick,
  onCropKeyframeDelete,
  onCropKeyframeCopy,
  onCropKeyframePaste,
  selectedCropKeyframeIndex = null,
  // SegmentLayer props
  segments = [],
  segmentBoundaries = [],
  segmentVisualLayout = [],
  trimHistory = [],
  isSegmentActive = false,
  onAddSegmentBoundary,
  onRemoveSegmentBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
}) {
  // Calculate total layer height for playhead line
  const getTotalLayerHeight = () => {
    // Base: Video track (12) + Crop layer (12) = 24 + gaps
    let height = '6.5rem'; // Default: Video + Crop only

    if (segments.length > 0) {
      height = '100%'; // Full height with segments
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
        className={`mt-1 h-12 flex items-center justify-center border-r border-gray-700/50 transition-colors cursor-pointer ${
          selectedLayer === 'crop' ? 'bg-yellow-900/30' : 'bg-gray-900 hover:bg-gray-800'
        } ${segments.length === 0 ? 'rounded-bl-lg' : ''}`}
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
    </TimelineBase>
  );
}

export default FramingTimeline;
