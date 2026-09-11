import { forwardRef, useState, useEffect, useCallback, useMemo } from 'react';
import { VideoPlayer } from '../components/VideoPlayer';
import { computeSpotlightReveal } from '../utils/spotlightReveal';
import OverrideHint from './overlay/overlays/OverrideHint';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import ExportButtonView from '../components/ExportButtonView';
import ThumbnailPanel from '../components/overlay/ThumbnailPanel';
import TextManagementPanel from '../components/overlay/TextManagementPanel';
import SettingsRail from '../components/settings/SettingsRail';
import OverlaySpotlightPanel from '../components/settings/OverlaySpotlightPanel';
import { ExportButtonContainer } from '../containers/ExportButtonContainer';
import { Button } from '../components/shared';
import { OverlayMode, HighlightOverlay, PlayerDetectionOverlay, TextOverlayPreview } from './overlay';
import { Minimize, Maximize, RotateCcw, Sparkles, Type, Image as ImageIcon, ChevronLeft } from 'lucide-react';
import { formatTimeSimple } from '../components/shared/clipConstants';
import { HIGHLIGHT_COLOR_LABELS } from '../constants/highlightColors';
import { EDITOR_PANELS } from '../config/displayNames';
import { openPlayWindow, selectPosterFrame } from '../utils/posterWindow';
import { isRegionUnderPlayhead } from '../utils/textRegionPlayhead';

/**
 * ExportButtonSection - Container+View composition for Overlay mode export
 *
 * Follows MVC pattern: Container handles logic, View handles presentation.
 */
