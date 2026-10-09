import FloatingCoach from '../components/instructions/FloatingCoach';
import { useGuidanceSettings } from '../stores/settingsStore';
import { forwardRef, useState, useMemo, useCallback } from 'react';
import { Minimize, Maximize, Crop, Sliders, ChevronLeft, ChevronDown } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import useVideoDisplayRect from '../hooks/useVideoDisplayRect';
import { computeOutputPreviewTransform } from '../utils/outputPreviewTransform';
import ExportButtonView from '../components/ExportButtonView';
import { ExportButtonContainer, HIGHLIGHT_EFFECT_LABELS } from '../containers/ExportButtonContainer';
import { Button } from '../components/shared';
import SettingsRail from '../components/settings/SettingsRail';
import FocusSettingsPanel from '../components/settings/FocusSettingsPanel';
import { CropOverlay } from './focus';
import { FocusTimelineBlock } from './focus/FocusTimelineBlock';
import RotateNudge from './focus/RotateNudge';
import FocusCockpit from './focus/cockpit/FocusCockpit';
import FramingGuide from './focus/FramingGuide';
import FramingActionRow from './focus/FramingActionRow';
import { formatLength, PRECISION } from '../utils/timeFormat';
import { ratioWithName } from '../constants/aspectRatios';
import { FRAMING_GUIDE } from '../components/instructions/catalog';

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
 * surface (the tooltip literally says "what you generate and are billed for"), so it
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
        ? 'Output length after slow-motion / trim -- what you generate and are billed for'
        : 'Output length (matches source -- no speed or trim changes)'}
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
  // Guided framing steps not finished: explain the lock in the button tooltip.
  guideLocked = false,
  pulseGenerate = false,
  includeAudio,
  onIncludeAudioChange,
  onProceedToOverlay,
  clips,
  globalAspectRatio,
  onExportComplete,
  saveCurrentClipState,
  // T10650: Focus "Back to Preview" — derived + owned by FocusScreen, threaded
  // straight to the presentational ExportButtonView (ExportButtonContainer is
  // untouched: this is not an export).
  framingCtaMode,
  showBackToPreview,
  onBackToPreview,
  renderedAt,
  backToPreviewLoading,
  actionsAbove,
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
        framingCtaMode={framingCtaMode}
        showBackToPreview={showBackToPreview}
        onBackToPreview={onBackToPreview}
        renderedAt={renderedAt}
        backToPreviewLoading={backToPreviewLoading}
        actionsAbove={actionsAbove}
        pulseGenerate={pulseGenerate}
        isButtonDisabled={container.isButtonDisabled}
        buttonTitle={container.buttonTitle ?? (guideLocked ? FRAMING_GUIDE.LOCKED_TITLE : undefined)}
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

