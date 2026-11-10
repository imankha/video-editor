import Guide from '../components/instructions/Guide';
import { resolveGuide } from '../components/instructions/resolveGuide';
import { GUIDE_PULSE } from '../components/instructions/guideTargets';
import { GuideScope } from '../components/instructions/GuideScope';
import ActionCard from '../components/shared/ActionCard';
import { annotateFacts } from '../components/instructions/catalog';
import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Plus, Pencil, Share2, ArrowLeft, Minimize, Clock, Users, ListVideo, Lock, SlidersHorizontal } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { VideoLoadingOverlay } from '../components/shared/VideoLoadingOverlay';
import { AnnotateMode, AnnotateControls, NotesOverlay, AnnotateFullscreenOverlay } from './annotate';
import { overlayRegionAtPlayhead } from './annotate/regionAtTime';
import SourceBar from './annotate/SourceBar';
import FixTimingStrip from './annotate/FixTimingStrip';
import AddFootageButton from './annotate/AddFootageButton';
import { SuggestedPlaysPanel, VeoAlignCard } from './annotate/components/SuggestedPlaysPanel';
import { SportQuestionOverlay } from './annotate/components/SportQuestionOverlay';
import { displayRating } from '../components/shared/clipConstants';
import { ANNOTATE, ANNOTATE_COCKPIT, SHARING } from '../config/displayNames';
import AnnotateTransportStrip from './annotate/cockpit/AnnotateTransportStrip';
import AnnotateActionStrip from './annotate/cockpit/AnnotateActionStrip';
import AnnotateSideSheet from './annotate/cockpit/AnnotateSideSheet';
import { PlaysOnlyPanel } from '../components/PlaysOnlyPanel';
import { UploadPreviewNotice } from '../components/UploadPreviewNotice';
import { NO_SPORT } from './annotate/constants/tagRegistry';
import { getClipStage, getClipStages, isFramingExportInProgress, CLIP_STAGE } from './annotate/clipStage';
import { HighlightEntry, HighlightList } from './annotate/components/HighlightOrientationSlots';
import { useCurrentProfile, useProfileStore, useProjectsList, useProjectsStore } from '../stores';
import { useExportStore } from '../stores/exportStore';
import PlaybackControls from './annotate/components/PlaybackControls';
import { generateClipName } from '../utils/clipDisplayName';
import { clipGameClock } from '../utils/timeFormat';
import { formatFileSize } from '../utils/fileValidation';
import { useIsMobile, useIsLandscape } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import { useSkipTap } from './annotate/hooks/useSkipTap';
import { SkipRipple } from './annotate/components/SkipRipple';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { Button, toast } from '../components/shared';

/**
 * AnnotateModeView - Complete view for Annotate mode
 *
 * Two sub-modes:
 * 1. Annotating (default) — normal video player, timeline, clip editing
 * 2. Playback — dual-video ping-pong, virtual timeline, NotesOverlay per clip
 */

// T10800: the non-fullscreen Annotate stage boxes (single-video, multi-video and
// playback/recap) are aspect-fit — mirrors Overlay's useAspectStage (T5676) — so
// `object-contain` never leaves letterbox bands. The box's shape comes from the
// inline `aspectRatio` style (see `stageAspectStyle`); these classes size it:
// `max-h-[60vh]` at ALL widths caps a tall 9:16 phone source so the timeline
// stays reachable, and `lg:w-fit lg:h-[60vh]` pins the desktop height (width
// derived from the ratio) so a landscape source is never TALLER than today's box.
// T13020: on a desktop that is not tall (<= 950px: 1440x900, 1024x768) the 60vh box pushed Mark play, the
// Make highlight slots, Done and Share plays below the first viewport, so the guide could not cut them out.
// A shorter box there keeps the action band on screen; `!` because the lg: pair above has equal specificity.
// T13170: at 1024x768 the 40vh box still left Mark play below the fold, so a desktop <= 800px tall gets 28vh.
// The two height ranges are disjoint: both rules are `!important` arbitrary media variants, so overlap would let
// CSS source order (not the narrower range) decide.
// T15460: every SHORT_DESKTOP_* query now also requires `(hover:hover) and (pointer:fine)` -- a real mouse,
// the opposite of useIsMobile's `(hover:none) and (pointer:coarse)`. Without this an iPad gen 7 landscape
// (1024x768, coarse pointer, no hover) matched the 1024x768 short-desktop range too, forcing its stage box
// down to 21vh even though the device has plenty of height and its own mobile layout (drawer plays panel)
// already left the width free -- that was AC2's "wastes space on iPad" bug. A touchscreen laptop keeps the
// desktop behavior (its primary pointer is still the mouse).
const SHORT_DESKTOP_STAGE_CLASS = '[@media(min-width:1024px)_and_(min-height:801px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:!h-[34vh] [@media(min-width:1024px)_and_(min-height:801px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:!max-h-[34vh] [@media(min-width:1024px)_and_(max-height:800px)_and_(hover:hover)_and_(pointer:fine)]:!h-[21vh] [@media(min-width:1024px)_and_(max-height:800px)_and_(hover:hover)_and_(pointer:fine)]:!max-h-[21vh]';
// T13170: on the same short desktops the action-tile row (Mark play, Review plays, Share plays, Add footage)
// drops to short cards (descriptions screen-reader only, Mark play keeps its capture hint) and the gaps around
// the timeline tighten, so the row fits the first viewport at 1440x900 and 1024x768. T15460: hover/pointer-fine
// gated, see SHORT_DESKTOP_STAGE_CLASS above.
const SHORT_DESKTOP_TILES_CLASS = '[@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&>button]:!min-h-0 [@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&>button]:!p-3 [@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&>button]:!gap-1.5 [@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&_[data-cta-disc]]:!h-8 [@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&_[data-cta-disc]]:!w-8 [@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&_[data-cta-desc]]:sr-only [@media(min-width:1024px)_and_(max-height:800px)_and_(hover:hover)_and_(pointer:fine)]:[&>button]:!flex-row [@media(min-width:1024px)_and_(max-height:800px)_and_(hover:hover)_and_(pointer:fine)]:[&>button]:!flex-wrap [@media(min-width:1024px)_and_(max-height:800px)_and_(hover:hover)_and_(pointer:fine)]:[&>button]:!gap-x-2';
const SHORT_DESKTOP_GAP_CLASS = '[@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:!mt-3';
// T13530: a 2-video game adds the Videos row and a Video lane, so the T13170 caps alone left the
// tiles ~77px (1440x900) / ~127px (1024x768) below the fold. Tighten the panel padding and the
// timeline block's vertical padding at the same short-desktop breakpoint.
const SHORT_DESKTOP_PANEL_CLASS = '[@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:!p-3';
const SHORT_DESKTOP_TIMELINE_CLASS = '[@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&_.timeline-container]:!py-1 [@media(min-width:1024px)_and_(max-height:950px)_and_(hover:hover)_and_(pointer:fine)]:[&_.timeline-container]:[&>div:first-child]:!mb-0.5';
// T15460 (AC1): a phone in landscape OUTSIDE fullscreen (max-height:500px, same range
// useIsLandscape treats as phone-cockpit, but width-capped so a short desktop window doesn't
// also match) stacks the full desktop layout -- 60vh-capped stage, transport, zoom, timeline,
// 2x2 CTA grid -- into ~390px of height with nothing to shrink it, pushing Mark play off
// screen (bug: Mark play at y388 of 390 even scrolled to max). These mirror SHORT_DESKTOP_*'s
// compaction but at this width/orientation range instead, using dvh (stable across mobile
// browser chrome show/hide) rather than vh.
const PHONE_LANDSCAPE_STAGE_CLASS = '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!h-[12dvh] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!max-h-[12dvh]';
// T15460 AC1: on top of the shrinks below, the CTA tiles go horizontal (icon beside title,
// description + capture-window hint hidden) instead of stacked, so the primary CTA row doesn't
// need its full stacked-card height on a 390px-tall viewport.
const PHONE_LANDSCAPE_TILES_CLASS = '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!grid-cols-4 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&>button]:!min-h-0 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&>button]:!flex-row [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&>button]:!items-center [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&>button]:!justify-center [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&>button]:!p-1.5 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&>button]:!gap-1.5 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_[data-cta-disc]]:!h-6 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_[data-cta-disc]]:!w-6 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_[data-cta-desc]]:sr-only [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_[data-testid=annotate-capture-window-hint]]:sr-only';
const PHONE_LANDSCAPE_GAP_CLASS = '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!mt-1';
const PHONE_LANDSCAPE_PANEL_CLASS = '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!p-1';
const PHONE_LANDSCAPE_TIMELINE_CLASS = '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_.timeline-container]:!py-0 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_.timeline-container]:[&>div:first-child]:!mb-0 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_.timeline-container]:relative [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_.timeline-container>div:first-child]:!absolute [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_.timeline-container>div:first-child]:!top-0 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_.timeline-container>div:first-child]:!right-1 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_.timeline-container>div:first-child]:!z-10';
// T15460 AC1: the mini-map scrollbar (TimelineBase's `mobile-scrollbar-track`, 44px min-height
// plus mt-2/mb-3 margins) below the zoomed timeline is a nicety, not required to use Mark play;
// hiding it via a descendant selector (no `hideScrollbar` prop threading -- CSS-only, matching
// every other SHORT_DESKTOP_*/PHONE_LANDSCAPE_* compaction here) recovers real height on a
// 390px viewport.
const PHONE_LANDSCAPE_HIDE_SCROLLBAR_CLASS = '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:[&_[data-testid=mobile-scrollbar-track]]:!hidden';
const STAGE_ASPECT_BOX_CLASS = `mx-auto w-full max-w-full max-h-[60vh] lg:w-fit lg:h-[60vh] lg:max-h-[60vh] ${SHORT_DESKTOP_STAGE_CLASS} ${PHONE_LANDSCAPE_STAGE_CLASS}`;
// The ONE surviving fixed-height letterbox box — used ONLY when the video's
// dimensions are genuinely unknown (a legacy game row with NULL video_width /
// video_height, resolved to `stageAspect === null`). This is the explicit,
// warned "dimensions unknown" branch, not a silent 16/9 coercion.
const STAGE_UNKNOWN_DIMS_CLASS = `h-[40vh] sm:h-[60vh] ${SHORT_DESKTOP_STAGE_CLASS} ${PHONE_LANDSCAPE_STAGE_CLASS}`;

// No region at the playhead means no badge; a region with no rating shows as Good.
const annotatePlaybackRating = (region) => (region ? displayRating(region.rating) : null);

// T15630: per-game, per-device dismissal of the "What sport is this?" question
// (see the sportPromptDismissedForGame state below for the full rationale).
const SPORT_PROMPT_DISMISSED_KEY_PREFIX = 'rb.annotate.sportPromptDismissed.';

