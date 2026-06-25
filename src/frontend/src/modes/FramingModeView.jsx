import { forwardRef, useState } from 'react';
import { Minimize, ArrowLeft, Crop, Move } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import AspectRatioSelector from '../components/AspectRatioSelector';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import ExportButtonView from '../components/ExportButtonView';
import { ExportButtonContainer, HIGHLIGHT_EFFECT_LABELS, EXPORT_CONFIG } from '../containers/ExportButtonContainer';
import { Button } from '../components/shared';
import { FramingMode, CropOverlay } from './framing';
import { formatTimeSimple } from '../components/shared/clipConstants';
import { useEditorStore } from '../stores/editorStore';

/**
 * ExportButtonSection - Container+View composition for Framing mode export
 *
 * Follows MVC pattern: Container handles logic, View handles presentation.
 */
const ExportButtonSection = forwardRef(function ExportButtonSection({
  videoFile,
  cropKeyframes,
  segmentData,
  disabled,
  includeAudio,
  onIncludeAudioChange,
  onProceedToOverlay,
  clips,
  globalAspectRatio,
  globalTransition,
  onExportComplete,
  saveCurrentClipState,
}, ref) {
  // Container: all business logic
  const container = ExportButtonContainer({
    videoFile,
    cropKeyframes,
    highlightRegions: [],
    isHighlightEnabled: false,
    segmentData,
    disabled,
    includeAudio,
    onIncludeAudioChange,
    onProceedToOverlay,
    clips,
    globalAspectRatio,
    globalTransition,
    onExportComplete,
    saveCurrentClipState,
  });

  // View: pure presentation
  return (
    <div className="mt-4 sm:mt-6">
      <ExportButtonView
        ref={ref}
        isCurrentlyExporting={container.isCurrentlyExporting}
        isExporting={container.isExporting}
        isExternallyExporting={false}
        displayProgress={container.displayProgress}
        displayMessage={container.displayMessage}
        error={container.error}
        failedExport={container.failedExport}
        disconnected={container.disconnected}
        reconnectionFailed={container.reconnectionFailed}
        retrying={container.retrying}
        isFramingMode={container.isFramingMode}
        isDarkOverlay={container.isDarkOverlay}
        hasUnframedClips={container.hasUnframedClips}
        unframedCount={container.unframedCount}
        totalExtractedClips={container.totalExtractedClips}
        isMultiClipMode={container.isMultiClipMode}
        isButtonDisabled={container.isButtonDisabled}
        buttonTitle={container.buttonTitle}
        includeAudio={includeAudio}
        isHighlightEnabled={false}
        highlightEffectType={null}
        onExport={container.handleExport}
        onRetryConnection={container.handleRetryConnection}
        onDismissExport={container.handleDismissExport}
        onAudioToggle={container.handleAudioToggle}
        onHighlightEffectTypeChange={null}
        HIGHLIGHT_EFFECT_LABELS={HIGHLIGHT_EFFECT_LABELS}
        EXPORT_CONFIG={EXPORT_CONFIG}
        showInsufficientCredits={container.showInsufficientCredits}
        onCloseInsufficientCredits={container.onCloseInsufficientCredits}
        showBuyCredits={container.showBuyCredits}
        onOpenBuyCredits={container.onOpenBuyCredits}
        onCloseBuyCredits={container.onCloseBuyCredits}
        onPaymentSuccess={container.onPaymentSuccess}
        handleExportRef={container.handleExportRef}
      />
    </div>
  );
});

/**
 * FramingModeView - Complete view for Framing mode
 *
 * This component contains all framing-specific JSX that was previously in App.jsx.
 * It receives state and handlers as props from App.jsx.
 *
 * @see DECOMPOSITION_ANALYSIS.md for refactoring context
 */
