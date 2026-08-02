import React from 'react';
import { Film, Circle, Crosshair } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import RegionLayer from '../../components/timeline/RegionLayer';
import DetectionMarkerLayer from './layers/DetectionMarkerLayer';
import PosterMarkerLayer from './layers/PosterMarkerLayer';
import { openPlayWindow, selectPosterFrame } from '../../utils/posterWindow';

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
  // Player detection visibility
  showPlayerBoxes = true,
  onTogglePlayerBoxes,
  // Timeline state
  visualDuration,
  selectedLayer,
  onLayerSelect,
  onSeek,
  onDetectionMarkerClick,  // Called when user clicks a green detection marker
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  timelineZoom,
  onTimelineZoomByWheel,
  timelineScale,
  timelineScrollPosition,
  onTimelineScrollPositionChange,
  trimRange = null,
  isPlaying = false,
  // T5410: pre-export poster (cover-photo) marker
  posterMarkerTime = null,     // source-time seconds, or null (auto default)
  posterSlowmoSection = null,  // [start, end] (source/final time -- identity map) or null
  posterUploaded = false,      // a custom image is in use -- marker renders inactive
  onPosterMarkerDragEnd,       // (sourceTime) => void
  isExportInFlight = false,
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

  // T5410: default marker position (no override yet) = midpoint of the
  // open-play window, computed client-side from the SAME algorithm the
  // export-time selector uses (posterWindow.js mirrors poster.py exactly) --
  // never a guessed default that could diverge from what export picks.
  const effectiveDuration = visualDuration || duration || 0;
  const posterVisualTime = (() => {
    if (!effectiveDuration) return 0;
    if (posterMarkerTime != null) {
      return sourceTimeToVisualTime ? sourceTimeToVisualTime(posterMarkerTime) : posterMarkerTime;
    }
    const window = openPlayWindow(posterSlowmoSection, duration || effectiveDuration);
    const defaultSourceTime = selectPosterFrame(window, null);
    return sourceTimeToVisualTime ? sourceTimeToVisualTime(defaultSourceTime) : defaultSourceTime;
  })();

  const handlePosterMarkerDragEnd = (newVisualTime) => {
    if (!onPosterMarkerDragEnd) return;
    const sourceTime = visualTimeToSourceTime ? visualTimeToSourceTime(newVisualTime) : newVisualTime;
    onPosterMarkerDragEnd(sourceTime);
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
        className={`h-8 lg:h-12 flex items-center justify-center border-r border-gray-700 rounded-l-lg transition-colors cursor-pointer ${
          selectedLayer === 'playhead' ? 'bg-blue-900/50' : 'bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect && onLayerSelect('playhead')}
      >
        <Film size={18} className={selectedLayer === 'playhead' ? 'text-blue-300' : 'text-blue-400'} />
      </div>

      {/* Detection Marker Layer Label (only if detection data exists) */}
      {hasDetectionData && (
        <div
          className="mt-0.5 lg:mt-1 h-6 lg:h-8 flex items-center justify-center border-r border-gray-700/50 bg-gray-900 cursor-pointer hover:bg-gray-800 transition-colors"
          title={showPlayerBoxes ? 'Hide player boxes' : 'Show player boxes'}
          onClick={() => onTogglePlayerBoxes && onTogglePlayerBoxes()}
        >
          <div className="relative">
            <Crosshair size={16} className={showPlayerBoxes ? 'text-green-500' : 'text-gray-500'} />
            {!showPlayerBoxes && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-5 h-0.5 bg-red-500 rotate-45 transform origin-center" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Highlight Region Layer Label */}
      <div
        className={`mt-0.5 lg:mt-1 h-14 lg:h-20 flex items-center justify-center border-r border-gray-700/50 rounded-bl-lg transition-colors cursor-pointer ${
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
              <div className="mt-0.5 lg:mt-1">
                <DetectionMarkerLayer
                  regions={highlightRegions}
                  duration={duration}
                  visualDuration={visualDuration || duration}
                  onSeek={onSeek}
                  onDetectionMarkerClick={onDetectionMarkerClick}
                  sourceTimeToVisualTime={sourceTimeToVisualTime}
                  edgePadding={EDGE_PADDING}
                  isDisabled={!showPlayerBoxes}
                />
              </div>
            )}

            {/* Highlight Regions Layer - inside TimelineBase for proper alignment */}
            <div className="mt-0.5 lg:mt-1">
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

            {/* Poster (cover-photo) marker (T5410) -- pinned to the video-track
                top rail (see PosterMarkerLayer's own -top-3 absolute position),
                the SAME band the playhead occupies, so it never collides with
                the region drag handles above. */}
            <PosterMarkerLayer
              visualTime={posterVisualTime}
              duration={duration}
              visualDuration={visualDuration || duration}
              isUploaded={posterUploaded}
              onDragEnd={handlePosterMarkerDragEnd}
              visualTimeToSourceTime={visualTimeToSourceTime}
              edgePadding={EDGE_PADDING}
              disabled={isExportInFlight}
            />
          </TimelineBase>
        </div>
      )}

      {/* Allow additional content to be passed in */}
      {children}
    </>
  );
}

export default OverlayMode;
