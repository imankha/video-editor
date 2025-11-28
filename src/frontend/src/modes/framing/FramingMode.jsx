import React from 'react';
import { CropProvider } from './contexts/CropContext';
import CropOverlay from './overlays/CropOverlay';
import FramingTimeline from './FramingTimeline';

/**
 * FramingMode - Container component for Framing mode.
 *
 * This component encapsulates all framing-specific UI and logic:
 * - CropOverlay for video crop preview/editing
 * - FramingTimeline for crop and segment keyframes
 *
 * Currently accepts props from App.jsx for minimal changes during Phase 2.
 * In Phase 3+, state management (useCrop, useSegments, useZoom) will move here.
 *
 * @example
 * <FramingMode
 *   videoRef={videoRef}
 *   videoUrl={videoUrl}
 *   metadata={metadata}
 *   cropContextValue={cropContextValue}
 *   // ... other props
 * />
 */
export function FramingMode({
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
  timelineScale,
  timelineScrollPosition,
  onTimelineScrollPositionChange,
  // Children (allows App.jsx to pass additional content)
  children,
}) {
  return (
    <CropProvider value={cropContextValue}>
      {/* Render CropOverlay if video is loaded and crop state exists */}
      {videoUrl && currentCropState && metadata && (
        <CropOverlay
          videoRef={videoRef}
          videoMetadata={metadata}
          currentCrop={currentCropState}
          aspectRatio={aspectRatio}
          onCropChange={onCropChange}
          onCropComplete={onCropComplete}
          zoom={zoom}
          panOffset={panOffset}
          selectedKeyframeIndex={selectedCropKeyframeIndex}
        />
      )}

      {/* FramingTimeline */}
      {videoUrl && (
        <div className="mt-6">
          <FramingTimeline
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
            timelineScale={timelineScale}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
          />
        </div>
      )}

      {/* Allow additional content to be passed in */}
      {children}
    </CropProvider>
  );
}

export default FramingMode;