export function FramingModeView({
  // Video state
  videoRef,
  videoUrl,
  metadata,
  videoFile,
  clipTitle,
  clipGameName,
  clipTags = [],
  clipDuration = 0,
  currentTime,
  duration,
  isPlaying,
  isLoading,
  isVideoElementLoading = false,
  loadingProgress = null,
  loadingElapsedSeconds = 0,
  isProjectLoading = false,
  loadingStage = null,
  error,
  isUrlExpiredError = () => false,
  onRetryVideo,
  clipRange = null,
  handlers,

  // Fullscreen
  fullscreenContainerRef,
  isFullscreen,
  onToggleFullscreen,

  // File handling
  onFileSelect,

  // Playback controls
  togglePlay,
  stepForward,
  stepBackward,
  restart,
  seek,

  // Crop state
  currentCropState,
  aspectRatio,
  keyframes,
  framerate,
  selectedCropKeyframeIndex,
  copiedCrop,
  dragCrop,

  // Crop handlers
  onCropChange,
  onCropComplete,
  onKeyframeClick,
  onKeyframeDelete,
  onCopyCrop,
  onPasteCrop,

  // Zoom state
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

  // Segments
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

  // Layers
  selectedLayer,
  onLayerSelect,

  // Clips
  hasClips,
  clipsWithCurrentState,
  globalAspectRatio,
  onAspectRatioChange,
  globalTransition,

  // Export
  exportButtonRef,
  getFilteredKeyframesForExport,
  getSegmentExportData,
  includeAudio,
  onIncludeAudioChange,
  onProceedToOverlay,
  onExportComplete,
  saveCurrentClipState,  // For backend-authoritative export

  // Context
  cropContextValue,
}) {
  const [dimOpacity, setDimOpacity] = useState(0.2);
  const [touchMode, setTouchMode] = useState('crop');
  const isMobile = useIsMobile();
  const fsControls = useFullscreenControls({ isPlaying });
  const mobileFs = isMobile;
  const setEditorMode = useEditorStore((s) => s.setEditorMode);

  return (
    <>
      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-500/20 border border-red-500 rounded-lg p-4">
          <p className="text-red-200 font-semibold mb-1">Video Error</p>
          <p className="text-red-300 text-sm">{error}</p>
          {isUrlExpiredError() && onRetryVideo && (
            <button
              onClick={onRetryVideo}
              className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              Retry Loading Video
            </button>
          )}
        </div>
      )}

      {/* Video Metadata - hidden in fullscreen, hidden below lg on mobile */}
      {metadata && !isFullscreen && (
        <div className="hidden lg:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-3 lg:p-4 border border-white/20">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1 lg:gap-0 text-sm text-gray-300">
            {/* Left: Title + Game + Tags */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {clipTitle && <span className="font-semibold text-white">{clipTitle}</span>}
                {clipGameName && (
                  <>
                    <span className="text-gray-500">•</span>
                    <span className="text-gray-400">{clipGameName}</span>
                  </>
                )}
              </div>
              {clipTags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {clipTags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Metadata */}
            <div className="flex items-center gap-3 text-sm text-gray-300">
              <span>{metadata.width}x{metadata.height}</span>
              <>
                <span className="text-gray-600">•</span>
                <span>{formatTimeSimple(duration || clipDuration)}</span>
              </>
              {metadata.framerate && (
                <>
                  <span className="text-gray-600">•</span>
                  <span>{Math.round(metadata.framerate)} fps</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className={`${(isFullscreen || mobileFs) ? '' : 'bg-white/10 backdrop-blur-lg rounded-lg p-3 sm:p-6 border border-white/20'}`}>
        {/* Controls Bar - hidden in fullscreen and on mobile */}
        {videoUrl && !isFullscreen && !mobileFs && (
          <div className="hidden lg:flex mb-3 lg:mb-6 gap-4 items-center">
            {/* Reel-level aspect ratio (T3910): applies to ALL clips, re-fitting their crop. */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Aspect ratio:</span>
              <AspectRatioSelector
                aspectRatio={aspectRatio}
                onAspectRatioChange={onAspectRatioChange}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-400 mr-2">Background:</span>
                <span className="text-xs text-gray-300 mr-1.5">Dim</span>
                <button
                  onClick={() => setDimOpacity(dimOpacity === 0.2 ? 0.7 : 0.2)}
                  className="relative w-8 h-4 rounded-full transition-colors"
                  style={{ backgroundColor: dimOpacity === 0.7 ? '#2563eb' : '#4b5563' }}
                  aria-label="Toggle background darkness"
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform"
                    style={{ transform: dimOpacity === 0.7 ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
                <span className="text-xs text-gray-300 ml-1.5">Dark</span>
              </div>
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

        {/* Fullscreen container - uses fixed positioning to overlay viewport */}
        <div
          ref={fullscreenContainerRef}
          className={`${(isFullscreen || mobileFs) ? `fixed inset-0 z-[100] bg-gray-900${mobileFs ? '' : ' flex flex-col'}` : ''}`}
          onMouseMove={mobileFs ? fsControls.handleInteraction : undefined}
        >
          {/* Video Player with CropOverlay */}
          <div
            className={`relative bg-gray-900 ${
              (isFullscreen || mobileFs)
                ? mobileFs ? 'w-full h-full' : 'flex-1 min-h-0'
                : 'rounded-lg'
            }`}
            onClick={mobileFs ? togglePlay : undefined}
            onTouchStart={mobileFs ? fsControls.handleLongPressTouchStart : undefined}
            onTouchMove={mobileFs ? fsControls.handleLongPressTouchMove : undefined}
            onTouchEnd={mobileFs ? fsControls.handleLongPressTouchEnd : undefined}
          >
            <VideoPlayer
              videoRef={videoRef}
              videoUrl={videoUrl}
              handlers={handlers}
              clipRange={clipRange}
              muted={!includeAudio}
              onFileSelect={(isFullscreen || mobileFs) ? undefined : onFileSelect}
              allowUpload={false}
              panEnabled={!mobileFs || touchMode === 'view'}
              overlays={[
                videoUrl && currentCropState && metadata && (
                  <CropOverlay
                    key="crop"
                    videoRef={videoRef}
                    videoMetadata={metadata}
                    currentCrop={currentCropState}
                    aspectRatio={aspectRatio}
                    onCropChange={onCropChange}
                    onCropComplete={onCropComplete}
                    zoom={zoom}
                    panOffset={panOffset}
                    selectedKeyframeIndex={selectedCropKeyframeIndex}
                    isFullscreen={isFullscreen}
                    dimOpacity={dimOpacity}
                    interactive={!mobileFs || touchMode === 'crop'}
                  />
                ),
              ].filter(Boolean)}
              zoom={zoom}
              panOffset={panOffset}
              onZoomChange={onZoomByWheel}
              onPanChange={onPanChange}
              isFullscreen={isFullscreen}
              isLoading={isLoading || isProjectLoading}
              isVideoElementLoading={isVideoElementLoading}
              loadingProgress={loadingProgress}
              loadingElapsedSeconds={loadingElapsedSeconds}
              error={error}
              isUrlExpiredError={isUrlExpiredError}
              onRetryVideo={onRetryVideo}
              loadingMessage={
                loadingStage === 'clips' ? 'Loading clips...' :
                loadingStage === 'video' ? 'Loading video...' :
                loadingStage === 'working-video' ? 'Loading working video...' :
                isLoading ? 'Loading video...' : 'Loading...'
              }
            />

            {/* Fullscreen exit button - desktop only (mobile has it in overlay) */}
            {isFullscreen && !mobileFs && (
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

            {/* Controls - desktop fullscreen & non-fullscreen */}
            {!mobileFs && videoUrl && (
              <Controls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
              />
            )}
          </div>

          {/* Mobile-only clip title — minimal, under video */}
          {clipTitle && !isFullscreen && !mobileFs && (
            <div className="lg:hidden flex items-center justify-between gap-2 px-2 py-0.5 text-sm text-gray-300">
              <div className="truncate">
                <span className="font-medium text-white">{clipTitle}</span>
                {clipGameName && <span className="text-gray-500"> · {clipGameName}</span>}
              </div>
              {/* Aspect ratio is reel-wide; read-only on mobile (change it on desktop). */}
              <AspectRatioSelector aspectRatio={aspectRatio} readOnly />
            </div>
          )}

          {/* Timeline - desktop fullscreen & non-fullscreen */}
          {!mobileFs && videoUrl && (
          <FramingMode
            videoRef={videoRef}
            videoUrl={videoUrl}
            metadata={metadata}
            currentTime={currentTime}
            duration={duration}
            cropContextValue={cropContextValue}
            currentCropState={currentCropState}
            aspectRatio={aspectRatio}
            cropKeyframes={keyframes}
            framerate={framerate}
            selectedCropKeyframeIndex={selectedCropKeyframeIndex}
            copiedCrop={copiedCrop}
            onCropChange={onCropChange}
            onCropComplete={onCropComplete}
            onCropKeyframeClick={onKeyframeClick}
            onCropKeyframeDelete={onKeyframeDelete}
            onCropKeyframeCopy={onCopyCrop}
            onCropKeyframePaste={onPasteCrop}
            zoom={zoom}
            panOffset={panOffset}
            segments={segments}
            segmentBoundaries={segmentBoundaries}
            segmentVisualLayout={segmentVisualLayout}
            visualDuration={visualDuration || duration}
            trimRange={trimRange}
            trimHistory={trimHistory}
            onAddSegmentBoundary={onAddSegmentBoundary}
            onRemoveSegmentBoundary={onRemoveSegmentBoundary}
            onSegmentSpeedChange={onSegmentSpeedChange}
            onSegmentTrim={onSegmentTrim}
            onDetrimStart={onDetrimStart}
            onDetrimEnd={onDetrimEnd}
            sourceTimeToVisualTime={sourceTimeToVisualTime}
            visualTimeToSourceTime={visualTimeToSourceTime}
            selectedLayer={selectedLayer}
            onLayerSelect={onLayerSelect}
            onSeek={seek}
            timelineZoom={timelineZoom}
            onTimelineZoomByWheel={onTimelineZoomByWheel}
            timelineScale={getTimelineScale()}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
            isPlaying={isPlaying}
            isFullscreen={isFullscreen}
          />
        )}

          {/* Mobile fullscreen: YouTube-style overlay controls + timeline */}
          {mobileFs && (
            <>
              <div
                className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${
                  fsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={e => e.stopPropagation()}
              >
                <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10">
                  {videoUrl && (
                    <Controls
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      duration={duration}
                      onTogglePlay={togglePlay}
                      onStepForward={stepForward}
                      onStepBackward={stepBackward}
                      onRestart={restart}
                      isFullscreen={isFullscreen}
                      onToggleFullscreen={onToggleFullscreen}
                    />
                  )}
                  {videoUrl && (
                    <div className="bg-gray-900/90 px-2 py-0.5">
                      <FramingMode
                        videoRef={videoRef}
                        videoUrl={videoUrl}
                        metadata={metadata}
                        currentTime={currentTime}
                        duration={duration}
                        cropContextValue={cropContextValue}
                        currentCropState={currentCropState}
                        aspectRatio={aspectRatio}
                        cropKeyframes={keyframes}
                        framerate={framerate}
                        selectedCropKeyframeIndex={selectedCropKeyframeIndex}
                        copiedCrop={copiedCrop}
                        onCropChange={onCropChange}
                        onCropComplete={onCropComplete}
                        onCropKeyframeClick={onKeyframeClick}
                        onCropKeyframeDelete={onKeyframeDelete}
                        onCropKeyframeCopy={onCopyCrop}
                        onCropKeyframePaste={onPasteCrop}
                        zoom={zoom}
                        panOffset={panOffset}
                        segments={segments}
                        segmentBoundaries={segmentBoundaries}
                        segmentVisualLayout={segmentVisualLayout}
                        visualDuration={visualDuration || duration}
                        trimRange={trimRange}
                        trimHistory={trimHistory}
                        onAddSegmentBoundary={onAddSegmentBoundary}
                        onRemoveSegmentBoundary={onRemoveSegmentBoundary}
                        onSegmentSpeedChange={onSegmentSpeedChange}
                        onSegmentTrim={onSegmentTrim}
                        onDetrimStart={onDetrimStart}
                        onDetrimEnd={onDetrimEnd}
                        sourceTimeToVisualTime={sourceTimeToVisualTime}
                        visualTimeToSourceTime={visualTimeToSourceTime}
                        selectedLayer={selectedLayer}
                        onLayerSelect={onLayerSelect}
                        onSeek={seek}
                        timelineZoom={timelineZoom}
                        onTimelineZoomByWheel={onTimelineZoomByWheel}
                        timelineScale={getTimelineScale()}
                        timelineScrollPosition={timelineScrollPosition}
                        onTimelineScrollPositionChange={onTimelineScrollPositionChange}
                        isPlaying={isPlaying}
                        isFullscreen={isFullscreen}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div
                className={`absolute top-2 left-2 z-30 transition-opacity duration-300 ${
                  fsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={e => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  icon={isFullscreen ? Minimize : ArrowLeft}
                  iconOnly
                  onClick={isFullscreen ? onToggleFullscreen : () => setEditorMode('project-manager')}
                  title={isFullscreen ? 'Exit fullscreen' : 'Home'}
                  className="bg-black/50 hover:bg-black/70"
                />
              </div>
              <div
                className={`absolute top-2 right-2 z-30 transition-opacity duration-300 ${
                  fsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={e => e.stopPropagation()}
              >
                <Button
                  variant={touchMode === 'crop' ? 'primary' : 'ghost'}
                  size="sm"
                  icon={Crop}
                  iconOnly
                  onClick={() => setTouchMode(touchMode === 'crop' ? 'view' : 'crop')}
                  title={touchMode === 'crop' ? 'Switch to Pan/Zoom mode' : 'Switch to Crop mode'}
                  className={touchMode === 'crop' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-black/50 hover:bg-black/70'}
                />
              </div>
            </>
          )}
        </div>

        {/* Export Button - hidden in fullscreen and on mobile */}
        {videoUrl && !isFullscreen && !mobileFs && (
          <ExportButtonSection
            ref={exportButtonRef}
            videoFile={videoFile}
            cropKeyframes={getFilteredKeyframesForExport}
            segmentData={getSegmentExportData()}
            disabled={!videoUrl}
            includeAudio={includeAudio}
            onIncludeAudioChange={onIncludeAudioChange}
            onProceedToOverlay={onProceedToOverlay}
            clips={hasClips ? clipsWithCurrentState : null}
            globalAspectRatio={globalAspectRatio}
            globalTransition={globalTransition}
            onExportComplete={onExportComplete}
            saveCurrentClipState={saveCurrentClipState}
          />
        )}
      </div>

      {/* No "Getting Started" onboarding here: Framing is always reached with an
          existing game/clips, so the app-level guide is out of context and only
          flashed during the brief clip-load window. */}
    </>
  );
}
