import { forwardRef, useState } from 'react';
import { Minimize, Maximize, Crop, RotateCw } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import AspectRatioSelector from '../components/AspectRatioSelector';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import ExportButtonView from '../components/ExportButtonView';
import { ExportButtonContainer, HIGHLIGHT_EFFECT_LABELS, EXPORT_CONFIG } from '../containers/ExportButtonContainer';
import { Button } from '../components/shared';
import { FocusMode, CropOverlay } from './focus';
import { formatTimeSimple } from '../components/shared/clipConstants';

/**
 * OutputLengthChip - live post-trim/post-speed output duration (T5780).
 *
 * The playback timer intentionally shows source-timeline position, so a 6s clip with
 * 3s of 0.5x slow-mo still reads 0:06 there while it EXPORTS as 0:09. This chip surfaces
 * that output length (what the user gets, and is billed for). Emphasized (blue) only when
 * the output differs from the source length; otherwise a subtle gray so an un-edited clip
 * doesn't shout. Purely presentational — the value is derived upstream, never persisted.
 */
function OutputLengthChip({ seconds, emphasized, label = 'Output', className = '', testId = 'output-length-chip' }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${
        emphasized ? 'bg-blue-500/25 text-blue-200' : 'bg-white/10 text-gray-400'
      } ${className}`}
      title={emphasized
        ? 'Output length after slow-motion / trim — what you export and are billed for'
        : 'Output length (matches source — no speed or trim changes)'}
    >
      {label}: {formatTimeSimple(seconds)}
    </span>
  );
}

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
        estimatedCredits={container.estimatedCredits}
        insufficientForEstimate={container.insufficientForEstimate}
        creditBalance={container.creditBalance}
        sourceFps={container.sourceFps}
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
 * FocusModeView - Complete view for Framing mode
 *
 * This component contains all framing-specific JSX that was previously in App.jsx.
 * It receives state and handlers as props from App.jsx.
 *
 * @see DECOMPOSITION_ANALYSIS.md for refactoring context
 */
export function FocusModeView({
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
  isSourceExpired = false,
  canExtendSource = false,
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
  rotation = 0,
  onSetRotation,
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
  selectedClipEffectiveDuration = null,
  projectEffectiveDuration = null,
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
  // Mobile fullscreen video is opt-in (tap the expand button). Defaulting to it
  // hid the below-timeline controls (export/proceed) with no way to reach them
  // (T4880); the inline scrollable layout keeps every control reachable.
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const mobileFs = isMobile && mobileExpanded;
  // T5641: straighten tool is a niche affordance (~99% of clips never rotate), so
  // the line-drag tool + fine dial are HIDDEN by default behind this toggle.
  // EPHEMERAL view state — local useState, NEVER persisted (no-persisted-view-state
  // rule, precedent T5610 circleEditActive / T5370 spotlightPlayMode). Hiding the
  // controls does NOT clear the rotation: a set angle keeps rotating the video
  // (CropOverlay CSS-rotate + OOB mask stay ungated); only the editing UI toggles.
  const [straightenVisible, setStraightenVisible] = useState(false);

  // T5780: emphasize the selected clip's output chip only when it differs from the
  // source-timeline length the playback timer shows (slow-mo or trim present).
  const sourceLength = duration || clipDuration || 0;
  const outputDiffersFromSource = selectedClipEffectiveDuration != null &&
    Math.abs(selectedClipEffectiveDuration - sourceLength) > 0.05;
  // Project total is redundant with the per-clip chip when there's a single clip.
  const isMultiClip = hasClips && (clipsWithCurrentState?.length || 0) > 1;

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
              {selectedClipEffectiveDuration != null && (
                <>
                  <span className="text-gray-600">•</span>
                  <OutputLengthChip
                    seconds={selectedClipEffectiveDuration}
                    emphasized={outputDiffersFromSource}
                  />
                </>
              )}
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
          <div className="flex mb-3 lg:mb-6 gap-4 items-center">
            {/* Reel-level aspect ratio (T3910): applies to ALL clips, re-fitting their crop.
                Rendered at EVERY width (T7130) — it is the only way to reshape a reel after
                creation, so gating it behind lg: stranded phone users on the default 9:16. */}
            <div className="flex items-center gap-2">
              <AspectRatioSelector
                aspectRatio={globalAspectRatio}
                onAspectRatioChange={onAspectRatioChange}
              />
            </div>
            {/* Precision-pointer tools stay desktop-only: dim, straighten, zoom. */}
            <div className="ml-auto hidden lg:flex items-center gap-2">
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
              <button
                type="button"
                onClick={() => setStraightenVisible((v) => !v)}
                className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  straightenVisible
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                }`}
                aria-pressed={straightenVisible}
                title="Straighten: level tilted footage by dragging along the horizon (or a vertical)"
              >
                <RotateCw size={14} />
                Straighten
              </button>
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
                    rotation={rotation}
                    onSetRotation={onSetRotation}
                    straightenVisible={straightenVisible}
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
              isSourceExpired={isSourceExpired}
              canExtendSource={canExtendSource}
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

            {/* Mobile expand — opt into fullscreen video (inline layout keeps
                the timeline + export controls reachable below) */}
            {isMobile && !mobileFs && videoUrl && (
              <button
                onClick={() => setMobileExpanded(true)}
                className="absolute top-2 right-2 z-10 p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-black/50 text-white hover:bg-black/70"
                title="Fullscreen video"
                aria-label="Expand video to fullscreen"
              >
                <Maximize size={18} />
              </button>
            )}
          </div>

          {/* Mobile-only clip title — minimal, under video */}
          {clipTitle && !isFullscreen && !mobileFs && (
            <div className="lg:hidden flex items-center justify-between gap-2 px-2 py-0.5 text-sm text-gray-300">
              <div className="truncate min-w-0">
                <span className="font-medium text-white">{clipTitle}</span>
                {clipGameName && <span className="text-gray-500"> · {clipGameName}</span>}
              </div>
              {/* T5780: output length. The reel aspect ratio is NOT repeated here — it
                  lives in the controls bar above the video at every width (T7130). */}
              {selectedClipEffectiveDuration != null && (
                <div className="shrink-0">
                  <OutputLengthChip
                    seconds={selectedClipEffectiveDuration}
                    emphasized={outputDiffersFromSource}
                  />
                </div>
              )}
            </div>
          )}

          {/* Timeline - desktop fullscreen & non-fullscreen */}
          {!mobileFs && videoUrl && (
          <FocusMode
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
                      <FocusMode
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
                  icon={Minimize}
                  iconOnly
                  onClick={isFullscreen ? onToggleFullscreen : () => setMobileExpanded(false)}
                  title="Exit fullscreen"
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

        {/* T5780: live project output total (multi-clip) — the billable output length
            T5790 turns into a credit estimate. Hidden for a single clip (redundant with
            the per-clip chip) and when unknown (fail-closed, no fabricated number). */}
        {videoUrl && !isFullscreen && !mobileFs && isMultiClip && projectEffectiveDuration != null && (
          <div className="mt-4 sm:mt-6 -mb-2 flex items-center justify-end gap-2 text-sm text-gray-300">
            <span className="text-gray-400">Total output</span>
            <OutputLengthChip
              seconds={projectEffectiveDuration}
              emphasized
              label="Total"
              testId="project-output-length-chip"
            />
          </div>
        )}

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
