import React from 'react';
import { HighlightProvider } from './contexts/HighlightContext';
import OverlayTimeline from './OverlayTimeline';

/**
 * OverlayMode - Container component for Overlay mode.
 *
 * This component encapsulates all overlay-specific UI and logic:
 * - OverlayTimeline for highlight keyframes
 *
 * NOTE: HighlightOverlay is rendered by App.jsx inside VideoPlayer for correct positioning.
 * The overlay needs to be inside the video-container for absolute positioning to work.
 *
 * KEY PRINCIPLE: Overlay preview is 100% client-side. No backend calls during editing.
 * The HighlightOverlay renders as an SVG layer that:
 * - Renders highlight ellipse at current time
 * - Interpolates position from keyframes
 * - Updates in real-time during playback
 *
 * State management (useHighlight) lives in App.jsx for coordinated access
 * across modes. This component receives state via props and context.
 *
 * @example
 * <OverlayMode
 *   videoRef={videoRef}
 *   videoUrl={videoUrl}
 *   metadata={metadata}
 *   highlightContextValue={highlightContextValue}
 *   // ... other props
 * />
 */
export function OverlayMode({
  // Video props
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  // Highlight state (from useHighlight in App.jsx for now)
  highlightContextValue,
  currentHighlightState,
  isHighlightEnabled,
  highlightKeyframes,
  highlightFramerate,
  highlightDuration,
  selectedHighlightKeyframeIndex,
  copiedHighlight,
  onHighlightChange,
  onHighlightComplete,
  onHighlightKeyframeClick,
  onHighlightKeyframeDelete,
  onHighlightKeyframeCopy,
  onHighlightKeyframePaste,
  onHighlightToggleEnabled,
  onHighlightDurationChange,
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
  // Children (allows App.jsx to pass additional content)
  children,
}) {
  return (
    <HighlightProvider value={highlightContextValue}>
      {/* NOTE: HighlightOverlay is rendered by App.jsx inside VideoPlayer */}

      {/* OverlayTimeline */}
      {videoUrl && (
        <div className="mt-6">
          <OverlayTimeline
            currentTime={currentTime}
            duration={duration}
            visualDuration={visualDuration || duration}
            onSeek={onSeek}
            highlightKeyframes={highlightKeyframes}
            highlightFramerate={highlightFramerate}
            isHighlightActive={isHighlightEnabled}
            onHighlightKeyframeClick={onHighlightKeyframeClick}
            onHighlightKeyframeDelete={onHighlightKeyframeDelete}
            onHighlightKeyframeCopy={onHighlightKeyframeCopy}
            onHighlightKeyframePaste={onHighlightKeyframePaste}
            selectedHighlightKeyframeIndex={selectedHighlightKeyframeIndex}
            onHighlightToggleEnabled={onHighlightToggleEnabled}
            onHighlightDurationChange={onHighlightDurationChange}
            selectedLayer={selectedLayer}
            onLayerSelect={onLayerSelect}
            sourceTimeToVisualTime={sourceTimeToVisualTime}
            visualTimeToSourceTime={visualTimeToSourceTime}
            timelineZoom={timelineZoom}
            onTimelineZoomByWheel={onTimelineZoomByWheel}
            timelineScale={timelineScale}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
            trimRange={trimRange}
          />
        </div>
      )}

      {/* Allow additional content to be passed in */}
      {children}
    </HighlightProvider>
  );
}

export default OverlayMode;