function readSportPromptDismissed(gameId) {
  if (gameId == null) return false;
  try {
    return localStorage.getItem(`${SPORT_PROMPT_DISMISSED_KEY_PREFIX}${gameId}`) === '1';
  } catch {
    // Private-mode / storage-disabled: treat as not-yet-dismissed, never throw.
    return false;
  }
}

function writeSportPromptDismissed(gameId) {
  if (gameId == null) return;
  try {
    localStorage.setItem(`${SPORT_PROMPT_DISMISSED_KEY_PREFIX}${gameId}`, '1');
  } catch {
    // Persist is best-effort; a failed write just means it reappears later.
  }
}

export function AnnotateModeView({
  // Video control
  videoController,
  annotateVideoUrl,
  annotateVideoMetadata,
  // T10800: the game row's video_width/video_height (raw, from GET /api/games/{id}),
  // kept separate from annotateVideoMetadata so the stage box can be aspect-shaped
  // BEFORE the <video> element has loaded its own dimensions (no layout jump on
  // load), and even when metadata is null (a row with dims but no probed duration).
  gameVideoWidth,
  gameVideoHeight,
  // T10800: identifies the game for the explicit unknown-dimensions warning.
  gameId,
  annotateContainerRef,
  currentTime,
  duration,
  isPlaying,
  isLoading = false,
  // The game's plays have not arrived yet: resolving a guide from "0 plays" would flash the wrong one.
  holdGuide = false,
  isVideoElementLoading = false,
  loadingProgress = null,
  loadingElapsedSeconds = 0,
  error = null,
  isUrlExpiredError = () => false,
  onRetryVideo,
  // bug 27p: game's source video expired (R2 source hard-deleted post-grace).
  // Render a deliberate expired state instead of a broken/hanging player; the
  // clips sidebar keeps the annotations readable.
  isSourceExpired = false,
  // T12930: game kept for its marked plays only: panel instead of the player, Mark play off.
  isPlaysOnly = false,
  // T14370: /load in flight (AnnotateContainer.isGameDataLoading). The card is on
  // screen seconds before the game's data lands; a tap in that window has no
  // duration or no game id to save against, so Mark play is off until then.
  isLoadingGameData = false,
  onRestorePlaysOnly,
  // This game's upload hasn't finished: no highlight can be made from it yet.
  isGameUploading = false,
  // T13390: this game's upload failed; the guide names the banner's Retry upload.
  isGameUploadFailed = false,
  handlers,

  // Fullscreen state
  annotateFullscreen,
  showAnnotateOverlay,

  // Playback
  togglePlay,
  stepForward,
  stepBackward,
  seekForward,
  seekBackward,
  restart,
  seek,
  onTimelineSeek, // Seek + close overlay if target outside clips (timeline gesture)
  annotatePlaybackSpeed,
  onSpeedChange,

  // Clips/regions
  annotateRegionsWithLayout,
  annotateSelectedRegionId,
  hasAnnotateClips,
  // T11860: first-run disclosure, derived + owned by AnnotateScreen (the layer
  // filter lives in the sibling ClipsSidePanel, so the reveal state must sit above
  // both). isFirstRun = game data loaded and 0 plays (drives the phone zoom default);
  // simplifiedControls = isFirstRun and not yet revealed. Memory only, never persisted.
  isFirstRun = false,
  simplifiedControls = false,
  onShowAllControls,
  clipRegions,
  isEditMode,

  // Handlers
  onSelectRegion,
  onDeleteRegion,
  onToggleFullscreen,
  onAddClip,
  getAnnotateRegionAtTime,

  // Fullscreen overlay handlers
  onFullscreenUpdateClip,
  onOverlayClose,
  // T11130: Done -> "Make this a highlight now?" choice card — state + handlers
  // owned by AnnotateContainer. showHighlightChoice per overlay is derived from
  // highlightChoice.regionId === existingClip.id at each render site.
  highlightChoice,
  onHighlightChoiceNow,
  onHighlightChoiceLater,
  onHighlightChoiceDismiss,
  // T10610 § D.3: deletes the play the editor is open on.
  onDeletePlayFromEditor,
  // T10610 § C.4: awaited before navigating into Framing/Spotlight, both from
  // the editor's own stage CTA (threaded through as onAwaitWrites) and from
  // this view's own highlight rows (handleOpenInstance).
  onAwaitRegionWrites,
  // T10610 § C.5: 'idle' | 'saving' | 'saved' | 'error' — drives the editor's
  // SaveStatusBadge now that there is no Save button.
  writeStatus = 'idle',

  // Layer selection
  annotateSelectedLayer,
  onLayerSelect,

  // T710: Annotation playback
  playback,
  lockScrub,
  unlockScrub,

  // Zoom (for video player)
  zoom,
  panOffset,
  onZoomChange,
  onPanChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  MIN_ZOOM,
  MAX_ZOOM,
  // T2750: Multi-video scrub
  multiVideo,
  boundaryOffsets,
  // T2820: Share with tagged players (opens ShareWithTeammatesModal). T9810:
  // this is its OWN affordance now, rendered only when hasTaggedClips is true so
  // it never silently no-ops (the modal only renders when tagged clips exist).
  onShare,
  hasUnsentShares,
  hasTaggedClips = false,
  teammateSuggestions = [],
  // T2905: Share annotated playback (game invitations — opens SharePlaybackDialog).
  // T9810: this is now the primary "Share plays" action on every surface.
  onSharePlayback,
  // T8600: desktop strip only — opens the clip's project in Focus mode.
  onOpenClipInFocus,
  // T9330: opens the clip's project in Spotlight (Overlay mode) for the strip's
  // stage CTA.
  onOpenClipInOverlay,
  onOpenClipPreview,
  // T8890: angle strip + source switching (null for angle-free games)
  angleData = null,
  // T13280: the Videos control (null for single-video games)
  sourceBar = null,
  videoLane = null,
  // T8900: Fix-timing strip data (null unless the mode is open)
  fixTiming = null,
  // T8910: Add footage from inside Annotate
  addFootage = null,
  // T13220: Veo suggested plays bundle (useAnnotateSuggestions), null until a game id exists
  suggested = null,
}) {
  // T8892: display name of the active NON-backbone angle, or null. Drives the
  // Add/Edit Play editor's "cut from {angle}" chip so the user knows which camera
  // this play will be cut from. Null for backbone / angle-free games (chip = zero
  // pixels), keeping angle-free editors byte-identical.
  const activeSourceName = useMemo(() => {
    if (!angleData || angleData.activeSourceSequence == null) return null;
    return angleData.angles.find(a => a.sequence === angleData.activeSourceSequence)?.name ?? null;
  }, [angleData]);

  // T9480 review fix (MAJOR #5, design section 2.6): when an angle is active,
  // the true media bound for typed entry/step-button trim editing is the
  // ANGLE'S OWN virtual span, not the whole backbone timeline (EPIC decision
  // 10: a clip is cut from ONE source). Reuses buildGameTimeline's own
  // angles[].virtualStart/virtualEnd (the SAME values clampToSource derives
  // from) -- no second source-clamping implementation. Null for backbone /
  // angle-free games, so ClipScrubRegion falls back to the whole-timeline
  // bound exactly as before (byte-identical for every non-overlap game).
  const activeSourceMediaBounds = useMemo(() => {
    if (!angleData || angleData.activeSourceSequence == null) return null;
    const angle = angleData.angles.find(a => a.sequence === angleData.activeSourceSequence);
    return angle ? { mediaStart: angle.virtualStart, mediaEnd: angle.virtualEnd } : null;
  }, [angleData]);

  // Derive existingClip from state machine's selectedRegionId.
  // EDITING(clipId) keeps the ID stable during scrub, so no frozen ref needed.
  const existingClip = useMemo(() => {
    if (!annotateSelectedRegionId || !showAnnotateOverlay) return null;
    return clipRegions?.find(r => r.id === annotateSelectedRegionId) || null;
  }, [annotateSelectedRegionId, showAnnotateOverlay, clipRegions]);

  // T10310 (2026-09-18 user request): the SELECTED region, NOT gated on the
  // overlay being open (unlike existingClip above) — drives the main screen's
  // split [Edit Play]/[Frame Clip] row, so Frame Clip is reachable the moment
  // a play is selected, without opening the fullscreen editor first. Same
  // getClipStage + useProjectsList lookup AnnotateFullscreenOverlay/
  // ClipDetailsEditor already use (single source, not a re-derivation).
  const selectedRegion = useMemo(() => {
    if (!annotateSelectedRegionId) return null;
    return clipRegions?.find(r => r.id === annotateSelectedRegionId) || null;
  }, [annotateSelectedRegionId, clipRegions]);
  const projectsList = useProjectsList();
  const activeExports = useExportStore(state => state.activeExports);
  const selectedRegionFraming = isFramingExportInProgress(activeExports, selectedRegion?.autoProjectId);
  // T11430: the collection of highlight instances for the selected play
  // (orientation-qualified statuses + per-instance CTAs), rendered by the
  // T11910 orientation slots. Empty
  // `highlightInstances` (legacy single-pointer regions) yields zero
  // instances and a primaryCta identical to the pre-T11430 "Make Highlight"
  // behavior, so this does not change existing single-instance callers.
  const regionStages = selectedRegion
    ? getClipStages(selectedRegion, selectedRegion.highlightInstances || [], { activeExports })
    : null;
  // T14770: the one portrait instance resolveGuide tracks (catalog.annotateFacts);
  // the row the guide pulses when its anchor is overridden onto a specific row.
  const portraitHighlightInstance = regionStages?.instances?.find(
    (i) => i.orientation === 'portrait' && i.projectId != null
  ) ?? null;
  const guide = holdGuide ? null : resolveGuide(annotateFacts(selectedRegion, regionStages?.instances, {
    isPlaying: !!(playback?.isPlaybackMode ? playback.isPlaying : isPlaying),
    playCount: clipRegions?.length ?? 0,
    editorOpen: !!showAnnotateOverlay,
    choiceOpen: !!highlightChoice && highlightChoice.regionId === selectedRegion?.id && !!showAnnotateOverlay,
    reviewing: !!playback?.isPlaybackMode,
    expired: !!(isSourceExpired || isPlaysOnly),
    uploading: !!isGameUploading,
    uploadFailed: !!isGameUploadFailed,
    generating: selectedRegionFraming,
  }));
  const coachKey = `${gameId}:${['brilliant', 'portrait', 'selectedNone'].includes(guide?.phase) ? selectedRegion?.id : 'watch'}:${guide?.phase}`;
  const [frameClipPending, setFrameClipPending] = useState(false);
  // T9830/T10240 convention: a synchronously-set REF (not state) guards
  // against a double-fire from the two buttons sharing one create seam —
  // state alone would only take effect after a render round-trip.
  // `frameClipPending` (state) still drives the visible disabled/opacity.
  const frameCreateInFlightRef = useRef(false);
  // T11910: Make a highlight in a chosen orientation ('9:16' | '16:9'). Always
  // mints a NEW project (forceNew): the slot only offers Make when that
  // orientation has no highlight yet, and the non-force backend path can skip
  // creation when a play's auto_project_id points at a non-highlight project.
  // The synchronously-set ref guards a double-fire (state alone only takes
  // effect after a render round-trip); `frameClipPending` drives the disabled
  // look. Navigates straight into Framing, so the "in Clips" toast is silenced.
  const handleMakeHighlight = useCallback(async (aspectRatio) => {
    if (!selectedRegion || frameCreateInFlightRef.current) return;
    frameCreateInFlightRef.current = true;
    setFrameClipPending(true);
    try {
      const result = await onFullscreenUpdateClip(selectedRegion.id, {
        createProject: true,
        forceNew: true,
        silent: true,
        aspectRatio,
      });
      if (result?.saveOk && result.projectId) onOpenClipInFocus?.(result.projectId);
    } finally {
      frameCreateInFlightRef.current = false;
      setFrameClipPending(false);
    }
  }, [selectedRegion, onFullscreenUpdateClip, onOpenClipInFocus]);
  // Open an existing highlight at the stage it is at. T10610 § C.4: pure
  // navigation, so await the region's write chain first or a trim released just
  // before this click could lose the race.
  const handleOpenInstance = useCallback(async (instance) => {
    const ok = onAwaitRegionWrites ? await onAwaitRegionWrites(selectedRegion.id) : true;
    if (!ok) return;
    if (instance.action === 'overlay') onOpenClipInOverlay?.(instance.projectId);
    else if (instance.action === 'preview' || instance.action === 'published') {
      // T11430 review fix: preview/published need the FULL project shape
      // (final_video_id, aspect_ratio, name, clip_count, stale_share, ...)
      // openFinishedReel reads. The instance may be archived (so NOT in
      // projectsList); fetch it directly by id (no archived_at filter).
      const project = await useProjectsStore.getState().fetchProject(instance.projectId);
      if (!project) return;
      onOpenClipPreview?.(project, instance.action === 'published');
    } else onOpenClipInFocus?.(instance.projectId);
  }, [selectedRegion, onAwaitRegionWrites, onOpenClipInFocus, onOpenClipInOverlay, onOpenClipPreview]);
  // T11130: "Frame Later" removed with the T10450 main-screen Frame Now / Frame
  // Later create row. T11840: making a highlight is UNGATED on purpose (no
  // 5-star requirement), so a play of any rating (or none) can be made a
  // highlight from the main screen via the orientation slots below (T11910). The
  // rating + Done -> Highlight card is a second route to the same create seam.

  // T8760 item 10: while a clip is open for editing, the transport readout is
  // clip-relative (elapsed / clip-duration). Null outside clip-edit mode, so
  // the absolute game-time readout is unchanged there.
  const clipEditBounds = useMemo(
    () => (existingClip ? { start: existingClip.startTime, end: existingClip.endTime } : null),
    [existingClip],
  );

  // T4070/T4080: in-match soccer-notation clock (MM'SS") for a clip region, shown on the
  // NotesOverlay banner. Shared with the annotation clip lists via clipGameClock (T4080) so the
  // banner and the lists agree. boundaryOffsets are the per-half virtual starts; single-video
  // games have none, so the file-relative start is already the in-match position.
  const gameClockFor = useCallback(
    (clip) => clipGameClock(clip, boundaryOffsets),
    [boundaryOffsets],
  );

  const isPlaybackMode = playback?.isPlaybackMode;
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
  const fsControls = useFullscreenControls({ isPlaying });
  const playbackFsControls = useFullscreenControls({ isPlaying: playback?.isPlaying });
  const mobileFs = annotateFullscreen && isMobile;
  // T15380: portrait mobile fullscreen stopped being a full-bleed video with
  // an overlay sheet on top of it (option B) -- the video is pinned to the
  // top and the editor/controls render below it in normal flow. Landscape
  // keeps the full-bleed overlay surface (option C, the side-strip layout, is
  // the T15370 follow-up) with just the drag-peek/auto-hide fixes (option D).
  const mobileFsLandscape = mobileFs && isLandscape;
  // T15750: portrait mobile fullscreen with the Edit/Add play editor open --
  // the editor panel below the video must never be allowed to squeeze the
  // video past a usable size (AC1). See the video wrapper's min-height floor
  // and the portrait-strip editor's `shrink`/`max-h` below.
  const mobileFsPortraitEditorOpen = mobileFs && !isLandscape && showAnnotateOverlay;
  const [isDraggingScrub, setIsDraggingScrub] = useState(false);
  // T15370: the right strip's source chip toggles this sheet. Memory-only
  // view state, not persisted; resets implicitly when fullscreen/landscape
  // is left (the sheet simply stops rendering, no cleanup write needed).
  const [videosSheetOpen, setVideosSheetOpen] = useState(false);

  // T10930: timeline zoom lives HERE, not in AnnotateTimeline, because the
  // timeline is mounted at three sites (windowed / fullscreen strip / mobile
  // fullscreen) and remounts across them -- a zoom the user set must survive a
  // fullscreen toggle. Phone opens at 300% (T10780's density), desktop at 100%.
  // View state for the life of this screen; never persisted.
  // T11860: the phone default is 100% while the game has 0 plays and 300% from the
  // first play (T10780's reason for 300% only applies once plays exist); desktop
  // stays 100%. The hook follows the changed default unless the user moved the zoom.
  // Latch (same idea as AnnotateScreen's showAllControls): once this game has shown a
  // play, the phone default stays 300% even if the last play is deleted (isFirstRun
  // turns true again), so an untouched zoom does not drop back to 100% under the user.
  const [hasSeenPlays, setHasSeenPlays] = useState(hasAnnotateClips);
  if (hasAnnotateClips && !hasSeenPlays) setHasSeenPlays(true);
  const timelineZoomState = useTimelineZoom(isMobile && (hasSeenPlays || !isFirstRun) ? 300 : 100);
  // T11860: when the first play appears (isFirstRun true -> false), ask the
  // timeline to center the playhead (the new play). A render-phase transition
  // check on view state, not an effect and not a write.
  const [centerPlayheadKey, setCenterPlayheadKey] = useState(0);
  const [prevIsFirstRun, setPrevIsFirstRun] = useState(isFirstRun);
  if (prevIsFirstRun !== isFirstRun) {
    setPrevIsFirstRun(isFirstRun);
    if (prevIsFirstRun && !isFirstRun) setCenterPlayheadKey((k) => k + 1);
  }
  // T11860: fullscreen is a deliberate gesture that wants the full transport, so
  // the simplified chrome applies to the windowed layout only.
  const simplified = simplifiedControls && !annotateFullscreen;
  // T15370: the landscape cockpit is IS fullscreen (mobileFsLandscape implies
  // annotateFullscreen), so the windowed-only `simplified` above is always
  // false there -- its own strips read the raw flag instead, per the
  // approved design's test plan ("simplified hides frame-step and zoom").
  const cockpitSimplified = simplifiedControls;
  const timelineZoomProps = useMemo(() => ({
    timelineZoom: timelineZoomState.timelineZoom,
    zoomByWheel: timelineZoomState.zoomByWheel,
    zoomIn: timelineZoomState.zoomIn,
    zoomOut: timelineZoomState.zoomOut,
    resetZoom: timelineZoomState.resetZoom,
    setZoom: timelineZoomState.setZoom,
    defaultZoom: timelineZoomState.defaultZoom,
    // T15370: the cockpit's own 1x/3x toggle (AnnotateActionStrip) replaces the
    // chip there, so TimelineBase's internal chip is dropped the same way a
    // fresh game drops it.
    hideChip: simplified || mobileFsLandscape,
    centerPlayheadKey,
  }), [timelineZoomState.timelineZoom, timelineZoomState.zoomByWheel, timelineZoomState.zoomIn, timelineZoomState.zoomOut, timelineZoomState.resetZoom, timelineZoomState.setZoom, timelineZoomState.defaultZoom, simplified, mobileFsLandscape, centerPlayheadKey]);

  // T10800: ONE resolved aspect for every non-fullscreen Annotate stage box
  // (single-video, multi-video, and playback/recap), so all three read the same
  // value. Priority: the live <video> element's metadata -> the game row's
  // video_width/video_height (box shaped correctly before the picture loads) ->
  // null. There is deliberately NO 16-by-9 coercion (CLAUDE.md: no silent
  // fallbacks for internal data): a genuinely-unknown-dimensions game is an
  // EXPLICIT, warned branch (below) that keeps today's fixed letterbox box.
  const stageAspect = useMemo(() => {
    const mw = annotateVideoMetadata?.width;
    const mh = annotateVideoMetadata?.height;
    if (mw > 0 && mh > 0) return { width: mw, height: mh };
    if (gameVideoWidth > 0 && gameVideoHeight > 0) return { width: gameVideoWidth, height: gameVideoHeight };
    return null;
  }, [annotateVideoMetadata?.width, annotateVideoMetadata?.height, gameVideoWidth, gameVideoHeight]);
  const stageAspectStyle = stageAspect
    ? { aspectRatio: `${stageAspect.width} / ${stageAspect.height}` }
    : undefined;
  // Diagnostic-only (console, never a store/network write — not the banned
  // reactive-persistence effect): warn once per game when dimensions are unknown
  // so the fixed-box fallback is a named, greppable state rather than a silent
  // letterbox.
  useEffect(() => {
    if (!stageAspect && gameId != null) {
      console.warn(
        `[AnnotateModeView] Game ${gameId}: video dimensions unknown (no element ` +
        `metadata and no game row video_width/video_height). Falling back to the ` +
        `fixed-height letterbox stage box. Re-probe dimensions at upload finalize ` +
        `to enable the aspect-fit stage.`
      );
    }
  }, [stageAspect, gameId]);

  // T8600: the under-canvas editor (strip on desktop, inline sheet on mobile)
  // replaces the timeline + CTA/Playback/Share block below the video whenever
  // the add/edit overlay is open and we're not in fullscreen. `isMobile`
  // partitions the two device halves, so they're mutually exclusive by
  // construction — "two editors open at once" is impossible at this level.
  // `underCanvasEditor` stays !annotateFullscreen-scoped: it drives the
  // windowed-only timeline/CTA hides (below) which must NOT change in fullscreen.
  const underCanvasEditor = showAnnotateOverlay && !annotateFullscreen;
  // T9500: the desktop strip is now the SINGLE editor surface for BOTH windowed
  // and fullscreen desktop (fullscreen dropped its old side dock). Because this
  // is ONE strip element at ONE JSX position, toggling fullscreen preserves its
  // fiber, so an unsaved note + selected times survive the transition. Hence
  // this drops the `!annotateFullscreen` term the old `underCanvasEditor`-based
  // derivation carried.
  const desktopEditorOpen = showAnnotateOverlay && !isMobile;
  const mobileInlineForm = underCanvasEditor && isMobile;

  // T14350: YouTube double-tap / double-click skip on the video stage (both the
  // single- and multi-video stage boxes). Off while the play editor is open, the
  // same gate as the skip keys, so the playhead can't leave the clip span.
  const skipTap = useSkipTap({
    enabled: !showAnnotateOverlay,
    onSeekForward: seekForward,
    onSeekBackward: seekBackward,
  });

  // Full-screen "What sport is this?" question, shown at most once PER GAME at a
  // MOBILE user's first Mark-play tap while their profile is still no_sport.
  // Desktop keeps the in-form picker (it also has the top-bar sport control),
  // so the question is mobile-only — no double prompt. The answer persists
  // through the existing profile-sport gesture (updateProfile), never a new
  // write path.
  // T10610: this used to fire from the editor's create-mode Save gesture
  // (handleCreateClipWithSportPrompt wrapping onCreateClip); the create now
  // happens at the Mark play TAP itself (D2), so the prompt moves here. Guard
  // on "about to create" (no region selected, editor not already open) —
  // the same tap edits an existing SELECTED clip instead, which must never
  // trigger this first-clip question.
  // T15630: a skip must be remembered PER GAME, surviving a remount (leaving
  // Annotate and coming back, or a reload) — an in-memory ref reset on every
  // mount, re-asking the question on every return visit. This is a per-device
  // UI dismissal, not user data (never synced, same narrow exception as
  // RotateNudge's `rb.focus.rotateNudgeDismissed`, T10850/D14): localStorage,
  // read lazily, written only by the Pick/Skip gesture itself.
  const currentProfile = useCurrentProfile();
  const currentSport = currentProfile?.sport || NO_SPORT;
  const updateProfile = useProfileStore(state => state.updateProfile);
  const [sportQuestionOpen, setSportQuestionOpen] = useState(false);
  const [sportPromptDismissedForGame, setSportPromptDismissedForGame] = useState(
    () => readSportPromptDismissed(gameId)
  );
  const handleAddClipWithSportPrompt = useCallback(() => {
    const aboutToCreate = !annotateSelectedRegionId && !showAnnotateOverlay;
    onAddClip();
    if (aboutToCreate && isMobile && currentSport === NO_SPORT && !sportPromptDismissedForGame) {
      setSportQuestionOpen(true);
    }
  }, [onAddClip, annotateSelectedRegionId, showAnnotateOverlay, isMobile, currentSport, sportPromptDismissedForGame]);
  const dismissSportPromptForGame = useCallback(() => {
    setSportPromptDismissedForGame(true);
    writeSportPromptDismissed(gameId);
  }, [gameId]);

  // Playback fullscreen — independent from annotate fullscreen (CSS fixed positioning)
  const [playbackFullscreen, setPlaybackFullscreen] = useState(false);
  const togglePlaybackFullscreen = useCallback(() => {
    setPlaybackFullscreen(prev => !prev);
  }, []);
  // Exit fullscreen when leaving playback mode — sync active clip back to annotate selection
  const handleExitPlayback = useCallback(() => {
    const lastClipId = playback?.activeClipId;
    setPlaybackFullscreen(false);
    playback?.exitPlaybackMode();
    // Select the last-playing clip in annotate mode so sidebar stays in sync.
    // Lock scrub to suppress auto-deselect while the annotate video seeks to
    // the clip's start time (seek is async — without the lock, the auto-deselect
    // effect fires with the old currentTime and clears the selection).
    if (lastClipId && onSelectRegion) {
      lockScrub?.();
      onSelectRegion(lastClipId);
      // Unlock after the seek settles (video needs time to update currentTime)
      setTimeout(() => unlockScrub?.(), 500);
    }
  }, [playback, onSelectRegion, lockScrub, unlockScrub]);

  // Auto-enter playback fullscreen on mobile landscape
  const autoLandscapeFsRef = useRef(false);
  useEffect(() => {
    if (isMobile && isLandscape && isPlaybackMode && !playbackFullscreen) {
      setPlaybackFullscreen(true);
      autoLandscapeFsRef.current = true;
    }
    if (!isLandscape && playbackFullscreen && autoLandscapeFsRef.current) {
      setPlaybackFullscreen(false);
      autoLandscapeFsRef.current = false;
    }
  }, [isMobile, isLandscape, isPlaybackMode, playbackFullscreen]);

  // Escape key exits playback fullscreen
  useEffect(() => {
    if (!playbackFullscreen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setPlaybackFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [playbackFullscreen]);

  // In playback mode, find the active clip for NotesOverlay
  const activePlaybackClip = useMemo(() => {
    if (!isPlaybackMode || !playback?.activeClipId) return null;
    return clipRegions?.find(r => r.id === playback.activeClipId) || null;
  }, [isPlaybackMode, playback?.activeClipId, clipRegions]);
  // T10920: same getClipStage + useProjectsList lookup as the selected-region
  // CTA above, so the banner's published/clipped mark can never disagree with
  // the strip's stage CTA.
  // T11430: when the active clip has a highlight-instances collection,
  // prefer its primary/most-advanced instance's stage (published first) for
  // the on-video mark, so a published highlight's banner mark can never
  // disagree with the fact that it's published — falls back to the legacy
  // single-autoProjectId lookup when there is no instances collection.
  const activePlaybackClipStage = activePlaybackClip
    ? (activePlaybackClip.highlightInstances?.length
      ? getClipStages(activePlaybackClip, activePlaybackClip.highlightInstances, { activeExports })
          .instances.find((i) => i.stage === CLIP_STAGE.PUBLISHED)?.stage
        ?? getClipStages(activePlaybackClip, activePlaybackClip.highlightInstances, { activeExports }).instances[0]?.stage
        ?? null
      : getClipStage(
        activePlaybackClip,
        activePlaybackClip.autoProjectId ? projectsList.find(p => p.id === activePlaybackClip.autoProjectId) : null,
        { framingInProgress: isFramingExportInProgress(activeExports, activePlaybackClip.autoProjectId) },
      ).stage)
    : null;

  // --- PLAYBACK MODE ---
  // Single return tree — toggling fullscreen changes CSS classes, not DOM structure.
  // This prevents video elements from unmounting/remounting (which loses loaded source).
  if (isPlaybackMode && playback) {
    const activeLabel = playback.activeVideoLabel;
    const isFS = playbackFullscreen;

    const mobilePlaybackFs = isFS && isMobile;

    return (
      <GuideScope guides={[isFS ? null : guide]}>
      {!isFS && <UploadPreviewNotice gameId={gameId} />}
      <div
        className={isFS
          ? 'fixed inset-0 z-[100] bg-gray-900 flex flex-col'
          // T8970 item 4: distinct cyan treatment so Playback Annotations mode is
          // unmistakable vs the neutral-chrome annotate mode (green=create,
          // yellow=edit, violet=angle are taken; cyan/blue is the playback family).
          : 'bg-cyan-500/10 backdrop-blur-lg rounded-lg p-2 sm:p-6 border-2 border-cyan-400/40 ring-1 ring-cyan-400/20'
        }
        onMouseMove={mobilePlaybackFs ? playbackFsControls.handleInteraction : undefined}
      >
        {/* T8970 item 4: persistent mode badge — visible the WHOLE time the mode
            is active (inline in windowed mode, floated top-left in fullscreen),
            so the user always knows they are in Playback Annotations, not Annotate. */}
        <div className={isFS ? 'absolute top-2 left-2 z-30' : 'flex items-center mb-2 sm:mb-4'}>
          <span
            data-testid="playback-mode-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 text-xs font-semibold tracking-wide backdrop-blur-sm"
          >
            <ListVideo size={12} className="text-cyan-300" />
            {ANNOTATE.PREVIEW_PLAYS}
          </span>
        </div>
        {/* Video container */}
        <div className={isFS
          ? 'flex-1 min-h-0 flex items-center justify-center'
          : ''
        }>
          <div
            className={`relative bg-gray-900 ${isFS ? 'w-full' : 'rounded-lg'} overflow-hidden cursor-pointer`}
            onClick={mobilePlaybackFs ? () => { playback.togglePlay(); playbackFsControls.handleTapVideo(); } : () => playback.togglePlay()}
          >
            <div data-testid="annotate-review-video" className={`relative ${isFS ? (stageAspect ? 'w-full' : 'w-full h-full') : (stageAspect ? STAGE_ASPECT_BOX_CLASS : STAGE_UNKNOWN_DIMS_CLASS)}`}
              style={isFS ? {
                maxHeight: mobilePlaybackFs ? '100dvh' : 'calc(100dvh - 120px)',
                // T10800: routed through the shared resolved aspect (no 16-by-9
                // coercion); fullscreen keeps its own sizing otherwise untouched.
                ...(stageAspect ? { aspectRatio: `${stageAspect.width} / ${stageAspect.height}` } : {}),
              } : stageAspectStyle}
            >
              {/* Video A */}
              {/* T9510: author-supplied aria-label sits above the browser's
                  native accessible-name fallback, so an unlabeled <video> can no
                  longer leak Chromium's "Unable to play media" name to assistive
                  technology during the transient error window at load init.
                  aria-busy reflects the honest loading state; the inactive
                  crossfade element is aria-hidden so only the on-screen video is
                  exposed (no double announcement of the A/B pair). */}
              <video
                ref={playback.videoARef}
                aria-label={playback.isLoading ? ANNOTATE.GETTING_READY : ANNOTATE.WATCHING_PLAYS_LABEL}
                aria-busy={playback.isLoading}
                aria-hidden={activeLabel !== 'A'}
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  opacity: activeLabel === 'A' ? 1 : 0,
                  transition: 'opacity 80ms ease-in-out',
                  zIndex: activeLabel === 'A' ? 2 : 1,
                }}
                playsInline
                preload="auto"
                fetchpriority="high"
              />
              {/* Video B */}
              {/* T9510: same labeling as video A — see note above. */}
              <video
                ref={playback.videoBRef}
                aria-label={playback.isLoading ? ANNOTATE.GETTING_READY : ANNOTATE.WATCHING_PLAYS_LABEL}
                aria-busy={playback.isLoading}
                aria-hidden={activeLabel !== 'B'}
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  opacity: activeLabel === 'B' ? 1 : 0,
                  transition: 'opacity 80ms ease-in-out',
                  zIndex: activeLabel === 'B' ? 2 : 1,
                }}
                playsInline
                preload="auto"
                fetchpriority="high"
              />

              {/* Loading overlay */}
              {/* T9510: polite status region so init announces "Preparing..."
                  (a loading state) instead of a media error. */}
              {playback.isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30" role="status" aria-live="polite">
                  <div className="text-center">
                    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-gray-600 border-t-green-500" />
                    <p className="mt-3 text-sm text-gray-300">{ANNOTATE.GETTING_READY}</p>
                  </div>
                </div>
              )}

              {/* NotesOverlay for active clip */}
              {!playback.isLoading && activePlaybackClip && (() => {
                const displayName = activePlaybackClip.name ||
                  generateClipName(activePlaybackClip);
                return (displayName || activePlaybackClip.notes) ? (
                  <NotesOverlay
                    key="playback-notes"
                    name={displayName}
                    notes={activePlaybackClip.notes}
                    rating={activePlaybackClip.rating}
                    gameClock={gameClockFor(activePlaybackClip)}
                    clipStage={activePlaybackClipStage}
                    isVisible={true}
                    isFullscreen={isFS}
                    isMobile={isMobile}
                  />
                ) : null;
              })()}
            </div>
          </div>
        </div>

        {/* Controls — YouTube-style auto-hide on mobile fullscreen */}
        <div
          className={mobilePlaybackFs
            ? `absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${
                playbackFsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`
            : isFS ? 'shrink-0' : ''
          }
          onClick={mobilePlaybackFs ? (e) => e.stopPropagation() : undefined}
        >
          {mobilePlaybackFs && (
            <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10" />
          )}
          <PlaybackControls
            isPlaying={playback.isPlaying}
            virtualTime={playback.virtualTime}
            totalVirtualDuration={playback.timeline?.totalVirtualDuration || 0}
            segments={playback.timeline?.segments}
            activeClipId={playback.activeClipId}
            activeClipName={activePlaybackClip
              ? (activePlaybackClip.name || generateClipName(activePlaybackClip))
              : null}
            currentSegment={playback.getCurrentSegment()}
            onTogglePlay={playback.togglePlay}
            onRestart={playback.restart}
            onSeek={playback.seekVirtual}
            onSeekWithinSegment={playback.seekWithinSegment}
            onStartScrub={playback.startScrub}
            onEndScrub={playback.endScrub}
            playbackRate={playback.playbackRate}
            onPlaybackRateChange={playback.changePlaybackRate}
            isFullscreen={isFS}
            onToggleFullscreen={togglePlaybackFullscreen}
            videoController={playback.videoController}
          />
        </div>
        {/* Exit fullscreen button — mobile playback fullscreen */}
        {mobilePlaybackFs && (
          <div
            className={`absolute top-2 right-2 z-30 transition-opacity duration-300 ${
              playbackFsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={e => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              icon={Minimize}
              iconOnly
              onClick={togglePlaybackFullscreen}
              title="Exit fullscreen"
              className="bg-black/50 hover:bg-black/70"
            />
          </div>
        )}
      </div>

      {!isFS && <Guide guide={guide} phaseKey={coachKey} testId="annotate-guidance" />}
      {/* Back + Share buttons — prominent, below player (not in fullscreen) */}
      {!isFS && (
        <div className="mt-3 sm:mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* T12040: one primary per screen. Share plays leads; Back is the secondary. */}
            {onSharePlayback && (
              <ActionCard variant="primary" icon={Share2} title={SHARING.SHARE_PLAYS}
                description={ANNOTATE.SHARE_GAME_CARD} onClick={onSharePlayback}
                data-testid="annotate-share-plays" guideTarget={GUIDE_PULSE.SHARE_PLAYS} />
            )}
            <ActionCard variant={onSharePlayback ? 'secondary' : 'primary'} icon={ArrowLeft} title={ANNOTATE.BACK_TO_MARK_PLAYS}
              description={ANNOTATE.BACK_TO_GAME_CARD} onClick={handleExitPlayback} />
          </div>
        </div>
      )}
      </GuideScope>
    );
  }

  // --- ANNOTATING MODE (default) ---
  // T12740: fullscreen is the one non-redundant pulse suppressor (the rest outrank by rule order); T12760: except the editor, whose Done/choice pulses live in it.
  return (
    <GuideScope guides={[annotateFullscreen && !showAnnotateOverlay ? null : guide]}>
      {/* T9430: honest upload-state banner next to the local preview: never "saved online"
          while the upload is in flight or has failed. Isolated component so its per-tick
          re-render never reaches AnnotateScreen's redirect/restore effects (T7280 landmine).
          T13390: inside the guide scope so a failed upload's guide can pulse Retry upload. */}
      <UploadPreviewNotice gameId={gameId} />
      {/* Video Metadata (resolution/format/size) moved 2026-09-18 (user request)
          to a de-emphasized footer below the bottom CTA (Review plays/Share
          plays) -- see the end of this component. */}

      {/* Main Editor Area */}
      {(!annotateFullscreen || showAnnotateOverlay) && (
        <Guide guide={guide} phaseKey={coachKey} testId="annotate-guidance" />
      )}
      <div data-testid="annotate-coach-stage" className={`${annotateFullscreen ? '' : `bg-white/10 backdrop-blur-lg rounded-lg p-2 sm:p-6 border border-white/20 ${SHORT_DESKTOP_PANEL_CLASS} ${PHONE_LANDSCAPE_PANEL_CLASS}`}`}>
        {/* Fullscreen container - uses fixed positioning for fullscreen.
            T15370: landscape is a CSS grid (56px left strip | picture | 72px
            right strip, with an auto-height timeline row under the picture)
            instead of a full-bleed surface with controls drawn on top. */}
        <div
          ref={annotateContainerRef}
          data-covers-header={mobileFsLandscape ? '' : undefined}
          className={`${annotateFullscreen ? (
            mobileFsLandscape
              ? 'fixed inset-x-0 top-0 h-dvh z-[100] bg-black grid grid-cols-[56px_minmax(0,1fr)_72px] grid-rows-[minmax(0,1fr)_auto] overflow-hidden'
              : 'fixed inset-0 z-[100] bg-gray-900 flex flex-col'
          ) : ''}`}
          style={mobileFsLandscape ? {
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          } : undefined}
          onMouseMove={mobileFs && !mobileFsLandscape ? fsControls.handleInteraction : undefined}
        >
          {/* T15370: the left transport strip. row-span-2 so it reaches the
              full height past the timeline row too. */}
          {mobileFsLandscape && (
            <AnnotateTransportStrip
              className="row-span-2"
              isPlaying={isPlaying}
              onTogglePlay={togglePlay}
              onStepForward={stepForward}
              onStepBackward={stepBackward}
              onSeekForward={seekForward}
              onSeekBackward={seekBackward}
              onExit={onToggleFullscreen}
              editorOpen={showAnnotateOverlay}
              simplified={cockpitSimplified}
            />
          )}
          {/* Video Player with annotate overlays. T15380: portrait mobile
              fullscreen is pinned to the top (flex-1 min-h-0, same sizing as
              desktop fullscreen) with the editor/controls as in-flow siblings
              below. T15370: landscape mobile fullscreen now sits in the
              grid's center column/top row (never the whole container) -- the
              strips beside it never cost it any picture height. */}
          <div
            data-testid="annotate-video-wrapper"
            className={`relative bg-gray-900 ${
              annotateFullscreen
                ? mobileFsLandscape
                  ? 'col-start-2 row-start-1 min-h-0'
                  // T15750 (AC1): the portrait Edit/Add play editor below is
                  // `shrink` + `min-h-0` (it scrolls internally instead), so
                  // this flex-1 video wrapper is the one that KEEPS its size --
                  // the min-height floor (full-width 16:9) is the backstop for
                  // when flex math alone still can't fit both.
                  : `flex-1 flex flex-col ${mobileFsPortraitEditorOpen ? 'min-h-[56.25vw]' : 'min-h-0'}${mobileFs ? ' pt-[env(safe-area-inset-top)]' : ''}`
                : 'rounded-lg'
            }`}
            onClick={mobileFs && !showAnnotateOverlay ? togglePlay : undefined}
            onTouchStart={mobileFs && !showAnnotateOverlay && !mobileFsLandscape ? fsControls.handleLongPressTouchStart : undefined}
            onTouchMove={mobileFs && !showAnnotateOverlay && !mobileFsLandscape ? fsControls.handleLongPressTouchMove : undefined}
            onTouchEnd={mobileFs && !showAnnotateOverlay && !mobileFsLandscape ? fsControls.handleLongPressTouchEnd : undefined}
          >
            {/* In fullscreen: flex-1 fills remaining space after controls/timeline.
                T15380: portrait mobile fullscreen now sizes like desktop
                fullscreen (flex-1 min-h-0) instead of filling the container --
                only landscape mobile fullscreen is still a full-bleed `absolute inset-0`. */}
            <div
              className={annotateFullscreen ? (mobileFsLandscape ? 'absolute inset-0' : 'flex-1 min-h-0 relative') : 'contents'}
            >
              {isPlaysOnly ? (
                <PlaysOnlyPanel
                  onRestore={onRestorePlaysOnly}
                  className={annotateFullscreen
                    ? 'absolute inset-0'
                    : `${STAGE_UNKNOWN_DIMS_CLASS} rounded-lg border border-yellow-800/40`}
                />
              ) : isSourceExpired ? (
                /* bug 27p: source video expired — deliberate state, no <video>.
                   Reuses the Games-menu expired language (yellow + Clock). */
                <div className={annotateFullscreen
                  ? 'absolute inset-0 flex items-center justify-center bg-yellow-950/20'
                  // T10800: no picture here, so keep today's fixed box (routed
                  // through the shared unknown-dims constant, not a literal).
                  : `flex items-center justify-center ${STAGE_UNKNOWN_DIMS_CLASS} rounded-lg bg-yellow-950/20 border border-yellow-800/40`}
                >
                  <div className="text-center max-w-md px-6">
                    <Clock size={40} className="mx-auto mb-3 text-yellow-500" />
                    <p className="text-yellow-400 font-semibold mb-2">{ANNOTATE.SOURCE_EXPIRED_TITLE}</p>
                    <p className="text-gray-400 text-sm">{ANNOTATE.SOURCE_EXPIRED_CANT_MARK}</p>
                  </div>
                </div>
              ) : multiVideo ? (
                /* T2750: Dual video elements for multi-video scrub */
                <div className={annotateFullscreen ? 'absolute inset-0' : `relative ${stageAspect ? STAGE_ASPECT_BOX_CLASS : STAGE_UNKNOWN_DIMS_CLASS}`}
                     style={annotateFullscreen ? undefined : stageAspectStyle}
                     data-testid="annotate-video-stage"
                     onClickCapture={skipTap.onClickCapture}>
                  <SkipRipple feedback={skipTap.feedback} />
                  {/* T9510: same ARIA contract as the playback dual-video (see
                      note above) — these editing/scrub elements share the A/B
                      source-swap churn and onError handler, so an author label +
                      aria-busy prevents the native "Unable to play media" name
                      leaking during a transient scrub-load, and aria-hidden keeps
                      only the on-screen element exposed. */}
                  <video
                    ref={videoController._renderRefs.attachA || videoController._renderRefs.videoARef}
                    aria-label={multiVideo.isLoading ? 'Loading video' : ANNOTATE.GAME_VIDEO_LABEL}
                    aria-busy={multiVideo.isLoading}
                    aria-hidden={multiVideo.activeVideoLabel !== 'A'}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                    style={{
                      opacity: multiVideo.activeVideoLabel === 'A' ? 1 : 0,
                      transition: 'opacity 80ms ease-in-out',
                      zIndex: multiVideo.activeVideoLabel === 'A' ? 2 : 1,
                    }}
                    onError={multiVideo.videoHandlers.onError}
                    onWaiting={multiVideo.videoHandlers.onWaiting}
                    onCanPlay={multiVideo.videoHandlers.onCanPlay}
                    playsInline
                    preload="auto"
                  />
                  <video
                    ref={videoController._renderRefs.attachB || videoController._renderRefs.videoBRef}
                    aria-label={multiVideo.isLoading ? 'Loading video' : ANNOTATE.GAME_VIDEO_LABEL}
                    aria-busy={multiVideo.isLoading}
                    aria-hidden={multiVideo.activeVideoLabel !== 'B'}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                    style={{
                      opacity: multiVideo.activeVideoLabel === 'B' ? 1 : 0,
                      transition: 'opacity 80ms ease-in-out',
                      zIndex: multiVideo.activeVideoLabel === 'B' ? 2 : 1,
                    }}
                    onError={multiVideo.videoHandlers.onError}
                    onWaiting={multiVideo.videoHandlers.onWaiting}
                    onCanPlay={multiVideo.videoHandlers.onCanPlay}
                    playsInline
                    preload="auto"
                  />
                  {/* T3050: Loading overlay during cross-boundary seeks */}
                  {multiVideo.isLoading && !multiVideo.error && (
                    <VideoLoadingOverlay simple />
                  )}
                  {/* T3050: Error overlay with retry */}
                  {/* T9510: role="alert" so a genuine, established failure is
                      announced once to AT, paired with the Retry action. */}
                  {multiVideo.error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-50" role="alert">
                      <div className="text-center max-w-md px-4">
                        <div className="text-red-500 text-4xl mb-4">{'⚠️'}</div>
                        <p className="text-red-400 font-semibold mb-2">Video failed to load</p>
                        <p className="text-gray-400 text-sm mb-4">{multiVideo.error}</p>
                        <button
                          onClick={multiVideo.retry}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                        >
                          Retry Loading Video
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Click to toggle play */}
                  <div
                    className="absolute inset-0 z-10 cursor-pointer"
                    onClick={togglePlay}
                    style={{ zIndex: 3 }}
                  />
                  {/* NotesOverlay for multi-video */}
                  {!showAnnotateOverlay && (() => {
                    const selectedRegion = annotateSelectedRegionId
                      && clipRegions.find(r => r.id === annotateSelectedRegionId);
                    const region = overlayRegionAtPlayhead(selectedRegion || null, getAnnotateRegionAtTime(currentTime), currentTime);
                    if (!region) return null;
                    const displayName = region.name ||
                      generateClipName(region);
                    return (displayName || region.notes) ? (
                      <NotesOverlay
                        key="annotate-notes"
                        name={displayName}
                        notes={region.notes}
                        rating={region.rating}
                        gameClock={gameClockFor(region)}
                        isVisible={true}
                        isFullscreen={annotateFullscreen}
                        isMobile={isMobile}
                      />
                    ) : null;
                  })()}
                </div>
              ) : (
                <div
                  className={annotateFullscreen ? 'absolute inset-0' : `relative ${stageAspect ? STAGE_ASPECT_BOX_CLASS : STAGE_UNKNOWN_DIMS_CLASS}`}
                  style={annotateFullscreen ? undefined : stageAspectStyle}
                  data-testid="annotate-video-stage"
                  onClickCapture={skipTap.onClickCapture}
                >
                  <SkipRipple feedback={skipTap.feedback} />
                  <VideoPlayer
                    videoRef={videoController._renderRefs.videoARef}
                    videoUrl={annotateVideoUrl}
                    // T10800: the wrapper above is the aspect-sized stage box, so
                    // VideoPlayer fills it (w-full h-full) instead of imposing its
                    // own fixed 40/60vh height. Fullscreen owns its own sizing.
                    fitToAspect={!annotateFullscreen}
                    handlers={handlers}
                    onVideoClick={togglePlay}
                    isLoading={isLoading}
                    isVideoElementLoading={isVideoElementLoading}
                    loadingProgress={loadingProgress}
                    loadingElapsedSeconds={loadingElapsedSeconds}
                    error={error}
                    isUrlExpiredError={isUrlExpiredError}
                    onRetryVideo={onRetryVideo}
                    loadingMessage="Loading video..."
                    overlays={[
                      !showAnnotateOverlay && (() => {
                        const selectedRegion = annotateSelectedRegionId
                          && clipRegions.find(r => r.id === annotateSelectedRegionId);
                        const region = overlayRegionAtPlayhead(selectedRegion || null, getAnnotateRegionAtTime(currentTime), currentTime);
                        if (!region) return null;
                        const displayName = region.name ||
                          generateClipName(region);
                        return (displayName || region.notes) ? (
                          <NotesOverlay
                            key="annotate-notes"
                            name={displayName}
                            notes={region.notes}
                            rating={region.rating}
                            gameClock={gameClockFor(region)}
                            isVisible={true}
                            isFullscreen={annotateFullscreen}
                            isMobile={isMobile}
                          />
                        ) : null;
                      })(),
                    ].filter(Boolean)}
                    zoom={zoom}
                    panOffset={panOffset}
                    onZoomChange={onZoomChange}
                    onPanChange={onPanChange}
                    isFullscreen={annotateFullscreen}
                    clipRating={showAnnotateOverlay ? null : annotatePlaybackRating(getAnnotateRegionAtTime(currentTime))}
                  />
                </div>
              )}
            </div>

            {/* T9500: the desktop fullscreen side dock is gone. Desktop fullscreen
                now renders the SAME bottom-center strip as windowed desktop (the
                `desktopEditorOpen` block below), so both surfaces share one editor
                (labels, stage CTA, save/stay-open) and the strip's fiber survives
                the fullscreen toggle. Landscape mobile fullscreen keeps its own
                inline sheet (T15380: portrait mobile fullscreen joined this
                in-flow block instead -- see the `mobileFsLandscape` gate below). */}

            {/* Controls + timeline inside video container for desktop fullscreen,
                non-fullscreen, AND portrait mobile fullscreen (T15380 AC1/AC2:
                this renders BELOW the video in flow, never over it). */}
            {!mobileFsLandscape && (
              <>
                <div className={annotateFullscreen ? 'w-full shrink-0' : ''}>
                  <AnnotateControls
                    flushBottom={!!sourceBar}
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    duration={duration || annotateVideoMetadata?.duration || 0}
                    onTogglePlay={togglePlay}
                    onStepForward={stepForward}
                    onStepBackward={stepBackward}
                    onSeekBackward={seekBackward}
                    onSeekForward={seekForward}
                    onRestart={restart}
                    playbackSpeed={annotatePlaybackSpeed}
                    onSpeedChange={onSpeedChange}
                    isFullscreen={annotateFullscreen}
                    onToggleFullscreen={onToggleFullscreen}
                    onAddClip={underCanvasEditor ? undefined : handleAddClipWithSportPrompt}
                    isEditMode={isEditMode}
                    videoController={videoController}
                    clipEditBounds={clipEditBounds}
                    // T8960 item 9: hide step/seek/restart while the desktop
                    // strip editor is open (both Add and Edit Play). Scoped to
                    // desktop strip so fullscreen/mobile transports are untouched.
                    editorOpen={desktopEditorOpen}
                    // T10390: Zoom lives here now (was the settings rail's one
                    // control) — desktop, non-fullscreen only, same gate the rail used.
                    showZoomControls={!annotateFullscreen && !isMobile}
                    zoom={zoom}
                    onZoomIn={onZoomIn}
                    onZoomOut={onZoomOut}
                    onResetZoom={onResetZoom}
                    minZoom={MIN_ZOOM}
                    maxZoom={MAX_ZOOM}
                    simplified={simplified}
                  />
                  {/* T13280: the Videos control, directly under the transport whenever
                      the game has 2+ videos. Fixed-width surface, so it does not move with
                      the stage aspect (square footage is letterboxed above it). */}
                  {sourceBar && <SourceBar {...sourceBar} compact={annotateFullscreen} />}
                  {/* T13220/T13240: the post-import alignment check sits with the frame it asks
                      about (windowed only; an import is never started from fullscreen). */}
                  {!annotateFullscreen && suggested?.align && (
                    <div className="pt-2"><VeoAlignCard align={suggested.align} /></div>
                  )}
                  {/* T11860: a fresh game hides frame-step, timeline zoom and the layer
                      filter; this reveals them for the rest of the session. */}
                  {simplified && (
                    <div className="flex justify-center pt-1">
                      <button
                        type="button"
                        onClick={onShowAllControls}
                        className="inline-flex min-h-[44px] items-center gap-1.5 px-3 text-sm text-gray-300 hover:text-white"
                      >
                        <SlidersHorizontal size={14} />
                        {ANNOTATE.MORE_CONTROLS}
                      </button>
                    </div>
                  )}
                </div>
                {annotateFullscreen && !mobileFsPortraitEditorOpen && (
                  // T15750 (AC1): hidden while the portrait editor is open --
                  // same relief the T15370 landscape cockpit already gives its
                  // own timeline row (line ~1224 below), freeing the space for
                  // the picture instead.
                  <div data-testid="annotate-fullscreen-timeline" className="w-full shrink-0 bg-gray-900/95 border-t border-gray-700 px-2 lg:px-4 py-0.5">
                    <AnnotateMode
                      currentTime={currentTime}
                      duration={duration || annotateVideoMetadata?.duration || 0}
                      isPlaying={isPlaying}
                      onSeek={onTimelineSeek || seek}
                      regions={annotateRegionsWithLayout}
                      selectedRegionId={annotateSelectedRegionId}
                      onSelectRegion={onSelectRegion}
                      onDeleteRegion={onDeleteRegion}
                      selectedLayer={annotateSelectedLayer}
                      onLayerSelect={onLayerSelect}
                      boundaryOffsets={boundaryOffsets}
                      angleData={angleData}
                      zoom={timelineZoomProps}
                      suggestionTicks={suggested?.ticks}
                      onSuggestionTickClick={suggested?.onTickClick}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* T10620: mobile PORTRAIT add/edit editor — an in-flow compact strip
              rendered DIRECTLY under the video card (a sibling of the video
              player div above, inside the same windowed wrapper), NOT a fixed
              bottom sheet. Replaces the old `fixed inset-x-0 bottom-0 z-40
              max-h-[85vh] rounded-t-2xl` sheet that hid ~85% of the video: its
              only reason to be `fixed` was pinning the Save footer on screen
              (T8140), and T10610 removed that footer. In flow, the video the
              trim handles refer to stays visible above the strip, and the
              T10420 backdrop-filter containing-block trap no longer applies
              (it only bites `fixed`/`absolute` descendants). The `[@media
              (max-height:700px)]:pb-9` keyboard-padding hack (T8790/F3) is gone
              with the sheet — it existed only to lift the pinned footer clear of
              the soft keyboard. `mobileFs` (T9500) is a SEPARATE surface, gated
              on `annotateFullscreen` and mutually exclusive with this one; it
              keeps `layout="inline"` and is untouched by this task. */}
          {mobileInlineForm && (
            <div className="mt-2">
              <AnnotateFullscreenOverlay
                isVisible={showAnnotateOverlay}
                currentTime={currentTime}
                videoDuration={duration || annotateVideoMetadata?.duration || 0}
                existingClip={existingClip}
                onUpdateClip={onFullscreenUpdateClip}
                onClose={onOverlayClose}
                onDeleteClip={onDeletePlayFromEditor}
                onAwaitWrites={onAwaitRegionWrites}
                writeStatus={writeStatus}
                onSeek={seek}
                videoController={videoController}
                isFullscreen={false}
                layout="portrait-strip"
                activeSourceName={activeSourceName}
                mediaBounds={activeSourceMediaBounds}
                teammateSuggestions={teammateSuggestions}
                framingInProgress={selectedRegionFraming}
                // T11130: Done -> Highlight choice card (in-place mode-swap)
                showHighlightChoice={!!highlightChoice && highlightChoice.regionId === existingClip?.id}
                onHighlightChoiceNow={onHighlightChoiceNow}
                onHighlightChoiceLater={onHighlightChoiceLater}
                onHighlightChoiceDismiss={onHighlightChoiceDismiss}
              />
            </div>
          )}

          {/* T15370: landscape cockpit's timeline zone -- bottom row of the
              grid, under the picture. Nothing auto-hides: there is nothing
              drawn OVER the picture to hide (that was T15380's whole fix).
              Hidden while the editor sheet is open (no room, and the sheet's
              own ClipScrubRegion is the trim control then). */}
          {mobileFsLandscape && !showAnnotateOverlay && (
            <div data-testid="annotate-cockpit-timeline" className="col-start-2 row-start-2 bg-gray-900/95 px-2 py-0.5">
              <AnnotateMode
                currentTime={currentTime}
                duration={duration || annotateVideoMetadata?.duration || 0}
                isPlaying={isPlaying}
                onSeek={onTimelineSeek || seek}
                regions={annotateRegionsWithLayout}
                selectedRegionId={annotateSelectedRegionId}
                onSelectRegion={onSelectRegion}
                onDeleteRegion={onDeleteRegion}
                selectedLayer={annotateSelectedLayer}
                onLayerSelect={onLayerSelect}
                boundaryOffsets={boundaryOffsets}
                angleData={angleData}
                zoom={timelineZoomProps}
                suggestionTicks={suggested?.ticks}
                onSuggestionTickClick={suggested?.onTickClick}
                hideScrollbar
              />
            </div>
          )}

          {/* T15370: the right action strip -- Mark/Edit play, speed, the
              source chip (2+ videos) and the 1x/3x zoom toggle. */}
          {mobileFsLandscape && (
            <AnnotateActionStrip
              className="row-span-2"
              isEditMode={isEditMode}
              onAddClip={handleAddClipWithSportPrompt}
              disabled={isSourceExpired || isPlaysOnly || isLoadingGameData}
              playbackSpeed={annotatePlaybackSpeed}
              onSpeedChange={onSpeedChange}
              sourceLabel={sourceBar ? `${sourceBar.index}/${sourceBar.count}` : null}
              onOpenVideos={() => setVideosSheetOpen((v) => !v)}
              zoomedIn={timelineZoomProps.timelineZoom > 100}
              onZoomToggle={() => (
                timelineZoomProps.timelineZoom > 100
                  ? timelineZoomProps.setZoom(100)
                  : timelineZoomProps.resetZoom()
              )}
              hideZoomToggle={cockpitSimplified}
            />
          )}

          {/* T15370: Mark/Edit play opens the ONE editor sheet from the right
              (over the right strip), replacing the old bottom sheet -- the
              middle of the picture stays visible while trimming (AC2). */}
          {mobileFsLandscape && showAnnotateOverlay && (
            <AnnotateSideSheet peek={isDraggingScrub}>
              <AnnotateFullscreenOverlay
                isVisible={showAnnotateOverlay}
                currentTime={currentTime}
                videoDuration={duration || annotateVideoMetadata?.duration || 0}
                existingClip={existingClip}
                onUpdateClip={onFullscreenUpdateClip}
                onClose={onOverlayClose}
                onDeleteClip={onDeletePlayFromEditor}
                onAwaitWrites={onAwaitRegionWrites}
                writeStatus={writeStatus}
                onSeek={seek}
                videoController={videoController}
                isFullscreen={false}
                layout="landscape-inline"
                activeSourceName={activeSourceName}
                mediaBounds={activeSourceMediaBounds}
                teammateSuggestions={teammateSuggestions}
                framingInProgress={selectedRegionFraming}
                onScrubDragChange={setIsDraggingScrub}
                // T15380 (AC3): collapse to just the scrub row while a trim
                // handle or the bar itself is being dragged, so most of the
                // picture peeks through behind the sheet.
                dragPeek={isDraggingScrub}
                // T11130: Done -> Highlight choice card (in-place mode-swap)
                showHighlightChoice={!!highlightChoice && highlightChoice.regionId === existingClip?.id}
                onHighlightChoiceNow={onHighlightChoiceNow}
                onHighlightChoiceLater={onHighlightChoiceLater}
                onHighlightChoiceDismiss={onHighlightChoiceDismiss}
              />
            </AnnotateSideSheet>
          )}

          {/* T15370: the source chip's "Videos" sheet -- holds the existing
              SourceBar verbatim (it owns its own expand/pick state). Closes
              on a pick so the chip doubles as its own toggle. */}
          {mobileFsLandscape && videosSheetOpen && sourceBar && (
            <AnnotateSideSheet>
              <div className="p-2">
                <h2 className="px-1 pb-2 text-sm font-semibold text-gray-100">{ANNOTATE_COCKPIT.SHEET_VIDEOS}</h2>
                <SourceBar
                  {...sourceBar}
                  onPick={(seq) => { sourceBar.onPick?.(seq); setVideosSheetOpen(false); }}
                />
              </div>
            </AnnotateSideSheet>
          )}

          {/* T15380 (AC1/AC2): portrait mobile fullscreen's Add/Edit play editor --
              an in-flow strip below the video (option B), the SAME portrait-strip
              surface the windowed mobile editor uses (`mobileInlineForm` above),
              not the fixed/absolute sheet landscape still uses. Nothing here is
              ever positioned over the picture. */}
          {mobileFsPortraitEditorOpen && (
            // T15750 (AC1): `shrink min-h-0` (not `shrink-0`) -- the video
            // wrapper above now claims a guaranteed min-height floor, so THIS
            // panel is the one flexbox squeezes first; it scrolls internally
            // (overflow-y-auto) rather than pushing the picture to near-zero.
            <div className="w-full shrink min-h-0 overflow-y-auto max-h-[45vh]">
              <AnnotateFullscreenOverlay
                isVisible={showAnnotateOverlay}
                currentTime={currentTime}
                videoDuration={duration || annotateVideoMetadata?.duration || 0}
                existingClip={existingClip}
                onUpdateClip={onFullscreenUpdateClip}
                onClose={onOverlayClose}
                onDeleteClip={onDeletePlayFromEditor}
                onAwaitWrites={onAwaitRegionWrites}
                writeStatus={writeStatus}
                onSeek={seek}
                videoController={videoController}
                isFullscreen={false}
                layout="portrait-strip"
                activeSourceName={activeSourceName}
                mediaBounds={activeSourceMediaBounds}
                teammateSuggestions={teammateSuggestions}
                framingInProgress={selectedRegionFraming}
                // T11130: Done -> Highlight choice card (in-place mode-swap)
                showHighlightChoice={!!highlightChoice && highlightChoice.regionId === existingClip?.id}
                onHighlightChoiceNow={onHighlightChoiceNow}
                onHighlightChoiceLater={onHighlightChoiceLater}
                onHighlightChoiceDismiss={onHighlightChoiceDismiss}
              />
            </div>
          )}

          {/* Annotate Mode Timeline - non-fullscreen (hidden while the under-canvas editor is open) */}
          {!annotateFullscreen && !underCanvasEditor && (
            <div className={`mt-6 ${SHORT_DESKTOP_GAP_CLASS} ${SHORT_DESKTOP_TIMELINE_CLASS} ${PHONE_LANDSCAPE_GAP_CLASS} ${PHONE_LANDSCAPE_TIMELINE_CLASS} ${PHONE_LANDSCAPE_HIDE_SCROLLBAR_CLASS}`}>
              <AnnotateMode
                currentTime={currentTime}
                duration={duration || annotateVideoMetadata?.duration || 0}
                isPlaying={isPlaying}
                onSeek={onTimelineSeek || seek}
                regions={annotateRegionsWithLayout}
                selectedRegionId={annotateSelectedRegionId}
                onSelectRegion={onSelectRegion}
                onDeleteRegion={onDeleteRegion}
                selectedLayer={annotateSelectedLayer}
                onLayerSelect={onLayerSelect}
                boundaryOffsets={boundaryOffsets}
                angleData={angleData}
                videoLane={videoLane}
                zoom={timelineZoomProps}
                suggestionTicks={suggested?.ticks}
                onSuggestionTickClick={suggested?.onTickClick}
              />
            </div>
          )}

          {/* T8600: desktop under-canvas editor strip — replaces the timeline in
              place while Add Play / Edit Play is open (windowed desktop).
              T9500: also the fullscreen desktop editor now (was the side dock). In
              fullscreen the fixed container (annotateContainerRef) is a flex column;
              the strip becomes a bottom shrink-0 row below the video+transport, so
              it sits bottom-center and stays clear of the video. `max-h-[45vh]` +
              scroll keeps a details-expanded strip from squeezing the video (the
              fullscreen container has no page scroll). Windowed keeps its `mt-6`. */}
          {desktopEditorOpen && (
            <div className={annotateFullscreen ? 'w-full shrink-0 overflow-y-auto max-h-[45vh]' : 'mt-6'}>
              <AnnotateFullscreenOverlay
                isVisible={showAnnotateOverlay}
                currentTime={currentTime}
                videoDuration={duration || annotateVideoMetadata?.duration || 0}
                existingClip={existingClip}
                onUpdateClip={onFullscreenUpdateClip}
                onClose={onOverlayClose}
                onDeleteClip={onDeletePlayFromEditor}
                onAwaitWrites={onAwaitRegionWrites}
                writeStatus={writeStatus}
                onSeek={seek}
                videoController={videoController}
                isFullscreen={annotateFullscreen}
                layout="strip"
                activeSourceName={activeSourceName}
                mediaBounds={activeSourceMediaBounds}
                teammateSuggestions={teammateSuggestions}
                framingInProgress={selectedRegionFraming}
                // T11130: Done -> Highlight choice card (in-place mode-swap)
                showHighlightChoice={!!highlightChoice && highlightChoice.regionId === existingClip?.id}
                onHighlightChoiceNow={onHighlightChoiceNow}
                onHighlightChoiceLater={onHighlightChoiceLater}
                onHighlightChoiceDismiss={onHighlightChoiceDismiss}
              />
            </div>
          )}
        </div>

        {/* T8140: full-screen "What sport is this?" question at a mobile first
            save. Answer persists via the existing profile-sport gesture; Skip
            proceeds (the clip is already saved) so it can't dead-end. */}
        {sportQuestionOpen && (
          <SportQuestionOverlay
            onPick={(s) => {
              if (currentProfile?.id) updateProfile(currentProfile.id, { sport: s }).catch(() => {});
              dismissSportPromptForGame();
              setSportQuestionOpen(false);
            }}
            onSkip={() => {
              dismissSportPromptForGame();
              setSportQuestionOpen(false);
            }}
          />
        )}

        {/* T8900: Fix-timing mode-swaps the primary CTA block (yellow strip in its
            place; the timeline above stays visible so the bar can be dragged). */}
        {!annotateFullscreen && !underCanvasEditor && fixTiming && (
          <FixTimingStrip
            angleName={fixTiming.angleName}
            moved={fixTiming.moved}
            onNudge={fixTiming.onNudge}
            onPlayAngle={fixTiming.onPlayAngle}
            onPlayMain={fixTiming.onPlayMain}
            onReset={fixTiming.onReset}
            onDone={fixTiming.onDone}
            onCancel={fixTiming.onCancel}
          />
        )}

        {/* Primary "Add Play" CTA + secondary actions (hidden while the under-canvas
            editor is open OR Fix-timing is active). T8130: the Add Play button is the
            single loudest element on the screen; Playback Annotations + Share are
            demoted to text-level prominence until the first clip exists. */}
        {!annotateFullscreen && !underCanvasEditor && !fixTiming && (
          <div className={`mt-3 sm:mt-6 ${SHORT_DESKTOP_GAP_CLASS} ${PHONE_LANDSCAPE_GAP_CLASS}`}>
            <div className="space-y-3">
              {/* PRIMARY CTA. T10310 (2026-09-18 user request): once a play is
                  selected, this splits into [Edit Play] + a Frame action —
                  which replaces the editor's old "Create clip"/"Save and
                  Frame" with one gesture that creates the clip's project (if
                  it doesn't have one yet) and opens it at its current stage.
                  T10450 (2026-09-18 user request): while the play has NO
                  project yet, that single Frame button splits further into
                  [Frame Now] (create + open Framing immediately) and
                  [Frame Later] (create only, stays in Annotate — the play
                  becomes an editable clip for a later Framing pass). Once a
                  project exists (the play already IS a clip), it's back to
                  the single stage-CTA button — Frame Now/Later was only ever
                  about the create decision. Creating a new play keeps the
                  single full-width CTA. */}
              {isEditMode ? (
                <div className="space-y-3">
                  {/* T14770 (decision C, 2026-11-03): Edit play is the first action
                      (secondary row card); Make highlight is the one primary card
                      -- the shape is picked in Frame, not here. Desktop (lg,
                      1280px): Edit play in the first column, Make highlight
                      across the other two. */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <ActionCard icon={Pencil} title={ANNOTATE.EDIT_PLAY}
                      description={ANNOTATE.EDIT_PLAY_CARD}
                      tooltip={isSourceExpired ? ANNOTATE.SOURCE_EXPIRED_CANT_MARK : 'Edit the selected play'}
                      onClick={handleAddClipWithSportPrompt} disabled={isSourceExpired || isPlaysOnly}
                      data-testid="annotate-primary-cta" />
                    {selectedRegion && regionStages && (
                      <div className="lg:col-span-2">
                        <HighlightEntry
                          pending={frameClipPending}
                          locked={isGameUploading}
                          onMake={handleMakeHighlight}
                        />
                      </div>
                    )}
                  </div>
                  {/* "Highlights from this play" -- a play can get several highlights of
                      each shape (decision C accepted cost); each row opens where it left
                      off. Full width; its own rows go two-up from lg (design decision). */}
                  {selectedRegion && regionStages && (
                    <HighlightList
                      instances={regionStages.instances.filter((i) => i.projectId != null)}
                      onOpen={handleOpenInstance}
                      highlightedProjectId={guide?.pulse === GUIDE_PULSE.HIGHLIGHT_ROW ? portraitHighlightInstance?.projectId : null}
                    />
                  )}
                </div>
              ) : (
                <div className={`grid grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-4 gap-3 ${SHORT_DESKTOP_TILES_CLASS} ${PHONE_LANDSCAPE_TILES_CLASS}`}>
                  <ActionCard variant="primary" icon={Plus} title={ANNOTATE.MARK_PLAY} description={ANNOTATE.MARK_PLAY_CARD}
                    onClick={handleAddClipWithSportPrompt} disabled={isSourceExpired || isPlaysOnly || isLoadingGameData}
                    data-testid="annotate-mark-play-button"
                    guideTarget={GUIDE_PULSE.MARK_PLAY}
                  >
                    {/* T12410: capture window, on the card so it shows with Guidance off and on phones. */}
                    <span data-testid="annotate-capture-window-hint" className="text-xs leading-relaxed [@media(min-width:1024px)_and_(max-height:950px)]:leading-snug [@media(min-width:1024px)_and_(max-height:800px)]:w-full text-slate-900/80">{ANNOTATE.CAPTURE_WINDOW_HINT}</span>
                  </ActionCard>
                  {/* T11750 locked cues (T12040 restored them): Lock icon, borderless, dimmer text. */}
                  <ActionCard icon={hasAnnotateClips ? ListVideo : Lock} title={ANNOTATE.PREVIEW_PLAYS} description={ANNOTATE.WATCH_PLAYS_CARD}
                    locked={!hasAnnotateClips}
                    disabled={isSourceExpired} aria-disabled={!hasAnnotateClips || undefined}
                    onClick={() => hasAnnotateClips ? playback?.enterPlaybackMode() : toast.info(ANNOTATE.REVIEW_PLAYS_LOCKED_TOAST, { dedupKey: 'review-locked' })}
                    data-testid="annotate-review-plays" />
                  {onSharePlayback && <ActionCard icon={hasAnnotateClips ? Share2 : Lock} title={SHARING.SHARE_PLAYS} description="Send the game and your plays to family or coaches."
                    locked={!hasAnnotateClips} aria-disabled={!hasAnnotateClips || undefined}
                    onClick={() => hasAnnotateClips ? onSharePlayback() : toast.info(ANNOTATE.SHARE_PLAYS_LOCKED_TOAST, { dedupKey: 'share-locked' })}
                    data-testid="annotate-share-plays-action" />}
                  {addFootage && <AddFootageButton variant="card" gameId={addFootage.gameId} disabled={addFootage.disabled} onFootageAttached={addFootage.onFootageAttached} onVeoZip={suggested?.openZip} veoZipDisabled={isSourceExpired || isPlaysOnly} />}
                </div>
              )}

              {/* Teaching hint (2026-09-18 user request: dropped the "You are
                  bookmarking, not editing..." stage-reason line entirely) —
                  the 6s/2s capture-window mechanic on the very first play only. */}


              {/* T10310 (2026-09-18 user request): once a play is selected,
                  these whole-game actions (Review plays / Share plays / tagged
                  sharing) are gone — only the play-specific actions above
                  apply. They come back once nothing is selected. */}
              {!isEditMode && onShare && hasTaggedClips && (
                <button onClick={onShare} className={`text-sm flex items-center justify-center gap-1.5 mt-1 ${hasUnsentShares ? 'text-cyan-400' : 'text-gray-300'}`}>
                  <Users size={14} /><span>{SHARING.TAGGED_SHARE}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* T13220: Veo suggested plays (sheet, alignment card, rate-to-keep list) */}
      <SuggestedPlaysPanel suggested={suggested} />

      {/* T10620: the mobile portrait add/edit editor moved UP to render in flow
          directly under the video card (see the `mobileInlineForm` block inside
          the Main Editor Area above). The old fixed `max-h-[85vh]` bottom sheet
          that lived here — and its T10420 outside-the-blur-wrapper placement —
          is retired: an in-flow strip does not need a viewport containing block. */}

      {/* Technical readouts (resolution/format/size) - 2026-09-18 (user request):
          moved below the bottom CTA (Review plays/Share plays above) and
          de-emphasized (small/quiet). Same content, least-important placement. */}
      {annotateVideoMetadata && !annotateFullscreen && (
        <div className="hidden lg:flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
          {annotateVideoMetadata.resolution && (
            <span>
              <span className="text-gray-600">Resolution:</span>{' '}
              {annotateVideoMetadata.resolution}
            </span>
          )}
          {annotateVideoMetadata.format && (
            <span>
              <span className="text-gray-600">Format:</span>{' '}
              {annotateVideoMetadata.format.toUpperCase()}
            </span>
          )}
          {annotateVideoMetadata.size > 0 && (
            <span>
              <span className="text-gray-600">Size:</span>{' '}
              {formatFileSize(annotateVideoMetadata.size)}
            </span>
          )}
        </div>
      )}
    </GuideScope>
  );
}
