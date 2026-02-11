import { forwardRef } from 'react';
import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import ExportButtonView from '../components/ExportButtonView';
import { ExportButtonContainer, HIGHLIGHT_EFFECT_LABELS, EXPORT_CONFIG } from '../containers/ExportButtonContainer';
import { Button } from '../components/shared';
import { OverlayMode, HighlightOverlay, PlayerDetectionOverlay } from './overlay';
import { Minimize } from 'lucide-react';

/**
 * ExportButtonSection - Container+View composition for Overlay mode export
 *
 * Follows MVC pattern: Container handles logic, View handles presentation.
 */
const OverlayExportButtonSection = forwardRef(function OverlayExportButtonSection({
  videoFile,
  videoUrl,
  highlightRegions,
  highlightEffectType,
  onHighlightEffectTypeChange,
  includeAudio,
  onIncludeAudioChange,
  onExportComplete,
  disabled,
}, ref) {
  // Container: all business logic
  const container = ExportButtonContainer({
    videoFile,
    cropKeyframes: [],
    highlightRegions,
    isHighlightEnabled: highlightRegions.length > 0,
    segmentData: null,
    disabled,
    includeAudio,
    onIncludeAudioChange,
    highlightEffectType,
    onHighlightEffectTypeChange,
    onExportComplete,
  });

  // View: pure presentation
  return (
    <div className="mt-6">
      <ExportButtonView
        ref={ref}
        isCurrentlyExporting={container.isCurrentlyExporting}
        isExporting={container.isExporting}
        isExternallyExporting={false}
        displayProgress={container.displayProgress}
        displayMessage={container.displayMessage}
        error={container.error}
        isFramingMode={container.isFramingMode}
        isDarkOverlay={container.isDarkOverlay}
        hasUnextractedClips={container.hasUnextractedClips}
        extractingCount={container.extractingCount}
        pendingCount={container.pendingCount}
        hasUnframedClips={container.hasUnframedClips}
        unframedCount={container.unframedCount}
        totalExtractedClips={container.totalExtractedClips}
        isMultiClipMode={container.isMultiClipMode}
        isButtonDisabled={container.isButtonDisabled}
        buttonTitle={container.buttonTitle}
        includeAudio={includeAudio}
        isHighlightEnabled={highlightRegions.length > 0}
        highlightEffectType={highlightEffectType}
        onExport={container.handleExport}
        onAudioToggle={container.handleAudioToggle}
        onHighlightEffectTypeChange={onHighlightEffectTypeChange}
        HIGHLIGHT_EFFECT_LABELS={HIGHLIGHT_EFFECT_LABELS}
        EXPORT_CONFIG={EXPORT_CONFIG}
        handleExportRef={container.handleExportRef}
      />
    </div>
  );
});

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
  videoTags = [],
  currentTime,
  duration,
  isPlaying,
  handlers,
  // Loading state
  isLoading = false,
  isVideoElementLoading = false,
  loadingProgress = null,
  loadingElapsedSeconds = 0,
  error = null,
  isUrlExpiredError = () => false,
  onRetryVideo,
  loadingMessage = 'Loading video...',

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
  selectedHighlightKeyframeIndex,

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

  // Player detection (auto-detected during framing export)
  playerDetectionEnabled,
  playerDetections,
  isDetectionLoading,
  onPlayerSelect,
  showPlayerBoxes,
  onTogglePlayerBoxes,
  onEnablePlayerBoxes,
  onDetectionMarkerClick,

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
      {!isFullscreen && (effectiveOverlayMetadata ? (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
          <div className="flex items-center justify-between text-sm text-gray-300">
            {/* Left: Title + Tags */}
            <div className="flex flex-col gap-1">
              {videoTitle && <span className="font-semibold text-white">{videoTitle}</span>}
              {videoTags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {videoTags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Right: Metadata */}
            <div className="flex items-center gap-3 text-sm text-gray-300">
              <span>{effectiveOverlayMetadata.width}x{effectiveOverlayMetadata.height}</span>
              {effectiveOverlayMetadata.framerate && (
                <>
                  <span className="text-gray-600">•</span>
                  <span>{effectiveOverlayMetadata.framerate} fps</span>
                </>
              )}
            </div>
          </div>
        </div>
      ) : isLoading && (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 bg-gray-600 rounded w-32"></div>
            <div className="flex space-x-6">
              <div className="h-4 bg-gray-600 rounded w-24"></div>
              <div className="h-4 bg-gray-600 rounded w-20"></div>
              <div className="h-4 bg-gray-600 rounded w-16"></div>
            </div>
          </div>
        </div>
      ))}

      {/* Main Editor Area */}
      <div className={`${isFullscreen ? '' : 'bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20'}`}>
        {/* Controls Bar - hidden in fullscreen */}
        {effectiveOverlayVideoUrl && !isFullscreen && (
          <div className="mb-6 flex gap-4 items-center">
            <div className="ml-auto flex items-center gap-3">
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
              effectiveOverlayMetadata && playerDetectionEnabled && showPlayerBoxes && playerDetections?.length > 0 && (
                <PlayerDetectionOverlay
                  key="player-detection"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  detections={playerDetections}
                  isLoading={isDetectionLoading}
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
            isLoading={isLoading}
            isVideoElementLoading={isVideoElementLoading}
            loadingProgress={loadingProgress}
            loadingElapsedSeconds={loadingElapsedSeconds}
            error={error}
            isUrlExpiredError={isUrlExpiredError}
            onRetryVideo={onRetryVideo}
            loadingMessage={loadingMessage}
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
            {effectiveOverlayVideoUrl ? (
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
            selectedHighlightKeyframeIndex={selectedHighlightKeyframeIndex}
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
            showPlayerBoxes={showPlayerBoxes}
            onTogglePlayerBoxes={onTogglePlayerBoxes}
            onDetectionMarkerClick={onDetectionMarkerClick}
              />
            ) : isLoading ? (
              <div className="animate-pulse">
                <div className="h-8 bg-gray-700 rounded mb-2"></div>
                <div className="h-24 bg-gray-700 rounded"></div>
              </div>
            ) : null}
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
          <OverlayExportButtonSection
            ref={exportButtonRef}
            videoFile={effectiveOverlayFile}
            videoUrl={effectiveOverlayVideoUrl}
            highlightRegions={getRegionsForExport()}
            highlightEffectType={highlightEffectType}
            onHighlightEffectTypeChange={onHighlightEffectTypeChange}
            includeAudio={includeAudio}
            onIncludeAudioChange={onIncludeAudioChange}
            onExportComplete={onExportComplete}
            disabled={!effectiveOverlayFile && !effectiveOverlayVideoUrl}
          />
        )}
      </div>
    </>
  );
}