const OverlayExportButtonSection = forwardRef(function OverlayExportButtonSection({
  videoFile,
  highlightRegions,
  highlightEffectType,
  onHighlightEffectTypeChange,
  includeAudio,
  onIncludeAudioChange,
  onExportComplete,
  disabled,
}, ref) {

  // Container: all business logic. Tuning controls live in the settings rail
  // (T9270, OverlaySpotlightPanel); this section is now the CTA + progress only.
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

  // View: pure presentation.
  // T9270: renders the full-width ActionBand (the CTA is "Add Overlay").
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
        onExport={container.handleExport}
        onRetryConnection={container.handleRetryConnection}
        onDismissExport={container.handleDismissExport}
        showInsufficientCredits={null}
        onCloseInsufficientCredits={null}
        handleExportRef={container.handleExportRef}
      />
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
  gameName = null,
  gameClock = null,
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
  onCommitHighlightRegionStart,
  onCommitHighlightRegionEnd,
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

  // T5225 / T6630 round 4: Overlay text REGIONS (each containing N elements)
  textOverlays = [],
  clipBoundaries = [],
  selectedRegionId = null,
  selectedElementId = null,
  // T6980: inline text-edit state + setters (view-state only, no write path).
  inlineEditingElementId = null,
  beginInlineEdit,
  endInlineEdit,
  onAddRegion,
  onAddElement,
  onMoveTextStart,
  onMoveTextEnd,
  onMoveTextBody,
  onMoveTextPosition,
  onSelectRegion,
  onSelectElement,
  onDeleteText,
  onDeleteTextRegion,
  onToggleText,
  onUpdateTextSpec,

  // T5410 / T6510: preview-image (poster) marker
  posterMarkerTime = null,
  posterSlowmoSection = null,
  posterUploaded = false,
  onPosterMarkerDragEnd,
  onRemoveUpload,

  // Player detection (auto-detected during framing export)
  playerDetectionEnabled,
  playerDetections,
  detectionVideoWidth,
  detectionVideoHeight,
  isDetectionLoading,
  onPlayerSelect,
  showPlayerBoxes,
  onTogglePlayerBoxes,
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
  // T6630 round 2: whole-text-layer visibility toggle (label icon + preview gate)
  textLayerHidden = false,
  onToggleTextLayer,

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
  // T5676: locks the Overlay Settings card while an overlay export is in flight
  // (mirrors the export container's isCurrentlyExporting; threaded from OverlayScreen).
  settingsDisabled = false,
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

  // T6630 round 2: the three-tab settings section (Overlay | Text | Thumbnail).
  // Default "overlay". Selecting a text region (T6630 round 4: the timeline
  // lane's addressable unit) forces the Text tab (see handleSelectRegion
  // below) so the on-screen panel updates in place — the panel has a CONSTANT
  // height, so this never reflows the timeline.
  const [activeTab, setActiveTab] = useState('overlay');

  // T9270: ephemeral settings-rail view state. NEVER persisted (no-persisted-view-state
  // rule; precedent T5610 circleEditActive / T5370 spotlightPlayMode). Desktop rail
  // defaults EXPANDED (collapsed=false); the mobile drawer defaults CLOSED
  // (drawerOpen=false). No useEffect writes these — gesture handlers only.
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // T6630 round 6/7 item 2/1: "all text settings should be for the text
  // regions the playhead is currently on" -- STRICT playhead scoping for the
  // SETTINGS panel: no exception for whatever region is last SELECTED. Round 7
  // user direction: "when my playhead was not over any text region i expect
  // disabled and empty text settings". Region creation and region selection
  // both explicitly seek the playhead into range (wrappedAddRegion /
  // handleSelectRegion below), so a legitimately-just-selected region's range
  // contains currentTime by the time this filter runs. Regions CAN overlap, so
  // this is a list (0, 1, or N).
  // T6880: this uses the SHARED `isRegionUnderPlayhead` predicate that
  // TextOverlayPreview's burn-in filter now uses too, so the panel and the
  // canvas can never disagree about "under the playhead" (they previously
  // diverged -- the canvas kept a SELECTED out-of-range region rendering while
  // the panel dropped it; that exception is now a paused-only, dimmed editing
  // ghost layered on top of this same predicate). The EPSILON tolerance (part
  // of the shared helper) absorbs the sub-millisecond seek quantization that
  // would otherwise permanently hide a just-created region's own settings once
  // paused; see textRegionPlayhead.js.
  const activeTextRegionsAtPlayhead = useMemo(
    () => textOverlays.filter((region) => isRegionUnderPlayhead(region, currentTime)),
    [textOverlays, currentTime]
  );

  // Gesture-based tab switch: a region-select click flips to the Text tab.
  // Passing null (deselect) does not change the tab. No reactive useEffect.
  //
  // T6630 round 6/7: selecting a region whose range does NOT contain the
  // current playhead (e.g. clicking an existing block elsewhere on the
  // timeline) must also move the playhead INTO it -- round 7 removed the
  // Text tab filter's selectedRegionId short-circuit (above), so this seek
  // is now the ONLY thing that makes a just-selected region's settings
  // actually show up (strict playhead scoping, no exception for selection).
  // It also keeps the STAGE PREVIEW showing the region in context -- editing
  // something you can't see rendering on the video is confusing regardless.
  // Region CREATION already seeks (wrappedAddRegion, OverlayScreen.jsx) --
  // this covers the SELECT-an-EXISTING-region path, the other way in.
  const handleSelectRegion = useCallback((id, elementId) => {
    onSelectRegion && onSelectRegion(id, elementId);
    if (id) {
      setActiveTab('text');
      const region = textOverlays.find((r) => r.id === id);
      // Seek into range only if the playhead isn't already there -- SAME shared
      // predicate the panel/canvas use (T6880), so "already under the playhead"
      // means the same thing everywhere.
      if (region && !isRegionUnderPlayhead(region, currentTime)) {
        seek && seek(region.startTime);
      }
    }
  }, [onSelectRegion, textOverlays, currentTime, seek]);

  // T6980: compose the double-click / double-tap -> inline-edit gesture. Modeled
  // on handleSelectRegion: select the element, flip to the Text tab, seek the
  // playhead INTO the owning region if it isn't already there (so the settings
  // panel + stage show the element being edited), then enter inline edit. All
  // view-state -- no backend write (the write path is per-keystroke, unchanged).
  const handleBeginInlineEdit = useCallback((id, regionId) => {
    onSelectElement && onSelectElement(id, regionId);
    setActiveTab('text');
    const region = textOverlays.find((r) => r.id === regionId);
    if (region && !isRegionUnderPlayhead(region, currentTime)) {
      seek && seek(region.startTime);
    }
    beginInlineEdit && beginInlineEdit(id);
  }, [onSelectElement, textOverlays, currentTime, seek, beginInlineEdit]);

  // T7720: a click (not a drag) on the thumbnail marker opens the Thumbnail
  // settings tab and seeks the playhead to the marker's frame -- the same
  // "click a timeline element -> switch to its tab + seek" shape handleSelectRegion
  // uses for text regions. `markerVisualTime` is already in visual/timeline space
  // (what `seek` expects), so it's seeked as-is -- no conversion, no persistence
  // (dragging remains the only way to MOVE the frame, T6560).
  const handlePosterMarkerClick = useCallback((markerVisualTime) => {
    setActiveTab('thumbnail');
    seek && seek(markerVisualTime);
  }, [seek]);

  // T5676: aspect-fit stage. Size the non-fullscreen video box to the reel's true
  // pixel aspect ratio so a 9:16 reel stops pillarboxing inside a 16:9-ish column.
  // `object-contain` then becomes a no-op (box already == video aspect), and the
  // freed horizontal space carries the Overlay Settings card beside the video on
  // desktop. Only applied when metadata is known and NOT fullscreen/mobileFs —
  // fullscreen keeps the full viewport (CSS :fullscreen rules) and mobileFs keeps
  // w-full h-full. The `.video-container` ResizeObserver (T5590) makes resizing
  // the box safe for overlay alignment.
  const aspectW = effectiveOverlayMetadata?.width;
  const aspectH = effectiveOverlayMetadata?.height;
  const useAspectStage = !isFullscreen && !mobileFs && aspectW > 0 && aspectH > 0;
  const stageBoxClass = useAspectStage
    ? // T9150: the width cap that stops a landscape stage (genuinely 16:9, or a
      // wrong-metadata bug) from starving the settings column lives on the VIDEO
      // COLUMN below (lg:max-w-[calc(100%-22rem)]), not here. A % max-width on
      // THIS box would resolve against its own lg:w-fit (fit-content) parent --
      // circular, since the parent's width depends on this box's width. The column
      // has a definite width from ITS parent (the row), so capping there is safe;
      // this box just respects whatever width the column leaves it via max-w-full.
      'relative bg-gray-900 rounded-lg overflow-hidden mx-auto w-full max-w-full lg:w-fit lg:h-[70vh] lg:max-h-[70vh]'
    : `relative bg-gray-900 ${
        (isFullscreen || mobileFs)
          ? mobileFs ? 'w-full h-full' : 'flex-1 min-h-0'
          : 'rounded-lg'
      }`;
  const stageBoxStyle = useAspectStage ? { aspectRatio: `${aspectW} / ${aspectH}` } : undefined;

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
    // EDITOR-ONLY: the exit fade-out plays during preview PLAYBACK. When paused (e.g.
    // stopped at the region-start frame to edit) return null so HighlightOverlay renders
    // the spotlight at FULL opacity/size (its `reveal ? ... : 1` fallback) — the full
    // spotlight stays visible while editing. The BACKEND export ALWAYS applies the fade
    // (never gated on playing), so preview-during-playback still matches the exported video.
    if (!isPlaying) return null;
    if (!highlightRegions?.length) return null;
    const region = highlightRegions.find(
      (r) => r.enabled !== false && currentTime >= r.startTime && currentTime <= r.endTime
    );
    if (!region) return null;
    return computeSpotlightReveal(currentTime, region.startTime, region.endTime);
  }, [isPlaying, highlightRegions, currentTime]);

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
      ? { onClick: onPlayFull, title: 'Play clip', active: spotlightPlayMode === 'full' }
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

  // T5676: video element + absolute badges (exit / reset / hint / mobile-expand),
  // shared by the fullscreen and the non-fullscreen (aspect-fit) branches so the
  // large VideoPlayer prop block is not duplicated. Controls render separately —
  // inside the box for fullscreen, below the box for the aspect stage.
  const videoStageInner = (
    <>
      <VideoPlayer
        videoRef={videoRef}
        videoUrl={effectiveOverlayVideoUrl}
        handlers={handlers}
        fitToAspect={useAspectStage}
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
          effectiveOverlayMetadata && !textLayerHidden && textOverlays.length > 0 && (
            <TextOverlayPreview
              key="text-preview"
              videoRef={videoRef}
              videoMetadata={effectiveOverlayMetadata}
              textOverlays={textOverlays}
              currentTime={currentTime}
              selectedRegionId={selectedRegionId}
              selectedElementId={selectedElementId}
              onMoveTextPosition={onMoveTextPosition}
              onSelectElement={onSelectElement}
              // T6980: double-click/double-tap -> inline edit. onEditText is the
              // SAME single write path the panel input uses (onUpdateTextSpec ->
              // wrappedUpdateTextSpec) -- not a second path.
              onBeginInlineEdit={handleBeginInlineEdit}
              inlineEditingElementId={inlineEditingElementId}
              onEndInlineEdit={endInlineEdit}
              onEditText={onUpdateTextSpec}
              zoom={zoom}
              panOffset={panOffset}
              isFullscreen={isFullscreen}
              // T6880: the editing-ghost exception (selected out-of-range region
              // shown for editing) is gated on Text tab active AND paused.
              isPlaying={isPlaying}
              isTextTabActive={activeTab === 'text'}
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
    </>
  );

  // Playback controls — bound to the VIDEO width (T5676): inside the box for
  // fullscreen, directly under the box (video-width column) for the aspect stage.
  const controlsEl = (!mobileFs && effectiveOverlayVideoUrl) ? (
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
  ) : null;

  // T5676: Overlay tuning controls — beside the video on desktop, stacked above
  // the Add Spotlight button on mobile. Extracted from ExportButtonView.
  // T6510: the SOURCE-time of the frame the preview image will use -- the user's
  // marker if set, else the export-time default (T6630 round 8: the open-play
  // window's own start, or 2s into it when there's no slow-mo section;
  // openPlayWindow + selectPosterFrame mirror poster.py exactly, so the shown
  // still matches what export picks). Feeds PosterFramePreview so the user
  // SEES the actual frame.
  const posterFrameSourceTime = useMemo(() => {
    if (posterMarkerTime != null) return posterMarkerTime;
    const dur = effectiveOverlayMetadata?.duration || duration || 0;
    if (!dur) return 0;
    return selectPosterFrame(openPlayWindow(posterSlowmoSection, dur), null, posterSlowmoSection);
  }, [posterMarkerTime, posterSlowmoSection, effectiveOverlayMetadata?.duration, duration]);

  // --- Spotlight tab: spotlight/highlight tuning (poster moved to Thumbnail tab). ---
  // T9270: ported onto the shared SettingRow / SettingsPanel anatomy.
  const overlayPanel = (
    <OverlaySpotlightPanel
      highlightColor={highlightColor}
      onHighlightColorChange={onHighlightColorChange}
      highlightShape={highlightShape}
      onHighlightShapeChange={onHighlightShapeChange}
      strokeWidth={strokeWidth}
      onStrokeWidthChange={onStrokeWidthChange}
      fillOpacity={fillOpacity}
      onFillEnabledChange={onFillEnabledChange}
      onFillOpacityChange={onFillOpacityChange}
      dimStrength={dimStrength}
      onDimStrengthChange={onDimStrengthChange}
      onHighlightEffectTypeChange={onHighlightEffectTypeChange}
      isHighlightEnabled={highlightRegions.length > 0}
      disabled={settingsDisabled}
    />
  );

  // --- Text tab: element management (add/remove ELEMENTS, settings) for the
  // region(s) ACTIVE AT THE PLAYHEAD (T6630 round 6 item 2 -- see
  // activeTextRegionsAtPlayhead above). Region CREATE/DELETE live entirely on
  // the timeline lane (round 5/6 item 1/3). A per-region "+ Add text"
  // (element), per-element Remove/visibility, and the settings editor (incl.
  // the 9-slot position grid) for the selected element. Selecting a region/
  // element sets the SAME selectedRegionId/selectedElementId the timeline/
  // stage read -- one selection state, no second source of truth.
  // Two-column layout (list left, settings right, round 4 item 3) so adding
  // a row never moves the settings panel. ---
  const textPanel = (
    <TextManagementPanel
      regions={activeTextRegionsAtPlayhead}
      selectedRegionId={selectedRegionId}
      selectedElementId={selectedElementId}
      onAddElement={onAddElement}
      onSelectRegion={handleSelectRegion}
      onSelectElement={onSelectElement}
      onDeleteText={onDeleteText}
      onDeleteTextRegion={onDeleteTextRegion}
      onToggleText={onToggleText}
      onUpdateTextSpec={onUpdateTextSpec}
      // T6980: when inline-editing, the panel expands+scrolls+focuses the
      // selected element's row; blur/Escape/Enter on its input ends inline edit.
      inlineEditingElementId={inlineEditingElementId}
      onEndInlineEdit={endInlineEdit}
    />
  );

  // --- Thumbnail tab (T6590): the chosen still as FEEDBACK; the marker owns
  // setting the frame (no "Use current frame" button). ---
  const thumbnailPanel = (
    <ThumbnailPanel
      posterMarkerTimeLabel={
        !posterUploaded && posterMarkerTime != null ? formatTimeSimple(posterMarkerTime) : null
      }
      posterUploaded={posterUploaded}
      posterPreviewVideoUrl={effectiveOverlayVideoUrl}
      posterPreviewTime={posterFrameSourceTime}
      onRemoveUpload={onRemoveUpload}
      disabled={settingsDisabled}
    />
  );

  // T9270: the unified settings rail. Tabs live in the rail header (one activeTab
  // source of truth); the body renders the active tab. One accent: blue-600. Same
  // component drives the desktop rail and the mobile translateX drawer (below).
  const settingsRailTabs = [
    { id: 'overlay', label: 'Spotlight', icon: Sparkles },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'thumbnail', label: EDITOR_PANELS.COVER_IMAGE, icon: ImageIcon },
  ];
  const settingsRailBodies = { overlay: overlayPanel, text: textPanel, thumbnail: thumbnailPanel };
  const activeRailTab = settingsRailTabs.some((t) => t.id === activeTab) ? activeTab : 'overlay';
  // Dim (never disable) the Text tab when no text region sits under the playhead —
  // preserves the OverlaySettingsTabs affordance the rail replaced (T6630: dimmed =
  // deprioritized, still clickable so the panel's "add one" guidance stays reachable).
  const railDisabledTabIds = activeTextRegionsAtPlayhead.length === 0 ? ['text'] : [];

  // T9270: the mobile entry row's live-summary second line. DERIVED from the same
  // state the rows bind to — never a second stored copy.
  const colorLabel = HIGHLIGHT_COLOR_LABELS[highlightColor] || 'White';
  const shapeLabel = highlightShape === 'ground'
    ? EDITOR_PANELS.SPOTLIGHT_UNDER_PLAYER
    : EDITOR_PANELS.SPOTLIGHT_AROUND_PLAYER;
  const mobileSettingsSummary =
    `${colorLabel} - ${shapeLabel} - Dim ${Math.round((dimStrength ?? 0) * 100)}%`;

  return (
    <div className="flex flex-col min-h-0">
      {/* T740: Outdated Focus banner */}
      {framingOutdated && !isFullscreen && (
        <div className="mb-3 flex items-center justify-between gap-3 bg-amber-900/40 border border-amber-500/30 rounded-lg px-4 py-2.5">
          <p className="text-amber-200 text-sm">
            Clip boundaries changed since this video&apos;s Focus export. Overlay edits will apply to the old crop.
          </p>
          <button
            onClick={onSwitchToFraming}
            className="flex-shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-medium transition-colors"
          >
            Re-run Focus
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
              {/* T5670: game name + in-match game clock (matches Annotate) */}
              {gameName && gameClock && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="truncate max-w-[220px]">{gameName}</span>
                  <span className="text-gray-600">·</span>
                  <span className="flex-shrink-0">{gameClock}</span>
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
          {/* Video Player + overlays. Fullscreen/mobileFs keep the single fixed
              box (Controls inside); non-fullscreen uses the T5676 aspect-fit stage
              with the Overlay Settings card in the reclaimed pillarbox width beside
              the video on desktop, and Controls bound to the video width below it. */}
          {(isFullscreen || mobileFs) ? (
            <div
              data-testid="overlay-video-stage"
              className={stageBoxClass}
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
              {videoStageInner}
              {controlsEl}
            </div>
          ) : (
            <div className="relative lg:flex lg:flex-row lg:items-start">
              {/* Video column — shrink-wraps the aspect box so Controls bind to the
                  video width (lg:w-fit); full width when stacked on mobile. T9270:
                  lg:flex-1 lets it GROW into the width the rail gives back when the
                  rail collapses (the rail is a shrink-0 sibling reserving exactly its
                  own width, so no explicit max-w cap is needed — collapsing the rail
                  reflows this column wider for free). The stage box inside just
                  respects whatever width the column leaves it via max-w-full. */}
              <div className="flex flex-col w-full lg:w-fit lg:flex-1 lg:min-w-0 lg:pr-6">
                <div data-testid="overlay-video-stage" className={stageBoxClass} style={stageBoxStyle}>
                  {videoStageInner}
                </div>
                {controlsEl}
              </div>
              {/* T9270: the unified settings rail — desktop (fine pointer) only, a
                  300px in-flow box that width-tweens to a 64px icon strip when
                  collapsed. On mobile the SAME rail renders as the translateX drawer
                  below. */}
              {!isMobile && (
                <SettingsRail
                  isMobile={false}
                  collapsed={railCollapsed}
                  onToggleCollapse={() => setRailCollapsed((v) => !v)}
                  tabs={settingsRailTabs}
                  activeTab={activeRailTab}
                  onTabChange={setActiveTab}
                  disabledTabIds={railDisabledTabIds}
                  disabledTabTitle="No text region under the playhead"
                  title="Spotlight settings"
                >
                  {settingsRailBodies[activeRailTab]}
                </SettingsRail>
              )}
              {/* T9270: mobile settings drawer — the SAME SettingsRail in translateX
                  mode, position:absolute inside this relatively-positioned stage row
                  so it never alters the stage box. Opened by the mobile-settings-row
                  below; closed by its own 44x44 header close. */}
              {isMobile && (
                <SettingsRail
                  isMobile
                  open={drawerOpen}
                  onCloseDrawer={() => setDrawerOpen(false)}
                  tabs={settingsRailTabs}
                  activeTab={activeRailTab}
                  onTabChange={setActiveTab}
                  disabledTabIds={railDisabledTabIds}
                  disabledTabTitle="No text region under the playhead"
                  title="Spotlight settings"
                >
                  {settingsRailBodies[activeRailTab]}
                </SettingsRail>
              )}
            </div>
          )}

          {/* Mobile-only clip title — minimal, under video (T5670: + game name/clock) */}
          {(videoTitle || (gameName && gameClock)) && !isFullscreen && !mobileFs && (
            <div className="lg:hidden px-2 py-1 text-sm text-gray-300 truncate">
              {videoTitle && <span className="font-medium text-white">{videoTitle}</span>}
              {gameName && gameClock && (
                <span className="text-gray-400">{videoTitle ? ' · ' : ''}{gameName} · {gameClock}</span>
              )}
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
            onCommitHighlightRegionStart={onCommitHighlightRegionStart}
            onCommitHighlightRegionEnd={onCommitHighlightRegionEnd}
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
            posterMarkerTime={posterMarkerTime}
            posterSlowmoSection={posterSlowmoSection}
            posterUploaded={posterUploaded}
            onPosterMarkerDragEnd={onPosterMarkerDragEnd}
            onPosterMarkerClick={handlePosterMarkerClick}
            isExportInFlight={settingsDisabled}
            isThumbnailTabActive={activeTab === 'thumbnail'}
            textOverlays={textOverlays}
            clipBoundaries={clipBoundaries}
            selectedRegionId={selectedRegionId}
            onAddTextRegion={onAddRegion}
            onMoveTextStart={onMoveTextStart}
            onMoveTextEnd={onMoveTextEnd}
            onMoveTextBody={onMoveTextBody}
            onSelectRegion={handleSelectRegion}
            onDeleteTextRegion={onDeleteTextRegion}
            textLayerHidden={textLayerHidden}
            onToggleTextLayer={onToggleTextLayer}
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
                        onCommitHighlightRegionStart={onCommitHighlightRegionStart}
                        onCommitHighlightRegionEnd={onCommitHighlightRegionEnd}
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
                        posterMarkerTime={posterMarkerTime}
                        posterSlowmoSection={posterSlowmoSection}
                        posterUploaded={posterUploaded}
                        onPosterMarkerDragEnd={onPosterMarkerDragEnd}
                        onPosterMarkerClick={handlePosterMarkerClick}
                        isExportInFlight={settingsDisabled}
                        isThumbnailTabActive={activeTab === 'thumbnail'}
                        textOverlays={textOverlays}
                        clipBoundaries={clipBoundaries}
                        selectedRegionId={selectedRegionId}
                        onAddTextRegion={onAddRegion}
                        onMoveTextStart={onMoveTextStart}
                        onMoveTextEnd={onMoveTextEnd}
                        onMoveTextBody={onMoveTextBody}
                        onSelectRegion={handleSelectRegion}
                        onDeleteTextRegion={onDeleteTextRegion}
                        textLayerHidden={textLayerHidden}
            onToggleTextLayer={onToggleTextLayer}
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
              Export required for Spotlight mode
            </p>
            <p className="text-purple-300/70 text-sm mb-4">
              {hasMultipleClips
                ? 'You have multiple clips loaded. Export first to combine them into a single video before adding overlays.'
                : 'You have made edits in AI Focus mode. Export first to apply them before adding overlays.'}
            </p>
            <button
              onClick={onSwitchToFraming}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Switch to AI Focus Mode
            </button>
          </div>
        )}

        {/* T9270: mobile settings entry row — a 64px full-width labelled button that
            opens the drawer, with a derived live-summary second line. Hidden in mobile
            fullscreen (as the toolbar was). Desktop uses the in-flow rail instead.
            Replaces the old lg:hidden stacked settings copy. */}
        {effectiveOverlayVideoUrl && !isFullscreen && !mobileFs && isMobile && (
          <button
            type="button"
            data-testid="mobile-settings-row"
            onClick={() => setDrawerOpen(true)}
            className="mt-4 w-full h-16 flex items-center gap-3 rounded-[10px] px-3.5 text-left"
            style={{ border: '1px solid #334155', background: '#0f172a' }}
            aria-label="Open spotlight settings"
          >
            <Sparkles size={20} className="shrink-0 text-gray-300" aria-hidden="true" />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold text-gray-100">Spotlight settings</span>
              <span data-testid="mobile-settings-summary" className="text-xs text-gray-400 truncate">
                {mobileSettingsSummary}
              </span>
            </span>
            <ChevronLeft size={18} className="shrink-0 text-gray-500" aria-hidden="true" />
          </button>
        )}

      </div>

      {/* T9270: the action band is the last flex:none child of the shell, spanning
          the full width under the stage + settings rail. "Add Overlay" CTA.
          `sticky bottom-0` pins it to the viewport bottom against App's
          `flex-1 overflow-auto` scroll container so the CTA paints above the fold at
          every width (generalizes T8790's mobile-only sticky bar; its solid bg +
          top-shadow read cleanly over the taller portrait stage scrolling behind). */}
      {effectiveOverlayVideoUrl && !isFullscreen && !mobileFs && (
        <div className="sticky bottom-0 z-30 mt-4 sm:mt-6 -mx-3 sm:-mx-6">
          <OverlayExportButtonSection
            ref={exportButtonRef}
            videoFile={effectiveOverlayFile}
            highlightRegions={getRegionsForExport()}
            highlightEffectType={highlightEffectType}
            onHighlightEffectTypeChange={onHighlightEffectTypeChange}
            includeAudio={includeAudio}
            onIncludeAudioChange={onIncludeAudioChange}
            onExportComplete={onExportComplete}
            disabled={!effectiveOverlayFile && !effectiveOverlayVideoUrl}
          />
        </div>
      )}
    </div>
  );
}
