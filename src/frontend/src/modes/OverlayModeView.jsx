import { forwardRef, useState, useEffect, useCallback, useMemo } from 'react';
import { VideoPlayer } from '../components/VideoPlayer';
import { computeSpotlightReveal } from '../utils/spotlightReveal';
import OverrideHint from './overlay/overlays/OverrideHint';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import ExportButtonView from '../components/ExportButtonView';
import { ExportButtonContainer, HIGHLIGHT_EFFECT_LABELS, EXPORT_CONFIG } from '../containers/ExportButtonContainer';
import { Button } from '../components/shared';
import { OverlayMode, HighlightOverlay, PlayerDetectionOverlay } from './overlay';
import { Minimize, Maximize, RotateCcw } from 'lucide-react';
import { formatTimeSimple } from '../components/shared/clipConstants';

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
  highlightColor,
  onHighlightColorChange,
  highlightShape,
  onHighlightShapeChange,
  strokeWidth,
  fillEnabled,
  fillOpacity,
  dimStrength,
  onStrokeWidthChange,
  onFillEnabledChange,
  onFillOpacityChange,
  onDimStrengthChange,
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
        isHighlightEnabled={highlightRegions.length > 0}
        highlightEffectType={highlightEffectType}
        highlightColor={highlightColor}
        onExport={container.handleExport}
        onRetryConnection={container.handleRetryConnection}
        onDismissExport={container.handleDismissExport}
        onAudioToggle={container.handleAudioToggle}
        onHighlightEffectTypeChange={onHighlightEffectTypeChange}
        onHighlightColorChange={onHighlightColorChange}
        highlightShape={highlightShape}
        onHighlightShapeChange={onHighlightShapeChange}
        strokeWidth={strokeWidth}
        fillEnabled={fillEnabled}
        fillOpacity={fillOpacity}
        dimStrength={dimStrength}
        onStrokeWidthChange={onStrokeWidthChange}
        onFillEnabledChange={onFillEnabledChange}
        onFillOpacityChange={onFillOpacityChange}
        onDimStrengthChange={onDimStrengthChange}
        HIGHLIGHT_EFFECT_LABELS={HIGHLIGHT_EFFECT_LABELS}
        EXPORT_CONFIG={EXPORT_CONFIG}
        showInsufficientCredits={null}
        onCloseInsufficientCredits={null}
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

  // Spotlight loop playback (T5370)
  spotlightSpan,
  spotlightPlayMode,
  isPastSpotlight,
  onPlaySpotlight,
  onPlayFull,
  onReturnToSpotlight,

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
  highlightColor,
  onHighlightColorChange,

  // Overlay tuning settings
  highlightShape = 'body',
  strokeWidth = 3,
  fillEnabled = false,
  fillOpacity = 0.10,
  dimStrength = 0.15,
  onHighlightShapeChange,
  onStrokeWidthChange,
  onFillEnabledChange,
  onFillOpacityChange,
  onDimStrengthChange,

  // Player detection (auto-detected during framing export)
  playerDetectionEnabled,
  playerDetections,
  detectionVideoWidth,
  detectionVideoHeight,
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
  // T740: Outdated framing warning
  framingOutdated = false,
}) {
  // Show "export required" message if no overlay video but framing has edits
  const showExportRequired = !effectiveOverlayVideoUrl && framingVideoUrl && (hasFramingEdits || hasMultipleClips);
  const isMobile = useIsMobile();
  const fsControls = useFullscreenControls({ isPlaying });
  // Mobile fullscreen video is opt-in (tap the expand button). Defaulting to it
  // hid the overlay settings + Add Spotlight/export controls with no way to reach
  // them (T4880); the inline scrollable layout keeps every control reachable.
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const mobileFs = isMobile && mobileExpanded;

  // T5610: ephemeral "tap the spotlight to edit" state. NEVER persisted — it is an editing
  // affordance, not reel data (no store write, no reactive persistence). A tap inside the
  // circle toggles it; it lets the user fine-tune the circle WITHOUT turning the whole
  // tracking layer off (tracking boxes stay visible underneath).
  const [circleEditActive, setCircleEditActive] = useState(false);
  // One-time teach: once the user has used EITHER override (tapped the circle, or hidden
  // tracking) the discoverability hint is done for the session. View state, not reel data.
  const [overrideUsed, setOverrideUsed] = useState(false);

  // T5450 + T5610: the spotlight circle's edit levers are gated on the player-tracking
  // layer OR the tap-the-circle override. Player boxes OFF (T5570 power-user path) =>
  // editable. Player boxes ON but the user tapped the circle => also editable, tracking
  // boxes still visible. Player boxes ON and not tapped => display-only, video tap-nav is
  // normal. The tap-nav wrapper below YIELDS while editable (either path) so a move/resize
  // drag is never stolen by play/seek — the T5570 drag-guard, only widened by what turns
  // `editable` on.
  const editable = !showPlayerBoxes || circleEditActive;

  // Is the spotlight circle visible right now (a region exists at the current time and it
  // renders)? Mirrors HighlightOverlay's own render gate.
  const hasVisibleSpotlight = !!currentHighlightState && isTimeInEnabledRegion(currentTime);

  // T5250: the entrance/exit reveal envelope for the spotlight, derived from the ACTIVE
  // region's [startTime, endTime] and currentTime via the shared spec (mirrored on the
  // backend render path). Passed to HighlightOverlay as a display-only multiplier — it
  // touches no keyframe data. Null when no region covers the playhead (overlay hidden).
  // Standard behavior — always applied (no setting), so preview matches the export.
  const spotlightReveal = useMemo(() => {
    if (!highlightRegions?.length) return null;
    const region = highlightRegions.find(
      (r) => r.enabled !== false && currentTime >= r.startTime && currentTime <= r.endTime
    );
    if (!region) return null;
    return computeSpotlightReveal(currentTime, region.startTime, region.endTime);
  }, [highlightRegions, currentTime]);

  // The hint teaches manual override: shown only while tracking is ON, a spotlight is
  // visible, the user hasn't overridden yet this session, AND no tracking/spotlight
  // keyframe is currently selected (T5643) — `selectedHighlightKeyframeIndex` enlarges/
  // activates a keyframe by playhead proximity (OverlayScreen.jsx), and the hint would be
  // redundant (and visually competing) with that keyframe's own edit affordance. `null` =
  // nothing selected; index 0 is a valid selection, so check strictly against `null`.
  const showOverrideHint = hasVisibleSpotlight && showPlayerBoxes && !overrideUsed
    && selectedHighlightKeyframeIndex === null;
  const overrideHintText = isMobile
    ? 'Tap the spotlight to adjust'
    : 'Tap the spotlight to adjust it — or hide tracking to edit freely';

  // A tap inside the circle toggles manual-override edit (enter/exit). Wired to the
  // overlay ONLY while tracking is on — with tracking off the circle is already fully
  // editable and the tap-toggle would be meaningless.
  const handleCircleTap = useCallback(() => {
    setCircleEditActive((v) => !v);
  }, []);

  // Mark the hint as learned on the FIRST use of either override path (tap-the-circle OR
  // toggle tracking off). Ephemeral view-state update — not persistence.
  useEffect(() => {
    if (circleEditActive || !showPlayerBoxes) setOverrideUsed(true);
  }, [circleEditActive, showPlayerBoxes]);

  // Exit circle-edit so a stray edit state never lingers: when playback starts, or when
  // the spotlight is no longer visible (seeked out of / across regions). These reset
  // ephemeral view state only — no store/backend write.
  useEffect(() => {
    if (isPlaying) setCircleEditActive(false);
  }, [isPlaying]);
  useEffect(() => {
    if (!hasVisibleSpotlight) setCircleEditActive(false);
  }, [hasVisibleSpotlight]);

  // Tap on the video area (mobile fullscreen tap-nav). A tap OUTSIDE the circle exits
  // circle-edit (the circle's own tap is stopped at the overlay). Otherwise normal
  // tap-nav, but only when NOT editable so a circle drag is never stolen.
  const handleVideoAreaTap = useCallback(() => {
    if (circleEditActive) { setCircleEditActive(false); return; }
    if (!editable) togglePlay();
  }, [circleEditActive, editable, togglePlay]);

  // T5370: spotlight-loop Controls wiring. Primary Play = "Play spotlight" (loops);
  // secondary = de-emphasized "Play full". With zero regions (spotlightSpan null) the
  // primary is plain Play/Pause (onPlaySpotlight falls back to a plain toggle) and no
  // secondary button renders. Shared across both Controls instances (desktop + mobile).
  const spotlightControlsProps = {
    onTogglePlay: onPlaySpotlight || togglePlay,
    isLooping: spotlightPlayMode === 'loop' && !!spotlightSpan,
    secondaryPlay: spotlightSpan
      ? { onClick: onPlayFull, title: 'Play full clip', active: spotlightPlayMode === 'full' }
      : undefined,
  };

  // "Reset" pill — shown over the lower video area once the playhead runs past the
  // spotlight span. Seeks to time 0 (T5658: spotlight location isn't guaranteed, so
  // resetting to the start is the dependable behavior). Mirrors the mobile-expand
  // button styling; >=44px touch target (min-h-11) via T5360's conventions.
  const resetPill = isPastSpotlight ? (
    <button
      onClick={(e) => { e.stopPropagation(); onReturnToSpotlight?.(); }}
      className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 px-4 min-h-11 flex items-center justify-center gap-1.5 rounded-full bg-purple-600/90 text-white text-sm font-medium shadow-lg hover:bg-purple-500"
      title="Reset to the start"
      aria-label="Reset"
    >
      <RotateCcw size={16} aria-hidden="true" /> Reset
    </button>
  ) : null;

  return (
    <>
      {/* T740: Outdated framing banner */}
      {framingOutdated && !isFullscreen && (
        <div className="mb-3 flex items-center justify-between gap-3 bg-amber-900/40 border border-amber-500/30 rounded-lg px-4 py-2.5">
          <p className="text-amber-200 text-sm">
            Clip boundaries changed since this video was framed. Overlay edits will apply to the old framing.
          </p>
          <button
            onClick={onSwitchToFraming}
            className="flex-shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-medium transition-colors"
          >
            Re-frame now
          </button>
        </div>
      )}
      {/* Video Metadata - use overlay metadata, hidden in fullscreen, hidden below lg on mobile */}
      {!isFullscreen && (effectiveOverlayMetadata ? (
        <div className="hidden lg:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-3 lg:p-4 border border-white/20">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1 lg:gap-0 text-sm text-gray-300">
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
              {(duration > 0 || effectiveOverlayMetadata.duration > 0) && (
                <>
                  <span className="text-gray-600">•</span>
                  <span>{formatTimeSimple(duration || effectiveOverlayMetadata.duration)}</span>
                </>
              )}
              {effectiveOverlayMetadata.framerate && (
                <>
                  <span className="text-gray-600">•</span>
                  <span>{Math.round(effectiveOverlayMetadata.framerate)} fps</span>
                </>
              )}
            </div>
          </div>
        </div>
      ) : isLoading && (
        <div className="hidden lg:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20 animate-pulse">
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
      <div className={`${(isFullscreen || mobileFs) ? '' : 'bg-white/10 backdrop-blur-lg rounded-lg p-3 sm:p-6 border border-white/20'}`}>
        {/* Controls Bar - hidden in fullscreen and on mobile */}
        {effectiveOverlayVideoUrl && !isFullscreen && !mobileFs && (
          <div className="hidden lg:flex mb-3 lg:mb-6 gap-4 items-center">
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
          className={`${(isFullscreen || mobileFs) ? `fixed inset-0 z-[100] bg-gray-900${mobileFs ? '' : ' flex flex-col'}` : ''}`}
          onMouseMove={mobileFs ? fsControls.handleInteraction : undefined}
        >
          {/* Video Player with overlay-specific overlays */}
          <div
            className={`relative bg-gray-900 ${
              (isFullscreen || mobileFs)
                ? mobileFs ? 'w-full h-full' : 'flex-1 min-h-0'
                : 'rounded-lg'
            }`}
            // While the circle is editable (tracking OFF or tap-the-circle override) the
            // tap-nav owner YIELDS: no play toggle, no long-press speed control — so a
            // move/resize drag can't be stolen (T5450/T5610). Pointer stopPropagation
            // can't cancel these TOUCH handlers, so they must be gated on `editable`. The
            // onClick handles a plain tap: it exits circle-edit when tapping OUTSIDE the
            // circle (the circle's own tap is stopped at the overlay), else normal tap-nav.
            onClick={mobileFs ? handleVideoAreaTap : undefined}
            onTouchStart={mobileFs && !editable ? fsControls.handleLongPressTouchStart : undefined}
            onTouchMove={mobileFs && !editable ? fsControls.handleLongPressTouchMove : undefined}
            onTouchEnd={mobileFs && !editable ? fsControls.handleLongPressTouchEnd : undefined}
          >
            <VideoPlayer
            videoRef={videoRef}
            videoUrl={effectiveOverlayVideoUrl}
            handlers={handlers}
            overlays={[
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
                  highlightShape={highlightShape}
                  strokeWidth={strokeWidth}
                  fillEnabled={fillEnabled}
                  fillOpacity={fillOpacity}
                  dimStrength={dimStrength}
                  zoom={zoom}
                  panOffset={panOffset}
                  isFullscreen={isFullscreen}
                  editable={editable}
                  // Tap-the-circle override is wired only while tracking is ON; with
                  // tracking OFF the circle is already fully editable (T5570 path).
                  onCircleTap={showPlayerBoxes ? handleCircleTap : undefined}
                  // T5250: entrance/exit reveal envelope (display-only multiplier).
                  reveal={spotlightReveal}
                />
              ),
              effectiveOverlayMetadata && playerDetectionEnabled && playerDetections?.length > 0 && (
                <PlayerDetectionOverlay
                  key="player-detection"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  detections={playerDetections}
                  detectionVideoWidth={detectionVideoWidth}
                  detectionVideoHeight={detectionVideoHeight}
                  isLoading={isDetectionLoading}
                  onPlayerSelect={onPlayerSelect}
                  zoom={zoom}
                  panOffset={panOffset}
                  isFullscreen={isFullscreen}
                  isDisabled={!showPlayerBoxes}
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

            {/* Fullscreen exit button - desktop only */}
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

            {/* Reset pill — over the lower video area (T5370, relabeled T5658) */}
            {resetPill}

            {/* T5610 discoverability hint — subtle pill, non-interactive, below the
                handles. Names BOTH override paths; fades on first override. T5643: sits
                directly under the "N players detected" badge (PlayerDetectionOverlay's
                top-4 right-4 count, same top-right corner of this relatively-positioned
                video area) and hides while a tracking/spotlight keyframe is selected. */}
            {effectiveOverlayVideoUrl && (
              <OverrideHint visible={showOverrideHint} text={overrideHintText} />
            )}

            {/* Controls - desktop fullscreen & non-fullscreen */}
            {!mobileFs && effectiveOverlayVideoUrl && (
              <Controls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={effectiveOverlayMetadata?.duration || duration}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
                {...spotlightControlsProps}
              />
            )}

            {/* Mobile expand — opt into fullscreen video (inline layout keeps
                the overlay settings + Add Spotlight/export controls reachable below) */}
            {isMobile && !mobileFs && effectiveOverlayVideoUrl && (
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
          {videoTitle && !isFullscreen && !mobileFs && (
            <div className="lg:hidden px-2 py-1 text-sm text-gray-300 truncate">
              <span className="font-medium text-white">{videoTitle}</span>
            </div>
          )}

          {/* Timeline - desktop fullscreen & non-fullscreen */}
          {!mobileFs && (
          <div className={`${isFullscreen ? 'bg-gray-900/95 border-t border-gray-700 px-2 lg:px-4 py-0.5' : 'mt-6'}`}>
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
                  {effectiveOverlayVideoUrl && (
                    <Controls
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      duration={effectiveOverlayMetadata?.duration || duration}
                      onStepForward={stepForward}
                      onStepBackward={stepBackward}
                      onRestart={restart}
                      isFullscreen={isFullscreen}
                      onToggleFullscreen={onToggleFullscreen}
                      {...spotlightControlsProps}
                    />
                  )}
                  {effectiveOverlayVideoUrl && (
                    <div className="bg-gray-900/90 px-2 py-0.5">
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
            </>
          )}
        </div>

        {/* Export Required Message - hidden in fullscreen and on mobile */}
        {showExportRequired && !isFullscreen && !mobileFs && (
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

        {/* Export Button - hidden in fullscreen and on mobile */}
        {effectiveOverlayVideoUrl && !isFullscreen && !mobileFs && (
          <OverlayExportButtonSection
            ref={exportButtonRef}
            videoFile={effectiveOverlayFile}
            videoUrl={effectiveOverlayVideoUrl}
            highlightRegions={getRegionsForExport()}
            highlightEffectType={highlightEffectType}
            onHighlightEffectTypeChange={onHighlightEffectTypeChange}
            highlightColor={highlightColor}
            onHighlightColorChange={onHighlightColorChange}
            highlightShape={highlightShape}
            onHighlightShapeChange={onHighlightShapeChange}
            strokeWidth={strokeWidth}
            fillEnabled={fillEnabled}
            fillOpacity={fillOpacity}
            dimStrength={dimStrength}
            onStrokeWidthChange={onStrokeWidthChange}
            onFillEnabledChange={onFillEnabledChange}
            onFillOpacityChange={onFillOpacityChange}
            onDimStrengthChange={onDimStrengthChange}
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
