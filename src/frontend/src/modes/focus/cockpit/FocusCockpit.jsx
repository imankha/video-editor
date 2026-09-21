import { useState, useMemo, useImperativeHandle, lazy, Suspense } from 'react';
import { VideoPlayer } from '../../../components/VideoPlayer';
import CropOverlay from '../overlays/CropOverlay';
import { ExportButtonContainer } from '../../../containers/ExportButtonContainer';
import useVideoDisplayRect from '../../../hooks/useVideoDisplayRect';
import { computeOutputPreviewTransform } from '../../../utils/outputPreviewTransform';
import { ClipSelectorSidebar } from '../../../components/ClipSelectorSidebar';
import FocusSettingsPanel from '../../../components/settings/FocusSettingsPanel';
import { formatLength, PRECISION } from '../../../utils/timeFormat';
import { FOCUS_COCKPIT } from '../../../config/displayNames';
import { Z } from '../../../constants/zLayers';
import TransportRail from './TransportRail';
import ActionRail from './ActionRail';
import CockpitTimelineStrip from './CockpitTimelineStrip';
import CockpitSheet from './CockpitSheet';
import CockpitIntroCard, { useCockpitIntroSeen } from './CockpitIntroCard';

const BuyCreditsModal = lazy(() =>
  import('../../../components/BuyCreditsModal').then((m) => ({ default: m.BuyCreditsModal })));

const ZERO_PAN = { x: 0, y: 0 };

/**
 * FocusCockpit (T10840) — the landscape-phone cockpit shell. Rendered by
 * FocusModeView's early return (above the backdrop-blur card, D3) when
 * `useIsCockpit()` is true. Full-bleed stage, a 56px transport rail left, a 72px
 * action rail right, one 56px timeline strip, and side sheets for Clips / Setup /
 * Trim. No scroll anywhere (`h-dvh`, `overflow-hidden`).
 *
 * `env(safe-area-inset-*)` is load-bearing (D7): on iOS rotate-left the notch owns
 * the left 44px, so without the inset the play button hides behind it. Both sides
 * are padded (env() resolves to 0 on the non-notch side) so the layout doesn't
 * jump when the phone is flipped.
 */
