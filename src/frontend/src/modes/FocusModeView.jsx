import { forwardRef, useState } from 'react';
import { Minimize, Maximize, Crop, Sliders, Film, ChevronLeft } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import ExportButtonView from '../components/ExportButtonView';
import { ExportButtonContainer, HIGHLIGHT_EFFECT_LABELS } from '../containers/ExportButtonContainer';
import { Button } from '../components/shared';
import SettingsRail from '../components/settings/SettingsRail';
import FocusSettingsPanel from '../components/settings/FocusSettingsPanel';
import FocusClipsPanel from '../components/settings/FocusClipsPanel';
import { FocusMode, CropOverlay } from './focus';
import FramingInstructions from './focus/FramingInstructions';
import { formatLength, PRECISION } from '../utils/timeFormat';
import { ratioWithName } from '../constants/aspectRatios';

/**
 * OutputLengthChip - live post-trim/post-speed output duration (T5780).
 *
 * The playback timer intentionally shows source-timeline position, so a 6s clip with
 * 3s of 0.5x slow-mo still reads 0:06 there while it EXPORTS as 0:09. This chip surfaces
 * that output length (what the user gets, and is billed for). Emphasized (blue) only when
 * the output differs from the source length; otherwise a subtle gray so an un-edited clip
 * doesn't shout. Purely presentational — the value is derived upstream, never persisted.
 *
 * T9480 review fix (BLOCKING #2): this is a LENGTH on the exact billing-adjacent
 * surface (the tooltip literally says "what you export and are billed for"), so it
 * ROUNDS half-up via formatLength, not formatInstant's floor -- identical by
 * construction to roundCreditsHalfUp (a 6.6s output now reads "0:07", matching the
 * 7 credits charged, not the floored "0:06" that reproduced the original complaint).
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
      {label}: {formatLength(seconds, PRECISION.SECOND, { style: 'clock' })}
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

  // View: pure presentation.
  // T9270: this is now the full-width ActionBand (ExportButtonView renders it). It
  // is the same component at every width — the T8790 mobile-only sticky reset is
  // gone; the band is the last flex:none child of each view's flex-col shell.
  return (
      <ExportButtonView
        ref={ref}
        isCurrentlyExporting={container.isCurrentlyExporting}
        isExporting={container.isExporting}
        isExternallyExporting={false}
        displayProgress={container.displayProgress}
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
        isHighlightEnabled={false}
        highlightEffectType={null}
        onExport={container.handleExport}
        onRetryConnection={container.handleRetryConnection}
        onDismissExport={container.handleDismissExport}
        onHighlightEffectTypeChange={null}
        HIGHLIGHT_EFFECT_LABELS={HIGHLIGHT_EFFECT_LABELS}
        showInsufficientCredits={container.showInsufficientCredits}
        onCloseInsufficientCredits={container.onCloseInsufficientCredits}
        estimatedCredits={container.estimatedCredits}
        estimatedSeconds={container.estimatedSeconds}
        insufficientForEstimate={container.insufficientForEstimate}
        creditBalance={container.creditBalance}
        sourceFps={container.sourceFps}
        showBuyCredits={container.showBuyCredits}
        onCloseBuyCredits={container.onCloseBuyCredits}
        onPaymentSuccess={container.onPaymentSuccess}
        handleExportRef={container.handleExportRef}
      />
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

  // T9270: ephemeral settings-rail view state. NEVER persisted (no-persisted-view-state
  // rule; precedent T5641 straightenVisible above, T5610 circleEditActive). Desktop
  // rail defaults EXPANDED; the mobile drawer defaults CLOSED. Its tab defaults to
  // Settings. No useEffect writes these — gesture handlers only.
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railTab, setRailTab] = useState('settings');

  // T9610: the three-step framing guide's expand/collapse. Focus points a parent
  // places are 'user'-origin keyframes; 'trim'-origin ones are trim-boundary residue,
  // not a placed point. Default: expanded until the first framing success (two focus
  // points), then collapsed to the preview prompt. EPHEMERAL view state — a gesture
  // override on top of the derived default, NEVER a useEffect that syncs to it
  // (no-persisted-view-state rule, precedent T5641 straightenVisible).
  const focusPointCount = (keyframes || []).filter((k) => k?.origin !== 'trim').length;
  const [guideOverride, setGuideOverride] = useState(null);
  const guideExpanded = guideOverride ?? focusPointCount < 2;

  // T9270: the Focus settings-rail tabs (Clips | Settings) and their bodies. The
  // Settings tab re-homes the old above-video toolbar (aspect, audio, straighten,
  // background dim, zoom) into Reel / This clip / View-only groups. `desktopOnly`
  // keeps dim/zoom + the straighten line-drag tool out of the mobile drawer (Step 4),
  // exactly as the old toolbar gated them.
  const focusRailTabs = [
    { id: 'clips', label: 'Clips', icon: Film },
    { id: 'settings', label: 'Settings', icon: Sliders },
  ];
  const renderFocusSettings = (desktopOnly) => (
    <FocusSettingsPanel
      globalAspectRatio={globalAspectRatio}
      onAspectRatioChange={onAspectRatioChange}
      includeAudio={includeAudio}
      onIncludeAudioChange={onIncludeAudioChange}
      straightenVisible={straightenVisible}
      onToggleStraighten={() => setStraightenVisible((v) => !v)}
      dimOpacity={dimOpacity}
      onToggleDim={() => setDimOpacity(dimOpacity === 0.2 ? 0.7 : 0.2)}
      zoom={zoom}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onResetZoom={onResetZoom}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      desktopOnly={desktopOnly}
    />
  );
  const focusRailBody = (desktopOnly) => (railTab === 'clips'
    ? <FocusClipsPanel clips={hasClips ? clipsWithCurrentState : null} />
    : renderFocusSettings(desktopOnly));

  // T9270: the mobile entry row's live-summary second line. DERIVED from the same
  // state the rows bind to — never a second stored copy. Straighten reads "Level"
  // when no angle is set, else "Straightened".
  const aspectSummary = ratioWithName(globalAspectRatio);
  const mobileSettingsSummary =
    `${aspectSummary} - Audio ${includeAudio ? 'on' : 'off'} - ${rotation ? 'Straightened' : 'Level'}`;

  // T5780: emphasize the selected clip's output chip only when it differs from the
  // source-timeline length the playback timer shows (slow-mo or trim present).
  const sourceLength = duration || clipDuration || 0;
  const outputDiffersFromSource = selectedClipEffectiveDuration != null &&
    Math.abs(selectedClipEffectiveDuration - sourceLength) > 0.05;
  // Project total is redundant with the per-clip chip when there's a single clip.
  const isMultiClip = hasClips && (clipsWithCurrentState?.length || 0) > 1;

  return (
    <div className="flex flex-col min-h-0">
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
                {/* T9480 review fix: the clip's source duration is a LENGTH -- rounds, not floors. */}
                <span>{formatLength(duration || clipDuration, PRECISION.SECOND, { style: 'clock' })}</span>
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
        {/* T9270: the old above-video controls toolbar (aspect, audio, background
            dim, straighten, zoom) is re-homed into the settings rail's Settings tab
            (Reel / This clip / View-only groups). The stage row below carries the
            rail on desktop; the mobile drawer (Step 4) carries the mobile-safe subset. */}

        {/* T9270: desktop stage row — the editor column (video + timeline) beside the
            settings rail. In fullscreen / mobileFs the container escapes via fixed
            positioning so the row collapses to just the (gated-off) rail. */}
        <div className="lg:flex lg:flex-row lg:items-start">
        <div className="flex flex-col w-full lg:flex-1 lg:min-w-0 lg:pr-6">
        {/* T9610: the three-step framing guide — the first thing a first-time parent
            sees in the editor column, teaching the frame → step → adjust sequence and
            prompting a play-to-preview before a paid render. Non-fullscreen only. */}
        {videoUrl && !isFullscreen && !mobileFs && (
          <div className="mb-3">
            <FramingInstructions
              focusPointCount={focusPointCount}
              expanded={guideExpanded}
              onToggle={() => setGuideOverride(!guideExpanded)}
            />
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
        </div>
        {/* T9270: the unified settings rail — desktop (fine pointer) only, beside the
            editor column. Focus tabs = Clips | Settings; collapses to a 64px icon
            strip. On mobile the SAME rail renders as the translateX drawer below. */}
        {videoUrl && !isFullscreen && !mobileFs && !isMobile && (
          <SettingsRail
            isMobile={false}
            collapsed={railCollapsed}
            onToggleCollapse={() => setRailCollapsed((v) => !v)}
            tabs={focusRailTabs}
            activeTab={railTab}
            onTabChange={setRailTab}
            title="Settings"
          >
            {focusRailBody(true)}
          </SettingsRail>
        )}
        {/* T9270: mobile settings drawer — the SAME SettingsRail in translateX mode,
            opened by the mobile-settings-row below. Positioned absolute inside this
            relatively-positioned stage row so it never alters the stage box. Holds
            the mobile-safe subset (Reel + This clip via desktopOnly=false; no dim/zoom
            or straighten line-drag tool). */}
        {videoUrl && !isFullscreen && !mobileFs && isMobile && (
          <SettingsRail
            isMobile
            open={drawerOpen}
            onCloseDrawer={() => setDrawerOpen(false)}
            tabs={focusRailTabs}
            activeTab={railTab}
            onTabChange={setRailTab}
            title="Settings"
          >
            {focusRailBody(false)}
          </SettingsRail>
        )}
        </div>

        {/* T9270: mobile settings entry row — a 64px full-width labelled button that
            opens the drawer, with a derived live-summary second line. Hidden in mobile
            fullscreen (as the toolbar was). Desktop uses the in-flow rail instead. */}
        {videoUrl && !isFullscreen && !mobileFs && isMobile && (
          <button
            type="button"
            data-testid="mobile-settings-row"
            onClick={() => setDrawerOpen(true)}
            className="mt-4 w-full h-16 flex items-center gap-3 rounded-[10px] px-3.5 text-left"
            style={{ border: '1px solid #334155', background: '#0f172a' }}
            aria-label="Open settings"
          >
            <Sliders size={20} className="shrink-0 text-gray-300" aria-hidden="true" />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold text-gray-100">Settings</span>
              <span data-testid="mobile-settings-summary" className="text-xs text-gray-400 truncate">
                {mobileSettingsSummary}
              </span>
            </span>
            <ChevronLeft size={18} className="shrink-0 text-gray-500" aria-hidden="true" />
          </button>
        )}

      </div>

      {/* No "Getting Started" onboarding here: Framing is always reached with an
          existing game/clips, so the app-level guide is out of context and only
          flashed during the brief clip-load window. */}

      {/* T9270: the action band is the last flex:none child of the shell, spanning
          the full width under the editor column and the settings rail. Hidden in
          fullscreen / mobile fullscreen. `sticky bottom-0` pins it to the viewport
          bottom against App's `flex-1 overflow-auto` scroll container so the CTA
          paints above the fold at every width (generalizes T8790's mobile-only
          sticky bar; the band's own solid bg + top-shadow read cleanly over the
          content that scrolls behind it). */}
      {videoUrl && !isFullscreen && !mobileFs && (
        <div className="sticky bottom-0 z-30 mt-4 sm:mt-6 -mx-3 sm:-mx-6">
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
        </div>
      )}
    </div>
  );
}