// T9950 Slice 3 fix (P0 2026-09-15): useVideoDisplayRect's effect deps include
// `panOffset` by reference (see useVideoDisplayRect.js's own test comment: "a
// fresh object each render would re-trigger forever"). The preview transform
// call below always passes zoom=1/pan={0,0} — a module-level constant keeps
// that reference stable across renders instead of a `{ x: 0, y: 0 }` literal
// re-created inline every render, which re-fired the layout effect's setRect
// on every single render and crashed Focus mode with "Maximum update depth
// exceeded" for every draft, not just while previewing.
const PREVIEW_ZERO_PAN = { x: 0, y: 0 };

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
  onKeyframeTimeMove,
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
  timelineZoomControls, // T10930: {zoomIn, zoomOut, resetZoom} -> TimelineZoomChip
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
  globalAspectRatio,
  onAspectRatioChange,

  // Export
  exportButtonRef,
  getFilteredKeyframesForExport,
  getSegmentExportData,
  includeAudio,
  onIncludeAudioChange,
  onProceedToOverlay,
  onExportComplete,
  saveCurrentClipState,  // For backend-authoritative export

  // T10650: Focus "Back to Preview" CTA state (derived in FocusScreen)
  framingCtaMode,
  showBackToPreview,
  onBackToPreview,
  renderedAt,
  backToPreviewLoading,

  // Context
  cropContextValue,

  // T10840: landscape cockpit — the derivation is computed once in FocusScreen
  // (useIsCockpit) and passed down so there is a single source of truth.
  cockpit = false,
  onExitToHome,
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
  // rule, precedent T5610 circleEditActive / T5370 spotlightPlayMode).
  //
  // 2026-09-18 (user request) supersedes T5641's "hiding does not clear the
  // rotation" -- toggling straighten OFF now also resets the angle to 0
  // (video back to its original orientation), via handleToggleStraighten
  // below. Safe now that rotation changes never touch stored crop keyframes
  // (the T5640 data-loss fix, same day) -- resetting to 0 is a plain angle
  // change like any other, not a destructive re-clamp.
  const [straightenVisible, setStraightenVisible] = useState(false);
  const handleToggleStraighten = useCallback(() => {
    setStraightenVisible((v) => {
      const next = !v;
      if (!next) onSetRotation?.(0);
      return next;
    });
  }, [onSetRotation]);

  // T9270: ephemeral settings-rail view state. NEVER persisted (no-persisted-view-state
  // rule; precedent T5641 straightenVisible above, T5610 circleEditActive). Desktop
  // rail defaults EXPANDED; the mobile drawer defaults CLOSED. Its tab defaults to
  // Settings. No useEffect writes these — gesture handlers only.
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railTab, setRailTab] = useState('settings');

  // Guided framing steps (one instruction at a time). Focus points a parent places
  // are 'user'-origin keyframes; 'trim'-origin ones are trim-boundary residue.
  // EPHEMERAL view state, never persisted, never a useEffect: step 1 completes on
  // a box drag release (or a clip that already has a focus point), step 2 on the
  // first time playback is observed.
  const { coachEnabled = true } = useGuidanceSettings();
  const focusPointCount = (keyframes || []).filter((k) => k?.origin !== 'trim').length;
  const [hasDragged, setHasDragged] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  // Derived-state-in-render (React-sanctioned): any play path (button, spacebar,
  // tapping the video) flips isPlaying, so observe that rather than one handler.
  if (isPlaying && !hasPlayed) setHasPlayed(true);
  const dragDone = hasDragged || focusPointCount > 0;
  const stepsComplete = dragDone && hasPlayed;
  // Step 3 -> 4: once the first play has started, reaching the clip end while
  // playing counts as one full play-through (playback loops, so the time wraps
  // right after). Derived-in-render like hasPlayed; never a useEffect, never
  // persisted. Preview playback has its own completion state below.
  const [hasPlayedThrough, setHasPlayedThrough] = useState(false);
  const guideLength = duration || clipDuration || 0;
  if (stepsComplete && isPlaying && !hasPlayedThrough && guideLength > 0 && currentTime >= guideLength - 0.25) {
    setHasPlayedThrough(true);
  }
  const [previewing, setPreviewing] = useState(false);
  const [previewPlaybackStarted, setPreviewPlaybackStarted] = useState(false);
  const [hasPreviewPlayedThrough, setHasPreviewPlayedThrough] = useState(false);
  const previewEnd = trimRange?.end ?? guideLength;
  const previewStart = trimRange?.start ?? 0;
  const previewEndTolerance = Math.min(0.25, (previewEnd - previewStart) / 2);
  if (previewing && !mobileFs && !isFullscreen && isPlaying && !hasPreviewPlayedThrough && previewEnd > previewStart) {
    // Opening Preview seeks asynchronously. Observe playback before the end so
    // the previous editor playhead cannot complete this step.
    if (!previewPlaybackStarted && currentTime >= previewStart && currentTime < previewEnd - previewEndTolerance) {
      setPreviewPlaybackStarted(true);
    } else if (previewPlaybackStarted && currentTime >= previewEnd - previewEndTolerance) {
      setHasPreviewPlayedThrough(true);
    }
  }
  const handleGuidedCropComplete = useCallback((crop) => {
    setHasDragged(true);
    onCropComplete?.(crop);
  }, [onCropComplete]);

  // `isCropDragging` is reported by CropOverlay via onDragStateChange (memory-only
  // view state, never persisted) so the box coach stays off mid-drag.
  const [isCropDragging, setIsCropDragging] = useState(false);

  // Opening Trim and SlowMo is an explicit, session-only user gesture.
  const [advancedOverride, setAdvancedOverride] = useState(null);
  // Trim and SlowMo are opt-in every time. Existing edits remain intact, but
  // the advanced controls stay collapsed until the user explicitly opens them.
  const advancedOpen = advancedOverride ?? false;

  // The ONE instruction the guide shows, derived from the steps + Trim and SlowMo
  // panel + whether a split exists yet. 'split' / 'adjust' also drive which real
  // trim control pulses (CSS keyed off data-trim-guide on the timeline wrapper).
  const trimGuideStage = !coachEnabled || !stepsComplete || !advancedOpen || previewing
    ? 'off'
    : (segmentBoundaries?.length || 0) <= 2 ? 'split' : 'adjust';
  const guide = !dragDone
    ? { step: 1, text: FRAMING_GUIDE.STEP_DRAG }
    : !hasPlayed
      ? { step: 2, text: FRAMING_GUIDE.STEP_PLAY }
      : trimGuideStage === 'split'
        ? { step: null, text: FRAMING_GUIDE.TRIM_SPLIT }
        : trimGuideStage === 'adjust'
          ? { step: null, text: FRAMING_GUIDE.TRIM_ADJUST }
          : !hasPlayedThrough && !previewing && !hasPreviewPlayedThrough
            ? { step: 3, text: FRAMING_GUIDE.STEP_KEEP }
            : !hasPreviewPlayedThrough
              ? { step: 4, text: previewing ? FRAMING_GUIDE.WATCH_PREVIEW : FRAMING_GUIDE.STEP_PREVIEW }
              : (framingCtaMode === 'preview' || framingCtaMode === 'opening') ? null : { step: 5, text: FRAMING_GUIDE.STEP_GENERATE };

  // T9950 Slice 3: the output-aspect moving preview (design doc §4, P1) is a
  // re-framing of the SAME player, not a second one. EPHEMERAL view state,
  // same pattern as advancedOverride/straightenVisible above — a click
  // toggles it, nothing is persisted, no useEffect involved.
  const handleTogglePreview = useCallback(() => {
    if (previewing) {
      setPreviewing(false);
      return;
    }

    // useVideo.seek is clip-relative and translates zero to the source clip's
    // offset. Do not write video.currentTime directly or that translation is
    // lost and game-backed clips restart at the beginning of the full video.
    setPreviewPlaybackStarted(false);
    seek?.(0);
    const video = videoRef?.current;
    if (video) {
      const playPromise = video.play?.();
      playPromise?.catch?.(() => {});
    }
    setPreviewing(true);
  }, [previewing, seek, videoRef]);
  // The preview's own video->screen mapping, computed at zoom=1/panOffset=0 so
  // the editor's inspection zoom never leaks into the preview (design doc §4
  // landmine 2) regardless of the live editing zoom/panOffset above. Always
  // called (rules of hooks) — cheap when `previewing` is false since nothing
  // reads `previewRect` in that case.
  const { rect: previewRect } = useVideoDisplayRect(videoRef, metadata, {
    zoom: 1,
    panOffset: PREVIEW_ZERO_PAN,
    isFullscreen,
  });
  // Inverse of videoToScreenRect (design doc §4): maps currentCropState onto
  // the whole stage box. containerWidth/Height are derived from previewRect
  // itself rather than a second DOM measurement — offsetX/offsetY are exactly
  // half the letterbox/pillarbox gap when panOffset is {x:0,y:0}.
  // The [Preview highlight] toggle only lives in the non-fullscreen, non-mobileFs
  // action row (rendered `!mobileFs` below, and unreachable from inside desktop
  // fullscreen), so the transform/chrome-hiding effects are scoped to match —
  // otherwise a fullscreen/mobile-expand tap while still marked `previewing`
  // would carry a transform computed for the small stage box onto a viewport
  // that is no longer constrained to the output aspect (reviewer nit, slice 3).
  const previewActive = previewing && !mobileFs && !isFullscreen;
  const previewTransform = useMemo(() => {
    if (!previewActive || !previewRect) return null;
    return computeOutputPreviewTransform({
      crop: currentCropState,
      displayRect: previewRect,
      containerWidth: previewRect.width + 2 * previewRect.offsetX,
      containerHeight: previewRect.height + 2 * previewRect.offsetY,
    });
  }, [previewActive, previewRect, currentCropState]);
  // Constrains the stage box to the OUTPUT aspect (design doc §4) instead of
  // the source video's aspect, only while previewing and only where the box
  // isn't already the full viewport (fullscreen/mobileFs keep their existing
  // sizing — same guard OverlayModeView's stageBoxStyle uses).
  // Width-derived sizing: the box's width is min(column, 70vh * ratio) and its
  // height follows from aspect-ratio, so it is exactly the output aspect at every
  // width. (A fixed 70vh height with a column-capped width made landscape taller
  // than 16:9, and the width-only preview transform then left a dark band.)
  const previewStageRatio = useMemo(() => {
    if (!previewActive) return null;
    const [ratioW, ratioH] = (globalAspectRatio || '').split(':').map(Number);
    return ratioW > 0 && ratioH > 0 ? ratioW / ratioH : null;
  }, [previewActive, globalAspectRatio]);
  const previewStageAspect = useMemo(() => {
    if (!previewActive) return null;
    const [ratioW, ratioH] = (globalAspectRatio || '').split(':').map(Number);
    return ratioW > 0 && ratioH > 0 ? `${ratioW} / ${ratioH}` : null;
  }, [previewActive, globalAspectRatio]);

  // T9270: the Focus settings-rail tab (Settings) and its body. The Settings
  // tab re-homes the old above-video toolbar (aspect, audio, straighten,
  // background dim) into Reel / This clip / View-only groups. `desktopOnly` keeps
  // dim + the straighten line-drag tool out of the mobile drawer (Step 4), exactly
  // as the old toolbar gated them. T10395: zoom moved out of this rail entirely,
  // onto the video's own Controls transport bar (matching Annotate, T10390).
  // T11240: the Clips tab (multi-clip UI) is gone — exactly one clip now, so
  // Settings is the only tab.
  const focusRailTabs = [
    { id: 'settings', label: 'Settings', icon: Sliders },
  ];
  const renderFocusSettings = (desktopOnly) => (
    <FocusSettingsPanel
      globalAspectRatio={globalAspectRatio}
      onAspectRatioChange={onAspectRatioChange}
      includeAudio={includeAudio}
      onIncludeAudioChange={onIncludeAudioChange}
      straightenVisible={straightenVisible}
      onToggleStraighten={handleToggleStraighten}
      dimOpacity={dimOpacity}
      onToggleDim={() => setDimOpacity(dimOpacity === 0.2 ? 0.7 : 0.2)}
      desktopOnly={desktopOnly}
    />
  );
  const focusRailBody = (desktopOnly) => renderFocusSettings(desktopOnly);

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

  // T10830: the framing timeline block, built once and rendered by whichever of
  // the two mutually-exclusive layouts is active (ordinary vs mobile-fullscreen).
  // Guarded on videoUrl so getTimelineScale() is evaluated exactly when it was
  // before the extraction (once, only when a video is loaded).
  const focusTimelineBlock = videoUrl ? (
    <FocusTimelineBlock
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
      timelineZoomControls={timelineZoomControls}
      timelineScale={getTimelineScale()}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineScrollPositionChange={onTimelineScrollPositionChange}
      isPlaying={isPlaying}
      isFullscreen={isFullscreen}
      showSegments={advancedOpen}
    />
  ) : null;

  // T10840 (D3): a phone held sideways gets the cockpit — a distinct precision
  // layout, NOT the scrolling portrait/tablet column. Early-return here, ABOVE
  // the `bg-white/10 backdrop-blur-lg` card below, so no backdrop-filter ancestor
  // exists over the sheets (the T10420 / T10820 containing-block trap). All hooks
  // above have already run, so this conditional return is rules-of-hooks safe.
  if (cockpit) {
    return (
      <FocusCockpit
        videoRef={videoRef}
        videoUrl={videoUrl}
        handlers={handlers}
        clipRange={clipRange}
        metadata={metadata}
        currentCropState={currentCropState}
        aspectRatio={aspectRatio}
        rotation={rotation}
        onSetRotation={onSetRotation}
        onCropChange={onCropChange}
        onCropComplete={onCropComplete}
        zoom={zoom}
        panOffset={panOffset}
        onZoomByWheel={onZoomByWheel}
        onPanChange={onPanChange}
        selectedCropKeyframeIndex={selectedCropKeyframeIndex}
        isLoading={isLoading}
        isProjectLoading={isProjectLoading}
        isVideoElementLoading={isVideoElementLoading}
        loadingProgress={loadingProgress}
        loadingElapsedSeconds={loadingElapsedSeconds}
        loadingStage={loadingStage}
        error={error}
        isSourceExpired={isSourceExpired}
        canExtendSource={canExtendSource}
        isUrlExpiredError={isUrlExpiredError}
        onRetryVideo={onRetryVideo}
        clipTitle={clipTitle}
        clipGameName={clipGameName}
        selectedClipEffectiveDuration={selectedClipEffectiveDuration}
        globalAspectRatio={globalAspectRatio}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        togglePlay={togglePlay}
        stepForward={stepForward}
        stepBackward={stepBackward}
        onExitToHome={onExitToHome}
        keyframes={keyframes}
        framerate={framerate}
        seek={seek}
        onKeyframeDelete={onKeyframeDelete}
        onKeyframeTimeMove={onKeyframeTimeMove}
        onCopyCrop={onCopyCrop}
        framingCtaMode={framingCtaMode}
        onBackToPreview={onBackToPreview}
        backToPreviewLoading={backToPreviewLoading}
        includeAudio={includeAudio}
        onIncludeAudioChange={onIncludeAudioChange}
        onAspectRatioChange={onAspectRatioChange}
        focusTimelineBlock={focusTimelineBlock}
        videoFile={videoFile}
        getFilteredKeyframesForExport={getFilteredKeyframesForExport}
        getSegmentExportData={getSegmentExportData}
        hasClips={hasClips}
        clipsWithCurrentState={clipsWithCurrentState}
        onProceedToOverlay={onProceedToOverlay}
        onExportComplete={onExportComplete}
        saveCurrentClipState={saveCurrentClipState}
        exportButtonRef={exportButtonRef}
      />
    );
  }

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

      {/* Game name now lives in the breadcrumb above (Clips > Game > Clip,
          clickable to jump to Annotate for that game) — see UnifiedHeader /
          Breadcrumb. No separate desktop bar needed here anymore. */}
      {/* Tags keep their own card (unrelated to the identity bar above) since
          they're the one piece of this block with real visual weight. */}
      {!isFullscreen && clipTags?.length > 0 && (
        <div className="hidden lg:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-3 lg:p-4 border border-white/20">
          <div className="flex flex-wrap gap-1">
            {clipTags.map(tag => (
              <span key={tag} className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-xs rounded">
                {tag}
              </span>
            ))}
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
        {/* T10820: `relative overflow-x-clip` no longer contains the mobile settings
            drawer (it moved to the sticky action-band wrapper below, anchored
            `absolute bottom-full` there instead — pre-T10820 this row was its
            containing block via `relative`, with `overflow-x-clip` containing its
            parked off-canvas translateX(316px)). Left in place here because removing
            it is a separate cleanup, not verified safe within this task. */}
        <div className="relative overflow-x-clip lg:flex lg:flex-row lg:items-start">
        <div className="relative flex flex-col w-full lg:flex-1 lg:min-w-0 lg:pr-6">
        {/* Guided framing: one floating instruction near the current action. */}
        {videoUrl && !isFullscreen && !mobileFs && guide && (
          <FloatingCoach phase={guide.step ?? trimGuideStage}
            target={guide.step === 5 ? '[data-testid="action-band"]' : guide.step === 4 ? '[data-testid="framing-preview-toggle"]' : guide.step == null ? '[data-testid="trim-guide-scope"]' : '[data-testid="focus-video-stage"]'}
            fallbackTarget='[data-testid="focus-video-stage"]'>
            <FramingGuide step={guide.step} text={guide.text} />
          </FloatingCoach>
        )}
        {/* Fullscreen container - uses fixed positioning to overlay viewport */}
        <div
          ref={fullscreenContainerRef}
          className={`${(isFullscreen || mobileFs) ? `fixed inset-0 z-[100] bg-gray-900${mobileFs ? '' : ' flex flex-col'}` : ''}`}
          onMouseMove={mobileFs ? fsControls.handleInteraction : undefined}
        >
          {/* Video Player with CropOverlay. 2026-09-18 (user request): the
              preview-highlight stage was growing taller than the viewport on a
              portrait (9:16) reel -- `aspectRatio` alone derives height FROM the
              column's full width, with no cap. `lg:h-[70vh] lg:max-h-[70vh]` +
              `lg:w-fit` flips that (height capped, width derived instead),
              matching OverlayModeView's stageBoxStyle for the identical case.
              T12020: the 70vh cap also leaves room for the sticky ActionBand
              (--cta-bar-h, set by useCtaBarHeight) so the video's bottom edge and
              its controls never sit under the bar. The 12rem term is the estimated
              header + stage-controls height, not measured: verify it in the
              cta-consistency Focus row before trusting it. */}
          <div
            data-testid="focus-video-stage"
            className={`relative bg-gray-900 ${
              (isFullscreen || mobileFs)
                ? mobileFs ? 'w-full h-full' : 'flex-1 min-h-0'
                : previewStageAspect
                  ? 'rounded-lg mx-auto w-full max-w-full lg:w-[min(100%,calc(min(70vh,100dvh-var(--cta-bar-h,0px)-12rem)*var(--preview-ar)))]'
                  : 'rounded-lg'
            }`}
            style={previewStageAspect ? { aspectRatio: previewStageAspect, '--preview-ar': previewStageRatio } : undefined}
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
              allowUpload={false}
              panEnabled={!mobileFs || touchMode === 'view'}
              fitToAspect={!!previewStageAspect}
              contentTransform={previewActive ? previewTransform : null}
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
                    onCropComplete={handleGuidedCropComplete}
                    zoom={previewActive ? 1 : zoom}
                    panOffset={previewActive ? { x: 0, y: 0 } : panOffset}
                    selectedKeyframeIndex={selectedCropKeyframeIndex}
                    isFullscreen={isFullscreen}
                    dimOpacity={dimOpacity}
                    interactive={!mobileFs || touchMode === 'crop'}
                    chromeHidden={previewActive}
                    onDragStateChange={setIsCropDragging}
                    focusPointCount={focusPointCount}
                    guidePulse={coachEnabled && (guide?.step === 1 || guide?.step === 3)}
                    isDragging={isCropDragging}
                    isPlaying={isPlaying}
                  />
                ),
              ].filter(Boolean)}
              zoom={previewActive ? 1 : zoom}
              panOffset={previewActive ? { x: 0, y: 0 } : panOffset}
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
                loadingStage === 'clips' ? 'Loading highlights...' :
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
                pulsePlay={coachEnabled && guide?.step === 2}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
                // T10395: Zoom lives here now (was the settings rail's "View
                // only" row) — desktop, non-fullscreen only, matching Annotate.
                showZoomControls={!isFullscreen && !isMobile}
                zoom={zoom}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onResetZoom={onResetZoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
              />
            )}

            {/* Mobile expand — opt into fullscreen video (inline layout keeps
                the timeline + export controls reachable below) */}
            {isMobile && !mobileFs && videoUrl && (
              <button
                // T10820: entering mobile fullscreen unmounts the sticky band wrapper
                // (and the settings panel inside it), so close the panel from this
                // same gesture rather than leaving `drawerOpen` stale until the next
                // render.
                onClick={() => { setMobileExpanded(true); setDrawerOpen(false); }}
                className="absolute top-2 right-2 z-10 p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-black/50 text-white hover:bg-black/70"
                title="Fullscreen video"
                aria-label="Expand video to fullscreen"
              >
                <Maximize size={18} />
              </button>
            )}
          </div>

          {/* T10850 (D14): the portrait rotate nudge sits DIRECTLY under the stage,
              where the eye lands right after seeing how small the crop box is — not
              a header, not a toast. It self-gates on isMobile && !isLandscape &&
              no-focus-points-yet && !dismissed; `focusPointCount` is the crop
              keyframe list already in scope (no new state). Never rendered inside
              fullscreen / mobile-fullscreen. */}
          {/* isLandscape is sourced from `cockpit`: this render path is reached
              only when cockpit is false, and cockpit = isMobile && isLandscape, so
              a mobile device here is necessarily portrait (the landscape case
              early-returned to FocusCockpit above). Passing `cockpit` keeps
              RotateNudge's D14 condition (isMobile && !isLandscape) exact without a
              second useIsLandscape() call that would break the FocusModeView tests'
              useIsMobile mock. */}
          {!isFullscreen && !mobileFs && videoUrl && (
            <RotateNudge
              isMobile={isMobile}
              isLandscape={cockpit}
              hasFocusPoints={focusPointCount > 0}
            />
          )}

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
          {!mobileFs && (
            <div data-testid="trim-guide-scope" data-trim-guide={trimGuideStage}>
              {focusTimelineBlock}
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
                  {videoUrl && (
                    <Controls
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      duration={duration}
                      onTogglePlay={togglePlay}
                      pulsePlay={coachEnabled && guide?.step === 2}
                      onStepForward={stepForward}
                      onStepBackward={stepBackward}
                      onRestart={restart}
                      isFullscreen={isFullscreen}
                      onToggleFullscreen={onToggleFullscreen}
                    />
                  )}
                  {focusTimelineBlock && (
                    <div className="bg-gray-900/90 px-2 py-0.5">
                      {focusTimelineBlock}
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
        </div>

        {/* T9270: mobile settings entry row — a 64px full-width labelled button that
            opens the panel, with a derived live-summary second line. Hidden in mobile
            fullscreen (as the toolbar was). Desktop uses the in-flow rail instead.
            T10820: the row stays exactly where it is and never becomes the panel
            itself — it flips `aria-expanded`, rotates its chevron, and takes an
            active border so it still reads as the thing that opened. */}
        {videoUrl && !isFullscreen && !mobileFs && isMobile && (
          <button
            type="button"
            data-testid="mobile-settings-row"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            className="mt-4 w-full h-16 flex items-center gap-3 rounded-[10px] px-3.5 text-left transition-colors"
            style={{ border: drawerOpen ? '1px solid #2563eb' : '1px solid #334155', background: '#0f172a' }}
            aria-label="Open settings"
          >
            <Sliders size={20} className="shrink-0 text-gray-300" aria-hidden="true" />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold text-gray-100">Settings</span>
              <span data-testid="mobile-settings-summary" className="text-xs text-gray-400 truncate">
                {mobileSettingsSummary}
              </span>
            </span>
            {drawerOpen ? (
              <ChevronDown size={18} className="shrink-0 text-gray-500" aria-hidden="true" />
            ) : (
              <ChevronLeft size={18} className="shrink-0 text-gray-500" aria-hidden="true" />
            )}
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
        // T9920: the bleed MUST match App's content container padding (`px-3 sm:px-4`,
        // App.jsx) — the band spans to the container edge, not 8px past it. The old
        // `sm:-mx-6` over-bled by 8px/side; harmless while `mx-auto` gutters absorbed
        // it, but at the `md` boundary (768px) — and again at `lg` (1024px) — the
        // container is full-width with a zero gutter, so those 8px leaked as a
        // horizontal scrollbar on App's inner overflow-auto pane.
        // T10820: `relative overflow-x-clip` added — this sticky wrapper is now also
        // the mobile settings panel's containing block (`absolute bottom-full`
        // inside it), which is why the panel is mounted as this div's first child.
        <div className="sticky bottom-0 z-30 mt-4 sm:mt-6 -mx-3 sm:-mx-4 relative overflow-x-clip">
          {/* T9270: mobile settings panel — the SAME SettingsRail anchored above
              the band (T10820: `absolute bottom-full`, never `position:fixed`).
              Opened by the mobile-settings-row above; closed by its own 44x44
              header close. Holds the mobile-safe subset (Reel + This clip via
              desktopOnly=false; no dim/zoom or straighten line-drag tool). */}
          {isMobile && (
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
          <ExportButtonSection
            ref={exportButtonRef}
            videoFile={videoFile}
            cropKeyframes={getFilteredKeyframesForExport}
            segmentData={getSegmentExportData()}
            disabled={!videoUrl || !stepsComplete}
            guideLocked={!!videoUrl && !stepsComplete}
            pulseGenerate={coachEnabled && guide?.step === 5}
            includeAudio={includeAudio}
            onIncludeAudioChange={onIncludeAudioChange}
            onProceedToOverlay={onProceedToOverlay}
            clips={hasClips ? clipsWithCurrentState : null}
            globalAspectRatio={globalAspectRatio}
            onExportComplete={onExportComplete}
            saveCurrentClipState={saveCurrentClipState}
            framingCtaMode={framingCtaMode}
            showBackToPreview={showBackToPreview}
            onBackToPreview={onBackToPreview}
            renderedAt={renderedAt}
            backToPreviewLoading={backToPreviewLoading}
            // [Trim and SlowMo] + [Preview highlight] sit in the band directly above
            // Generate (same row-above-CTA shape as Annotate). Locked together with
            // Generate until the guided steps are done. Trim and SlowMo toggles the
            // timeline's segment/speed/trim track (advancedOpen).
            actionsAbove={
              <FramingActionRow
                inline
                previewing={previewing}
                onTogglePreview={handleTogglePreview}
                onToggleTrim={() => setAdvancedOverride(!advancedOpen)}
                trimOpen={advancedOpen}
                locked={!stepsComplete}
                pulsePreview={coachEnabled && guide?.step === 4 && !previewing}
              />
            }
          />
        </div>
      )}

      {/* Technical readouts (dimensions/duration/fps) - 2026-09-18 (user request):
          moved below the bottom CTA and de-emphasized (small/quiet), split out of
          the clip-identity block above. Same content, least-important placement. */}
      {metadata && !isFullscreen && (
        <div className="hidden lg:flex items-center gap-3 mt-2 text-xs text-gray-500">
          <span>{metadata.width}x{metadata.height}</span>
          <>
            <span className="text-gray-700">•</span>
            {/* T9480 review fix: the clip's source duration is a LENGTH -- rounds, not floors. */}
            <span>{formatLength(duration || clipDuration, PRECISION.SECOND, { style: 'clock' })}</span>
          </>
          {selectedClipEffectiveDuration != null && (
            <>
              <span className="text-gray-700">•</span>
              <OutputLengthChip
                seconds={selectedClipEffectiveDuration}
                emphasized={outputDiffersFromSource}
              />
            </>
          )}
          {metadata.framerate && (
            <>
              <span className="text-gray-700">•</span>
              <span>{Math.round(metadata.framerate)} fps</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