export default function FocusCockpit({
  // Stage / video
  videoRef, videoUrl, handlers, clipRange, metadata,
  currentCropState, aspectRatio, rotation, onSetRotation,
  onCropChange, onCropComplete,
  zoom, panOffset, onZoomByWheel, onPanChange, selectedCropKeyframeIndex,
  isLoading, isProjectLoading, isVideoElementLoading, loadingProgress,
  loadingElapsedSeconds, loadingStage, error, isSourceExpired, canExtendSource,
  isUrlExpiredError, onRetryVideo,
  clipTitle, clipGameName, selectedClipEffectiveDuration, globalAspectRatio,
  // Transport
  currentTime, duration, isPlaying, togglePlay, stepForward, stepBackward,
  onExitToHome,
  // Timeline strip
  keyframes, framerate, seek,
  onKeyframeDelete, onKeyframeTimeMove, onCopyCrop,
  // Action rail
  canUndoFraming, onUndoFraming,
  framingCtaMode, onBackToPreview, backToPreviewLoading,
  // Settings sheet
  includeAudio, onIncludeAudioChange, onAspectRatioChange,
  // Clips sheet
  clipSidebarProps,
  // Trim sheet (the extracted framing timeline block)
  focusTimelineBlock,
  // Export machinery
  videoFile, getFilteredKeyframesForExport, getSegmentExportData,
  hasClips, clipsWithCurrentState, globalTransition, onProceedToOverlay,
  onExportComplete, saveCurrentClipState, exportButtonRef,
}) {
  const [activeSheet, setActiveSheet] = useState(null); // 'clips' | 'setup' | 'trim' | null
  const [previewing, setPreviewing] = useState(false);
  const [straightenVisible, setStraightenVisible] = useState(false);
  const [dimOpacity, setDimOpacity] = useState(0.2);

  // T10850 (D14): the first-entry card + the one-shot rings on Play and the CTA
  // are all driven by this single flag. `seen` is read lazily (never an effect);
  // `markSeen` is the named-gesture write, called by the card's "Got it" tap and
  // by the first pointerdown on the stage below — NEVER on render.
  const { seen: introSeen, markSeen: dismissIntro } = useCockpitIntroSeen();

  const closeSheet = () => setActiveSheet(null);

  // Export logic + modals live here so the compact rail CTA drives the SAME
  // container the full ActionBand uses, and App's payment-return / mode-switch
  // triggers still reach a live imperative handle (below).
  const exportCtrl = ExportButtonContainer({
    videoFile,
    cropKeyframes: getFilteredKeyframesForExport,
    highlightRegions: [],
    isHighlightEnabled: false,
    segmentData: getSegmentExportData?.(),
    disabled: !videoUrl,
    includeAudio,
    onIncludeAudioChange,
    onProceedToOverlay,
    clips: hasClips ? clipsWithCurrentState : null,
    globalAspectRatio,
    globalTransition,
    onExportComplete,
    saveCurrentClipState,
  });

  useImperativeHandle(exportButtonRef, () => ({
    triggerExport: () => exportCtrl.handleExportRef.current?.(),
    isExporting: exportCtrl.isExporting,
    isCurrentlyExporting: exportCtrl.isCurrentlyExporting,
  }), [exportCtrl.handleExportRef, exportCtrl.isExporting, exportCtrl.isCurrentlyExporting]);

  // Output-aspect moving preview (D-preview / T9950): a re-framing of the SAME
  // player, computed at zoom=1 so the editor's inspection zoom never leaks in.
  const { rect: previewRect } = useVideoDisplayRect(videoRef, metadata, {
    zoom: 1, panOffset: ZERO_PAN, isFullscreen: false,
  });
  const previewTransform = useMemo(() => {
    if (!previewing || !previewRect) return null;
    return computeOutputPreviewTransform({
      crop: currentCropState,
      displayRect: previewRect,
      containerWidth: previewRect.width + 2 * previewRect.offsetX,
      containerHeight: previewRect.height + 2 * previewRect.offsetY,
    });
  }, [previewing, previewRect, currentCropState]);

  const ctaMode = framingCtaMode === 'preview' ? 'preview' : 'generate';
  const outputLabel = selectedClipEffectiveDuration != null
    ? `Output ${formatLength(selectedClipEffectiveDuration, PRECISION.SECOND, { style: 'clock' })}`
    : null;

  const addFocusPointAtPlayhead = () => {
    if (!currentCropState) return;
    onCropComplete?.({
      x: currentCropState.x,
      y: currentCropState.y,
      width: currentCropState.width,
      height: currentCropState.height,
    });
  };

  return (
    <div
      data-testid="focus-cockpit"
      // z: the cockpit is the full-bleed EDITOR surface, not an app overlay — it
      // only has to cover the in-flow editor + the (normal-flow, un-z'd)
      // UnifiedHeader, and must sit BELOW every app overlay so they cover it: the
      // completion preview (Z.PLAYER, D15 — "the preview already covers the
      // cockpit"), the framing-changed exit dialog (Z.MODAL), toasts (Z.TOAST).
      // The design's literal `z-[100]` (= Z.TOAST) contradicted D15 by out-stacking
      // all of them; Z.DROPDOWN is the highest app rung still below Z.MODAL. The
      // cockpit's own sheets/BuyCreditsModal live inside this stacking context and
      // are unaffected.
      className={`fixed inset-x-0 top-0 ${Z.DROPDOWN} flex h-dvh overflow-hidden bg-black`}
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <TransportRail
        isPlaying={isPlaying}
        currentTime={currentTime}
        togglePlay={togglePlay}
        stepForward={stepForward}
        stepBackward={stepBackward}
        onExitToHome={onExitToHome}
        ring={!introSeen}
      />

      {/* Center column: stage over the timeline strip */}
      <div data-testid="cockpit-stage" className="relative flex min-w-0 flex-1 flex-col">
        {/* T10850 (D14): the first touch on the stage is the OTHER dismissal gesture
            for the intro card. Attached to the stage's own pointer handling (not a
            competing document listener); only live while the card is showing so it
            never writes on an ordinary later tap. */}
        <div
          className="relative min-h-0 flex-1 bg-black"
          onPointerDown={introSeen ? undefined : dismissIntro}
        >
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={videoUrl}
            handlers={handlers}
            clipRange={clipRange}
            muted={!includeAudio}
            allowUpload={false}
            fitToAspect
            contentTransform={previewing ? previewTransform : null}
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
                  zoom={previewing ? 1 : zoom}
                  panOffset={previewing ? ZERO_PAN : panOffset}
                  selectedKeyframeIndex={selectedCropKeyframeIndex}
                  isFullscreen={false}
                  dimOpacity={dimOpacity}
                  interactive
                  chromeHidden={previewing}
                />
              ),
            ].filter(Boolean)}
            zoom={previewing ? 1 : zoom}
            panOffset={previewing ? ZERO_PAN : panOffset}
            onZoomChange={onZoomByWheel}
            onPanChange={onPanChange}
            isFullscreen={false}
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
              loadingStage === 'clips' ? 'Loading clips...'
                : loadingStage === 'video' ? 'Loading video...'
                : loadingStage === 'working-video' ? 'Loading working video...'
                : isLoading ? 'Loading video...' : 'Loading...'
            }
          />

          {/* Passive overlay chips (never controls, §7). */}
          {clipTitle && (
            <div className="pointer-events-none absolute left-2 top-2 max-w-[55%] truncate rounded bg-black/65 px-2 py-1 text-xs text-gray-200">
              {clipTitle}
              {clipGameName && <span className="text-gray-400"> · {clipGameName}</span>}
            </div>
          )}
          {outputLabel && (
            <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-2 py-1 text-xs text-gray-200">
              {outputLabel}
            </div>
          )}

          {/* T10850 (D14): first-entry card, over the stage. Gated on `!introSeen`
              (cockpit && !seen); "Got it" and the stage pointerdown above both call
              the same named-gesture write. */}
          {!introSeen && <CockpitIntroCard onDismiss={dismissIntro} />}
        </div>

        <CockpitTimelineStrip
          keyframes={keyframes}
          currentTime={currentTime}
          duration={duration}
          framerate={framerate}
          onSeek={seek}
          onAddFocusPoint={addFocusPointAtPlayhead}
          onOpenTrim={() => setActiveSheet('trim')}
          onKeyframeTimeMove={onKeyframeTimeMove}
          onKeyframeDelete={onKeyframeDelete}
          onCopyCrop={onCopyCrop}
        />
      </div>

      <ActionRail
        activeSheet={activeSheet}
        onOpenClips={() => setActiveSheet(activeSheet === 'clips' ? null : 'clips')}
        onOpenSetup={() => setActiveSheet(activeSheet === 'setup' ? null : 'setup')}
        canUndo={canUndoFraming}
        onUndo={onUndoFraming}
        previewing={previewing}
        onTogglePreview={() => setPreviewing((v) => !v)}
        ctaMode={ctaMode}
        estimatedCredits={exportCtrl.estimatedCredits}
        ctaDisabled={exportCtrl.isButtonDisabled}
        ctaExporting={exportCtrl.isCurrentlyExporting}
        onGenerate={exportCtrl.handleExport}
        onBackToPreview={onBackToPreview}
        backToPreviewLoading={backToPreviewLoading}
        ring={!introSeen}
      />

      {/* Zone E — side sheets. Clips + Setup reuse the existing panels verbatim;
          Trim hosts the extracted framing timeline block (segment/speed/trim). */}
      <CockpitSheet open={activeSheet === 'clips'} title={FOCUS_COCKPIT.SHEET_CLIPS} onClose={closeSheet}>
        {clipSidebarProps && (
          <ClipSelectorSidebar
            {...clipSidebarProps}
            onSelectClip={(id) => { clipSidebarProps.onSelectClip?.(id); closeSheet(); }}
          />
        )}
      </CockpitSheet>

      <CockpitSheet open={activeSheet === 'setup'} title={FOCUS_COCKPIT.SHEET_SETUP} onClose={closeSheet}>
        <div className="p-2">
          <FocusSettingsPanel
            globalAspectRatio={globalAspectRatio}
            onAspectRatioChange={onAspectRatioChange}
            includeAudio={includeAudio}
            onIncludeAudioChange={onIncludeAudioChange}
            straightenVisible={straightenVisible}
            onToggleStraighten={() => setStraightenVisible((v) => {
              const next = !v;
              if (!next) onSetRotation?.(0);
              return next;
            })}
            dimOpacity={dimOpacity}
            onToggleDim={() => setDimOpacity(dimOpacity === 0.2 ? 0.7 : 0.2)}
            desktopOnly={false}
          />
          {exportCtrl.estimatedCredits != null && (
            <p className="px-1 pt-3 text-xs text-gray-400">
              {`~${exportCtrl.estimatedCredits} credit${exportCtrl.estimatedCredits === 1 ? '' : 's'} · balance ${exportCtrl.creditBalance}`}
            </p>
          )}
        </div>
      </CockpitSheet>

      <CockpitSheet open={activeSheet === 'trim'} title={FOCUS_COCKPIT.SHEET_TRIM} onClose={closeSheet}>
        <div className="p-2">{focusTimelineBlock}</div>
      </CockpitSheet>

      {exportCtrl.showBuyCredits && (
        <Suspense fallback={null}>
          <BuyCreditsModal
            onClose={() => { exportCtrl.onCloseBuyCredits(); exportCtrl.onCloseInsufficientCredits(); }}
            onPaymentSuccess={exportCtrl.onPaymentSuccess}
            insufficientCredits={exportCtrl.showInsufficientCredits}
          />
        </Suspense>
      )}
    </div>
  );
}
