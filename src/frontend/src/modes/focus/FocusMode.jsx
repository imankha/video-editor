import React from 'react';
import { CropProvider } from './contexts/CropContext';
import FocusTimeline from './FocusTimeline';

/**
 * FocusMode - Container component for Framing mode.
 *
 * This component encapsulates all framing-specific UI and logic:
 * - FocusTimeline for crop and segment keyframes
 *
 * NOTE: CropOverlay is rendered by App.jsx inside VideoPlayer for correct positioning.
 * The overlay needs to be inside the video-container for absolute positioning to work.
 *
 * State management (useCrop, useSegments, useZoom) lives in App.jsx for coordinated
 * access across modes. This component receives state via props and context.
 *
 * @example
 * <FocusMode
 *   videoRef={videoRef}
 *   videoUrl={videoUrl}
 *   metadata={metadata}
 *   cropContextValue={cropContextValue}
 *   // ... other props
 * />
 */
export function FocusMode({
  // Video props
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  // Crop state (from useCrop in App.jsx for now)
  cropContextValue,
  currentCropState,
  aspectRatio,
  cropKeyframes,
  framerate,
  selectedCropKeyframeIndex,
  copiedCrop,
  onCropChange,
  onCropComplete,
  onCropKeyframeClick,
  onCropKeyframeDelete,
  onCropKeyframeCopy,
  onCropKeyframePaste,
  // Zoom state (from useZoom in App.jsx)
  zoom,
  panOffset,
  // Segment state (from useSegments in App.jsx)
  segments,
  segmentBoundaries,
  segmentVisualLayout,
  visualDuration,
  trimRange,
  trimHistory,
  onAddSegmentBoundary,
  onRemoveSegmentBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  onDetrimStart,
  onDetrimEnd,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  // Timeline state
  selectedLayer,
  onLayerSelect,
  onSeek,
  timelineZoom,
  onTimelineZoomByWheel,
  timelineZoomControls, // T10930: {zoomIn, zoomOut, resetZoom} -> TimelineZoomChip
  timelineScale,
  timelineScrollPosition,
  onTimelineScrollPositionChange,
  isPlaying = false,
  isFullscreen = false,
  // T9950 Slice 1 -- threads to FocusTimeline's showSegments gate.
  showSegments = true,
  // Children (allows App.jsx to pass additional content)
  children,
}) {
  return (
    <CropProvider value={cropContextValue}>
      {/* NOTE: CropOverlay is rendered by App.jsx inside VideoPlayer */}

      {/* FocusTimeline */}
      {videoUrl && (
        <div className={`${isFullscreen ? 'bg-gray-900/95 border-t border-gray-700 px-4 py-2' : 'mt-1 lg:mt-6'}`}>
          <FocusTimeline
            currentTime={currentTime}
            duration={duration}
            visualDuration={visualDuration || duration}
            onSeek={onSeek}
            cropKeyframes={cropKeyframes}
            framerate={framerate}
            isCropActive={true}
            onCropKeyframeClick={onCropKeyframeClick}
            onCropKeyframeDelete={onCropKeyframeDelete}
            onCropKeyframeCopy={onCropKeyframeCopy}
            onCropKeyframePaste={onCropKeyframePaste}
            selectedCropKeyframeIndex={selectedCropKeyframeIndex}
            selectedLayer={selectedLayer}
            onLayerSelect={onLayerSelect}
            segments={segments}
            segmentBoundaries={segmentBoundaries}
            segmentVisualLayout={segmentVisualLayout}
            isSegmentActive={true}
            onAddSegmentBoundary={onAddSegmentBoundary}
            onRemoveSegmentBoundary={onRemoveSegmentBoundary}
            onSegmentSpeedChange={onSegmentSpeedChange}
            onSegmentTrim={onSegmentTrim}
            trimRange={trimRange}
            trimHistory={trimHistory}
            onDetrimStart={onDetrimStart}
            onDetrimEnd={onDetrimEnd}
            sourceTimeToVisualTime={sourceTimeToVisualTime}
            visualTimeToSourceTime={visualTimeToSourceTime}
            timelineZoom={timelineZoom}
            onTimelineZoomByWheel={onTimelineZoomByWheel}
            timelineZoomControls={timelineZoomControls}
            timelineScale={timelineScale}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
            isPlaying={isPlaying}
            showSegments={showSegments}
          />
        </div>
      )}

      {/* Allow additional content to be passed in */}
      {children}
    </CropProvider>
  );
}

export default FocusMode;
