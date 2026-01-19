import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import ExportButton from '../components/ExportButton';
import { Button } from '../components/shared';
import { OverlayMode, HighlightOverlay, PlayerDetectionOverlay } from './overlay';
import { Eye, EyeOff, Minimize } from 'lucide-react';

/**
 * OverlayModeView - Complete view for Overlay mode
 *
 * This component contains all overlay-specific JSX that was previously in App.jsx.
 * It receives state and handlers as props from App.jsx.
 *
 * @see DECOMPOSITION_ANALYSIS.md for refactoring context
 */
export function OverlayModeView({
  // Fullscreen
  fullscreenContainerRef,
  isFullscreen,
  onToggleFullscreen,

  // Video state
  videoRef,
  effectiveOverlayVideoUrl,
  effectiveOverlayMetadata,
  effectiveOverlayFile,
  videoTitle,
  currentTime,
  duration,
  isPlaying,
  handlers,

  // Playback controls
  togglePlay,
  stepForward,
  stepBackward,
  restart,
  seek,

  // Highlight state
  currentHighlightState,
  highlightRegions,
  highlightBoundaries,
  highlightRegionKeyframes,
  highlightRegionsFramerate,
  highlightEffectType,
  isTimeInEnabledRegion,

  // Highlight handlers
  onHighlightChange,
  onHighlightComplete,
  onAddHighlightRegion,
  onDeleteHighlightRegion,
  onMoveHighlightRegionStart,
  onMoveHighlightRegionEnd,
  onRemoveHighlightKeyframe,
  onToggleHighlightRegion,
  onSelectedKeyframeChange,
  onHighlightEffectTypeChange,

  // Player detection
  playerDetectionEnabled,
  playerDetections,
  isDetectionLoading,
  isDetectionUploading,
  onPlayerSelect,
  showPlayerBoxes,
  onTogglePlayerBoxes,

  // Zoom
  zoom,
  panOffset,
  MIN_ZOOM,
  MAX_ZOOM,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomByWheel,
  onPanChange,

  // Timeline zoom
  timelineZoom,
  timelineScrollPosition,
  onTimelineZoomByWheel,
  onTimelineScrollPositionChange,
  getTimelineScale,

  // Layers
  selectedLayer,
  onLayerSelect,

  // Export
  exportButtonRef,
  getRegionsForExport,
  includeAudio,
  onIncludeAudioChange,
  onExportComplete,

  // Mode switching
  onSwitchToFraming,
  hasFramingEdits,
  hasMultipleClips,
  framingVideoUrl,
}) {
  // Show "export required" message if no overlay video but framing has edits
  const showExportRequired = !effectiveOverlayVideoUrl && framingVideoUrl && (hasFramingEdits || hasMultipleClips);

  return (
    <>
      {/* Video Metadata - use overlay metadata, hidden in fullscreen */}
      {effectiveOverlayMetadata && !isFullscreen && (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
          <div className="flex items-center justify-between text-sm text-gray-300">
            {videoTitle && <span className="font-semibold text-white">{videoTitle}</span>}
            <div className="flex space-x-6">
              <span>
                <span className="text-gray-400">Resolution:</span>{' '}
                {effectiveOverlayMetadata.width}x{effectiveOverlayMetadata.height}
              </span>
              {effectiveOverlayMetadata.framerate && (
                <span>
                  <span className="text-gray-400">Framerate:</span>{' '}
                  {effectiveOverlayMetadata.framerate} fps
                </span>
              )}
              <span>
                <span className="text-gray-400">Format:</span>{' '}
                {effectiveOverlayMetadata.format?.toUpperCase() || 'MP4'}
              </span>
              <span>
                <span className="text-gray-400">Size:</span>{' '}
                {(effectiveOverlayMetadata.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className={`${isFullscreen ? '' : 'bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20'}`}>
        {/* Controls Bar - hidden in fullscreen */}
        {effectiveOverlayVideoUrl && !isFullscreen && (
          <div className="mb-6 flex gap-4 items-center">
            <div className="ml-auto flex items-center gap-3">
              {/* Player detection boxes toggle */}
              {playerDetectionEnabled && (
                <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400 mr-1">Players:</span>
                  <button
                    onClick={onTogglePlayerBoxes}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-medium transition-colors ${
                      showPlayerBoxes
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                    title={showPlayerBoxes ? 'Hide player boxes' : 'Show player boxes'}
                  >
                    {showPlayerBoxes ? <Eye size={14} /> : <EyeOff size={14} />}
                    <span>{showPlayerBoxes ? 'On' : 'Off'}</span>
                  </button>
                </div>
              )}
              <ZoomControls
                zoom={zoom}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onResetZoom={onResetZoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
              />
            </div>
          </div>
        )}

        {/* Fullscreen container - uses fixed positioning for fullscreen */}
        <div
          ref={fullscreenContainerRef}
          className={`${isFullscreen ? 'fixed inset-0 z-[100] flex flex-col bg-gray-900' : ''}`}
        >
          {/* Video Player with overlay-specific overlays */}
          <div className={`relative bg-gray-900 ${isFullscreen ? 'flex-1 min-h-0' : 'rounded-lg'}`}>
            <VideoPlayer
            videoRef={videoRef}
            videoUrl={effectiveOverlayVideoUrl}
            handlers={handlers}
            overlays={[
              // HighlightOverlay - highlight box around player
              currentHighlightState && effectiveOverlayMetadata && (
                <HighlightOverlay
                  key="highlight"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  currentHighlight={currentHighlightState}
                  onHighlightChange={onHighlightChange}
                  onHighlightComplete={onHighlightComplete}
                  isEnabled={isTimeInEnabledRegion(currentTime)}
                  effectType={highlightEffectType}
                  zoom={zoom}
                  panOffset={panOffset}
                  isFullscreen={isFullscreen}
                />
              ),
              // PlayerDetectionOverlay - AI-detected player boxes (toggleable)
              effectiveOverlayMetadata && playerDetectionEnabled && showPlayerBoxes && (
                <PlayerDetectionOverlay
                  key="player-detection"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  detections={playerDetections}
                  isLoading={isDetectionLoading || isDetectionUploading}
                  onPlayerSelect={onPlayerSelect}
                  zoom={zoom}
                  panOffset={panOffset}
                  isFullscreen={isFullscreen}
                />
              ),
            ].filter(Boolean)}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={onZoomByWheel}
            onPanChange={onPanChange}
            isFullscreen={isFullscreen}
          />

            {/* Fullscreen exit button - top right corner */}
            {isFullscreen && (
              <div className="absolute top-4 right-4 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Minimize}
                  iconOnly
                  onClick={onToggleFullscreen}
                  title="Exit fullscreen (Esc)"
                  className="bg-black/50 hover:bg-black/70"
                />
              </div>
            )}

            {/* Controls */}
            {effectiveOverlayVideoUrl && (
              <Controls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={effectiveOverlayMetadata?.duration || duration}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
              />
            )}
          </div>

          {/* Overlay Mode Timeline - visible in fullscreen */}
          <div className={`${isFullscreen ? 'bg-gray-900/95 border-t border-gray-700 px-4 py-2' : 'mt-6'}`}>
            {effectiveOverlayVideoUrl && (
              <OverlayMode
            videoRef={videoRef}
            videoUrl={effectiveOverlayVideoUrl}
            metadata={effectiveOverlayMetadata}
            currentTime={currentTime}
            duration={effectiveOverlayMetadata?.duration || duration}
            highlightRegions={highlightRegions}
            highlightBoundaries={highlightBoundaries}
            highlightKeyframes={highlightRegionKeyframes}
            highlightFramerate={highlightRegionsFramerate}
            onAddHighlightRegion={onAddHighlightRegion}
            onDeleteHighlightRegion={onDeleteHighlightRegion}
            onMoveHighlightRegionStart={onMoveHighlightRegionStart}
            onMoveHighlightRegionEnd={onMoveHighlightRegionEnd}
            onRemoveHighlightKeyframe={onRemoveHighlightKeyframe}
            onToggleHighlightRegion={onToggleHighlightRegion}
            onSelectedKeyframeChange={onSelectedKeyframeChange}
            onHighlightChange={onHighlightChange}
            onHighlightComplete={onHighlightComplete}
            zoom={zoom}
            panOffset={panOffset}
            visualDuration={effectiveOverlayMetadata?.duration || duration}
            selectedLayer={selectedLayer}
            onLayerSelect={onLayerSelect}
            onSeek={seek}
            sourceTimeToVisualTime={(t) => t}
            visualTimeToSourceTime={(t) => t}
            timelineZoom={timelineZoom}
            onTimelineZoomByWheel={onTimelineZoomByWheel}
            timelineScale={getTimelineScale()}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
            trimRange={null}
            isPlaying={isPlaying}
            isFullscreen={isFullscreen}
              />
            )}
          </div>
        </div>

        {/* Export Required Message - hidden in fullscreen */}
        {showExportRequired && !isFullscreen && (
          <div className="mt-6 bg-purple-900/30 border border-purple-500/50 rounded-lg p-6 text-center">
            <p className="text-purple-200 font-medium mb-2">
              Export required for overlay mode
            </p>
            <p className="text-purple-300/70 text-sm mb-4">
              {hasMultipleClips
                ? 'You have multiple clips loaded. Export first to combine them into a single video before adding overlays.'
                : 'You have made edits in Framing mode. Export first to apply them before adding overlays.'}
            </p>
            <button
              onClick={onSwitchToFraming}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Switch to Framing Mode
            </button>
          </div>
        )}

        {/* Export Button - hidden in fullscreen */}
        {effectiveOverlayVideoUrl && !isFullscreen && (
          <div className="mt-6">
            <ExportButton
              ref={exportButtonRef}
              videoFile={effectiveOverlayFile}
              cropKeyframes={[]}
              highlightRegions={getRegionsForExport()}
              isHighlightEnabled={highlightRegions.length > 0}
              segmentData={null}
              disabled={!effectiveOverlayFile}
              includeAudio={includeAudio}
              onIncludeAudioChange={onIncludeAudioChange}
              highlightEffectType={highlightEffectType}
              onHighlightEffectTypeChange={onHighlightEffectTypeChange}
              onExportComplete={onExportComplete}
            />
          </div>
        )}
      </div>
    </>
  );
}
