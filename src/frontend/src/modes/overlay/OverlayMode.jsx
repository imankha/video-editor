import React from 'react';
import { Film, Circle, Crosshair, Type, AlertTriangle, X } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import RegionLayer from '../../components/timeline/RegionLayer';
import TextLayer from '../../components/timeline/TextLayer';
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
  // T4350: dismissible "highlights need re-placement" banner after a re-export
  highlightCarryMessage = null,
  onDismissHighlightCarryNote,
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
  onCommitHighlightRegionStart,
  onCommitHighlightRegionEnd,
  onRemoveHighlightKeyframe,
  onToggleHighlightRegion,
  onSelectedKeyframeChange,
  // Highlight interaction
  onHighlightChange,
  onHighlightComplete,
  // T5225 / T6630 round 4: Overlay text REGIONS (from useTextOverlays in OverlayScreen)
  textOverlays = [],
  clipBoundaries = [],
  selectedRegionId = null,
  // T6630 round 5: region CREATION moved back onto the timeline lane (see
  // TextLayer's onAddRegion) -- named distinctly from onAddHighlightRegion
  // since both lanes live in this same component.
  onAddTextRegion,
  onMoveTextStart,
  onMoveTextEnd,
  onMoveTextBody,
  onSelectRegion,
  onDeleteTextRegion,
  // T6630 round 2: whole-text-layer visibility toggle (label icon).
  textLayerHidden = false,
  onToggleTextLayer,
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
  // T6630 round 6 item 4: true while the Thumbnail tab is active -- scrolls
  // the marker into view (see PosterMarkerLayer's revealOnActive doc).
  isThumbnailTabActive = false,
  // Children (allows App.jsx to pass additional content)
  children,
}) {
  // Check if any region has detection data
  const hasDetectionData = highlightRegions.some(
    region => region.detections?.some(d => d.boxes?.length > 0)
  );

  // Calculate total layer height for playhead line
  // Video track (h-12=3rem) + Detection layer (h-8=2rem if present) + gap + Highlight regions (h-20=5rem) + Text layer (h-20=5rem, T6630 round 9; was h-24=6rem since round 8 item 4, h-28=7rem since T6610)
  const getTotalLayerHeight = () => {
    if (hasDetectionData) {
      return '15.75rem'; // Video (3rem) + Detection (2rem) + gaps + Highlight regions (5rem) + Text (5rem)
    }
    return '13.5rem'; // Video (3rem) + gap (0.25rem) + Highlight regions (5rem) + Text (5rem) + padding
  };

  // T5410: default marker position (no override yet) = the open-play window's
  // own start (already past the slow-mo skip margin), or 2 seconds into it
  // when there's no slow-mo section (T6630 round 8; was always "+2s into the
  // window", which stacked with the slow-mo skip -- see selectPosterFrame),
  // computed client-side from the SAME algorithm the export-time selector
  // uses (posterWindow.js mirrors poster.py exactly) -- never a guessed
  // default that could diverge from what export picks.
  const effectiveDuration = visualDuration || duration || 0;
  const posterVisualTime = (() => {
    if (!effectiveDuration) return 0;
    if (posterMarkerTime != null) {
      return sourceTimeToVisualTime ? sourceTimeToVisualTime(posterMarkerTime) : posterMarkerTime;
    }
    const window = openPlayWindow(posterSlowmoSection, duration || effectiveDuration);
    const defaultSourceTime = selectPosterFrame(window, null, posterSlowmoSection);
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

  // Layer labels for the fixed left column (matching FocusTimeline structure).
  // T6630 round 2: lane order now reflects the TRUE paint order in the video
  // preview -- Text paints ON TOP of tracking (detection) and the spotlight
  // (highlight), so the Text lane sits directly under the Video ruler, above
  // Detection and Highlight (like every other editor's layer list).
  const layerLabels = (
    <>
      {/* Video Timeline Label (ruler) */}
      <div
        className={`h-8 lg:h-12 flex items-center justify-center border-r border-gray-700 rounded-tl-lg transition-colors cursor-pointer ${
          selectedLayer === 'playhead' ? 'bg-blue-900/50' : 'bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect && onLayerSelect('playhead')}
      >
        <Film size={18} className={selectedLayer === 'playhead' ? 'text-blue-300' : 'text-blue-400'} />
      </div>

      {/* Text Layer Label (T5225). T6630 round 2: the icon TOGGLES whole-layer
          visibility (hide every text block in the preview at once) -- a
          layer-level control distinct from the per-block eye (T6620). Mirrors the
          Detection label's show/hide-with-slash idiom below. Whole-layer hide is a
          view-only toggle (memory), never persisted. */}
      <div
        className={`mt-0.5 lg:mt-1 h-20 flex items-center justify-center border-r border-gray-700/50 transition-colors cursor-pointer ${
          textLayerHidden ? 'bg-gray-900 hover:bg-gray-800' : 'bg-cyan-900/30 hover:bg-cyan-900/40'
        }`}
        title={textLayerHidden ? 'Show text layer' : 'Hide text layer'}
        aria-pressed={!textLayerHidden}
        data-testid="text-layer-toggle"
        onClick={() => onToggleTextLayer && onToggleTextLayer()}
      >
        <div className="relative">
          <Type size={18} className={textLayerHidden ? 'text-gray-500' : 'text-cyan-300'} />
          {textLayerHidden && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-6 h-0.5 bg-red-500 rotate-45 transform origin-center" />
            </div>
          )}
        </div>
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

      {/* Highlight Region Layer Label (now the bottom lane -> rounds bottom-left) */}
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
      {/* T4350: persistent notice when a re-export dropped/reset carried highlights. */}
      {highlightCarryMessage && (
        <div
          role="status"
          data-testid="highlight-carry-banner"
          className="mt-4 flex items-start gap-2 rounded-lg border border-l-4 border-amber-500/40 border-l-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
          <span className="flex-1">{highlightCarryMessage}</span>
          {onDismissHighlightCarryNote && (
            <button
              type="button"
              onClick={onDismissHighlightCarryNote}
              aria-label="Dismiss highlight notice"
              className="shrink-0 rounded p-0.5 text-amber-300/70 hover:text-amber-100"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

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
            {/* Text Layer (T5225) -- FIRST overlay lane now (T6630 round 2): text
                paints on top in the preview, so its lane sits directly under the
                video ruler, above Detection and Highlight. T6630 round 3: TIMING
                ONLY -- add/remove/settings live in the Text tab (OverlayModeView).
                T6630 round 4: one block per REGION (a time span that can contain
                multiple elements); the lane's addressable unit is the region. */}
            <div className="mt-0.5 lg:mt-1">
              <TextLayer
                regions={textOverlays}
                duration={duration}
                visualDuration={visualDuration || duration}
                clipBoundaries={clipBoundaries}
                selectedRegionId={selectedRegionId}
                onAddRegion={onAddTextRegion}
                onMoveTextStart={onMoveTextStart}
                onMoveTextEnd={onMoveTextEnd}
                onMoveTextBody={onMoveTextBody}
                onSelectRegion={onSelectRegion}
                onDeleteTextRegion={onDeleteTextRegion}
                visualTimeToSourceTime={visualTimeToSourceTime}
                edgePadding={EDGE_PADDING}
              />
            </div>

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
                onCommitRegionStart={onCommitHighlightRegionStart}
                onCommitRegionEnd={onCommitHighlightRegionEnd}
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

            {/* Thumbnail marker (T5410; T6590 round 3) -- lives in the video track's
                TOP band (user decision: "on top of the timeline and draggable").
                Never clipped (positive top offset only) and never occluded by the
                playhead (explicit z-40 + opaque halo) -- see PosterMarkerLayer's
                docstring for the full reasoning. */}
            <PosterMarkerLayer
              visualTime={posterVisualTime}
              duration={duration}
              visualDuration={visualDuration || duration}
              isUploaded={posterUploaded}
              onDragEnd={handlePosterMarkerDragEnd}
              visualTimeToSourceTime={visualTimeToSourceTime}
              edgePadding={EDGE_PADDING}
              disabled={isExportInFlight}
              revealOnActive={isThumbnailTabActive}
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
