import React from 'react';
import { Film, Circle, Crosshair } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import RegionLayer from '../../components/timeline/RegionLayer';
import DetectionMarkerLayer from './layers/DetectionMarkerLayer';

/**
 * OverlayMode - Container component for Overlay mode.
 *
 * This component encapsulates all overlay-specific UI and logic:
 * - TimelineBase for playhead and video scrubbing
 * - RegionLayer for highlight regions (reused segment-style UI)
 *
 * NOTE: HighlightOverlay is rendered by App.jsx inside VideoPlayer for correct positioning.
 * The overlay needs to be inside the video-container for absolute positioning to work.
 *
 * KEY PRINCIPLE: Overlay preview is 100% client-side. No backend calls during editing.
 * The HighlightOverlay renders as an SVG layer that:
 * - Renders highlight ellipse when playhead is within an enabled region
 * - Interpolates position from keyframes (if any)
 * - Updates in real-time during playback
 *
 * State management (useHighlightRegions) lives in App.jsx for coordinated access
 * across modes. This component receives state via props.
 */
export function OverlayMode({
  // Video props
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  // Highlight regions state (from useHighlightRegions in App.jsx)
  highlightRegions = [],
  highlightBoundaries = [],
  highlightKeyframes = [],
  highlightFramerate = 30,
  selectedHighlightKeyframeIndex = null,
  onAddHighlightRegion,
  onDeleteHighlightRegion,
  onMoveHighlightRegionStart,
  onMoveHighlightRegionEnd,
  onRemoveHighlightKeyframe,
  onToggleHighlightRegion,
  onSelectedKeyframeChange,
  // Highlight interaction
  onHighlightChange,
  onHighlightComplete,
  // Zoom state (from useZoom in App.jsx)
  zoom,
  panOffset,
  // Timeline state
  visualDuration,
  selectedLayer,
  onLayerSelect,
  onSeek,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  timelineZoom,
  onTimelineZoomByWheel,
  timelineScale,
  timelineScrollPosition,
  onTimelineScrollPositionChange,
  trimRange = null,
  isPlaying = false,
  // Children (allows App.jsx to pass additional content)
  children,
}) {
  // Check if any region has detection data
  const hasDetectionData = highlightRegions.some(
    region => region.detections?.some(d => d.boxes?.length > 0)
  );

  // Calculate total layer height for playhead line
  // Video track (h-12=3rem) + Detection layer (h-8=2rem if present) + gap + Highlight regions (h-20=5rem)
  const getTotalLayerHeight = () => {
    if (hasDetectionData) {
      return '10.75rem'; // Video (3rem) + Detection (2rem) + gaps + Highlight regions (5rem)
    }
    return '8.5rem'; // Video (3rem) + gap (0.25rem) + Highlight regions (5rem) + padding
  };

  /**
   * Handle region action from RegionLayer
   */
  const handleRegionAction = (regionIndex, action, value) => {
    if (action === 'toggle' && onToggleHighlightRegion) {
      onToggleHighlightRegion(regionIndex, value);
    } else if (action === 'delete' && onDeleteHighlightRegion) {
      onDeleteHighlightRegion(regionIndex);
    }
  };

  // Layer labels for the fixed left column (matching FramingTimeline structure)
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

      {/* Detection Marker Layer Label (only if detection data exists) */}
      {hasDetectionData && (
        <div
          className="mt-1 h-8 flex items-center justify-center border-r border-gray-700/50 bg-gray-900"
          title="Player detection points - click to jump"
        >
          <Crosshair size={16} className="text-green-500" />
        </div>
      )}

      {/* Highlight Region Layer Label */}
      <div
        className={`mt-1 h-20 flex items-center justify-center border-r border-gray-700/50 rounded-bl-lg transition-colors cursor-pointer ${
          selectedLayer === 'highlight' ? 'bg-orange-900/30' : 'bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect && onLayerSelect('highlight')}
      >
        <Circle size={18} className={selectedLayer === 'highlight' ? 'text-orange-300' : 'text-orange-400'} />
      </div>
    </>
  );

  return (
    <>
      {/* Video Timeline with Highlight Regions inside */}
      {videoUrl && (
        <div className="mt-6">
          <TimelineBase
            currentTime={currentTime}
            duration={duration}
            visualDuration={visualDuration || duration}
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
            isPlaying={isPlaying}
          >
            {/* Detection Marker Layer (only if detection data exists) */}
            {hasDetectionData && (
              <div className="mt-1">
                <DetectionMarkerLayer
                  regions={highlightRegions}
                  duration={duration}
                  visualDuration={visualDuration || duration}
                  onSeek={onSeek}
                  sourceTimeToVisualTime={sourceTimeToVisualTime}
                  edgePadding={EDGE_PADDING}
                />
              </div>
            )}

            {/* Highlight Regions Layer - inside TimelineBase for proper alignment */}
            <div className="mt-1">
              <RegionLayer
                mode="highlight"
                regions={highlightRegions}
                boundaries={highlightBoundaries}
                keyframes={highlightKeyframes}
                framerate={highlightFramerate}
                selectedKeyframeIndex={selectedHighlightKeyframeIndex}
                duration={duration}
                visualDuration={visualDuration || duration}
                currentTime={currentTime}
                onAddRegion={onAddHighlightRegion}
                onMoveRegionStart={onMoveHighlightRegionStart}
                onMoveRegionEnd={onMoveHighlightRegionEnd}
                onRemoveKeyframe={onRemoveHighlightKeyframe}
                onRegionAction={handleRegionAction}
                onSelectedKeyframeChange={onSelectedKeyframeChange}
                onSeek={onSeek}
                sourceTimeToVisualTime={sourceTimeToVisualTime}
                visualTimeToSourceTime={visualTimeToSourceTime}
                colorScheme={{
                  bg: 'bg-orange-900',
                  hover: 'bg-orange-500',
                  accent: 'bg-orange-600',
                  line: 'bg-orange-400',
                  lineHover: 'bg-orange-300'
                }}
                emptyMessage="Click to add a highlight region"
                edgePadding={EDGE_PADDING}
              />
            </div>
          </TimelineBase>
        </div>
      )}

      {/* Allow additional content to be passed in */}
      {children}
    </>
  );
}

export default OverlayMode;
