import { useEffect, useCallback, useMemo, useState } from 'react';
import { OverlayMode, HighlightOverlay, PlayerDetectionOverlay } from '../modes/overlay';
import { useSpotlightLoop } from '../modes/overlay/hooks/useSpotlightLoop';
import { EDITOR_MODES } from '../stores';
import { useQuestStore } from '../stores/questStore';
import { countDetectionAssignments, detectionAssignmentStates } from '../modes/overlay/utils/detectionAssignment';
import { useGuidedAthletePick } from '../modes/overlay/hooks/useGuidedAthletePick';
import { frameToTime } from '../utils/videoUtils';

export const selectRegionDetection = (detections, currentFrame, fps) => {
  let closestDetection = null;
  let closestFrameDistance = Infinity;
  let closestWithBoxes = null;
  let closestWithBoxesDistance = Infinity;

  for (const detection of detections) {
    const detectionFrame = detection.frame !== undefined
      ? detection.frame
      : Math.round(detection.timestamp * fps);
    const frameDistance = Math.abs(detectionFrame - currentFrame);

    if (frameDistance < closestFrameDistance) {
      closestFrameDistance = frameDistance;
      closestDetection = detection;
    }
    if (detection.boxes?.length > 0 && frameDistance < closestWithBoxesDistance) {
      closestWithBoxesDistance = frameDistance;
      closestWithBoxes = detection;
    }
  }

  const threshold = 2;
  const normalMatchIsUsable = closestDetection &&
    closestFrameDistance <= threshold && closestDetection.boxes?.length > 0;
  return {
    detection: normalMatchIsUsable ? closestDetection : closestWithBoxes,
    frameDistance: normalMatchIsUsable ? closestFrameDistance : closestWithBoxesDistance,
  };
};

/**
 * OverlayContainer - Encapsulates all Overlay mode logic and UI
 *
 * This container manages:
 * - Overlay video state (rendered video from Framing export)
 * - Highlight region management (create, edit, delete regions)
 * - Player detection for click-to-track feature
 * - Highlight keyframe management within regions
 * - Effect type selection (brightness_boost, dark_overlay)
 * - Persistence of overlay data to backend
 *
 * NOTE: Overlay state and highlight regions are passed as props from App.jsx
 * to avoid duplicate state. App.jsx owns these hooks; OverlayContainer
 * orchestrates them and provides derived state/handlers.
 *
 * @param {Object} props - Dependencies from App.jsx
 * @see APP_REFACTOR_PLAN.md Task 3.2 for refactoring context
 */
export function OverlayContainer({
  // Video element ref and state
  videoRef,
  currentTime,
  duration,
  isPlaying,
  isSeeking,
  seek,
  togglePlay,

  // Framing video state (for pass-through mode)
  framingVideoUrl,
  framingMetadata,

  // Keyframes and segments from Framing mode
  keyframes,
  segments,
  segmentSpeeds,
  segmentBoundaries,
  trimRange,

  // Project context
  selectedProjectId,
  selectedProject,

  // Clips state
  clips,
  hasClips,

  // Editor mode
  editorMode,
  setEditorMode,
  setSelectedLayer,

  // Overlay state from useOverlayState hook (passed from App.jsx to avoid duplicate state)
  overlayVideoFile,
  overlayVideoUrl,
  overlayVideoMetadata,
  overlayClipMetadata,
  isLoadingWorkingVideo,
  setOverlayClipMetadata,
  setIsLoadingWorkingVideo,
  dragHighlight,
  setDragHighlight,
  selectedHighlightKeyframeTime,
  setSelectedHighlightKeyframeTime,
  highlightEffectType,
  setHighlightEffectType,
  highlightColor,  // Global color from store (used in preview)
  // Sync state machine (replaces overlayDataLoadedForProjectRef)
  overlaySyncState,
  overlayLoadedProjectId,

  // Highlight regions from useHighlightRegions hook (passed from App.jsx to avoid duplicate state)
  highlightRegions,
  highlightBoundaries,
  highlightRegionKeyframes,
  highlightRegionsFramerate,
  initializeHighlightRegions,
  resetHighlightRegions,
  addHighlightRegion,
  deleteHighlightRegion,
  moveHighlightRegionStart,
  moveHighlightRegionEnd,
  commitHighlightRegionStart,
  commitHighlightRegionEnd,
  toggleHighlightRegion,
  addHighlightRegionKeyframe,
  removeHighlightRegionKeyframe,
  getRegionAtTime,
  isTimeInEnabledRegion,
  getRegionHighlightAtTime,
  getRegionsForExport,
  restoreHighlightRegions,
  initializeHighlightRegionsFromClips,

}) {

  // DERIVED STATE: Check for framing edits
  const hasFramingEdits = useMemo(() => {
    const hasCropEdits = keyframes.length > 2 || (
      keyframes.length === 2 &&
      (keyframes[0].x !== keyframes[1].x ||
       keyframes[0].y !== keyframes[1].y ||
       keyframes[0].width !== keyframes[1].width ||
       keyframes[0].height !== keyframes[1].height)
    );
    const hasTrimEdits = trimRange !== null;
    const hasSpeedEdits = Object.values(segmentSpeeds).some(speed => speed !== 1);
    const hasSegmentSplits = segmentBoundaries.length > 2;
    return hasCropEdits || hasTrimEdits || hasSpeedEdits || hasSegmentSplits;
  }, [keyframes, trimRange, segmentSpeeds, segmentBoundaries]);

  // Check if we have multiple clips (requires export before overlay)
  const hasMultipleClips = clips.length > 1;

  // DERIVED STATE: Effective overlay video (pass-through or rendered)
  const effectiveOverlayVideoUrl = useMemo(() => {
    if (overlayVideoUrl) return overlayVideoUrl;
    if (!hasMultipleClips && !hasFramingEdits && framingVideoUrl) return framingVideoUrl;
    return null;
  }, [overlayVideoUrl, hasMultipleClips, hasFramingEdits, framingVideoUrl]);

  const effectiveOverlayMetadata = useMemo(() => {
    if (overlayVideoMetadata) return overlayVideoMetadata;
    if (!hasMultipleClips && !hasFramingEdits && framingMetadata) return framingMetadata;
    return null;
  }, [overlayVideoMetadata, hasMultipleClips, hasFramingEdits, framingMetadata]);

  const effectiveOverlayFile = useMemo(() => {
    // T4270: there is no framing-file pass-through -- raw clips carry no File object
    // (they are streamed via file_url), so the old `framingVideoFile` branch was dead.
    if (overlayVideoFile) return overlayVideoFile;
    return null;
  }, [overlayVideoFile]);

  // =========================================
  // SPOTLIGHT LOOP PLAYBACK (T5370)
  // =========================================
  // Primary "Play spotlight" loops the span of ALL highlight regions; the
  // de-emphasized "Play full" plays straight through. `spotlightPlayMode` is
  // EPHEMERAL view state — never persisted, never restored (a stale saved
  // play-mode would read as a broken player). Reset to 'loop' on clip change.
  const LOOP_EPS = 0.03; // ~1 frame at 30fps; mirrors useSpotlightLoop
  const [spotlightPlayMode, setSpotlightPlayMode] = useState('loop');

  // Span is derived from highlightRegions (single source) — no duplicated state.
  // Null when there are zero regions (nothing to loop).
  const spotlightSpan = useMemo(() => {
    if (!highlightRegions?.length) return null;
    const start = Math.min(...highlightRegions.map(r => r.startTime));
    const end = Math.max(...highlightRegions.map(r => r.endTime));
    return { start, end };
  }, [highlightRegions]);

  // Reset play-mode when the overlay clip changes (new video URL). This is a
  // lifecycle reset of ephemeral view state, NOT reactive persistence.
  useEffect(() => { setSpotlightPlayMode('loop'); }, [effectiveOverlayVideoUrl]);

  // The playhead has run past the spotlight — surfaces the "Back to spotlight" pill.
  // Gated on effectiveOverlayVideoUrl (set only once a working video load succeeds,
  // or a valid framing-passthrough applies -- see the useMemo above), NOT duration:
  // duration/currentTime live in the SHARED useVideo hook and keep Framing's last
  // values while Overlay's own video is loading or has failed to load, so a
  // duration > 0 check alone still let the pill show before this video ever loaded
  // (2026-08-20 user report; first fix attempt via duration was insufficient).
  const isPastSpotlight = !!spotlightSpan && !!effectiveOverlayVideoUrl && currentTime > spotlightSpan.end + LOOP_EPS;

  // Enforce the loop while playing in loop mode. seek() is ephemeral PLAYBACK
  // control (moves the <video> playhead), not a store/DB write — not a T350-class
  // persistence violation.
  useSpotlightLoop({
    playMode: spotlightPlayMode,
    span: spotlightSpan,
    currentTime,
    isPlaying,
    isSeeking,
    seek,
  });

  const handlePlaySpotlight = useCallback(() => {
    if (!spotlightSpan) { togglePlay(); return; } // no regions → plain play/pause
    // True play/pause toggle (T5450). If PLAYING, pressing pauses — the earlier bug
    // only ever called togglePlay() when paused, so a looping clip could never be
    // paused from this button. If PAUSED, enter loop mode, seek to the span start ONLY
    // when the playhead is outside [start, end), then play.
    if (!videoRef.current?.paused) { togglePlay(); return; } // playing → pause
    setSpotlightPlayMode('loop');
    const outside = currentTime < spotlightSpan.start || currentTime >= spotlightSpan.end;
    if (outside) seek(spotlightSpan.start);
    togglePlay(); // paused → play
  }, [spotlightSpan, currentTime, seek, togglePlay, videoRef]);

  const handlePlayFull = useCallback(() => {
    setSpotlightPlayMode('full');
    if (videoRef.current?.paused) togglePlay();
  }, [togglePlay, videoRef]);

  // T5658: "Reset" pill — seeks to time 0. Spotlight location isn't guaranteed,
  // so resetting to the start is the dependable behavior (was: return to spotlight span).
  const handleReturnToSpotlight = useCallback(() => {
    seek(0);
  }, [seek]);

  // Toggle for showing/hiding player detection boxes (default: visible)
  const [showPlayerBoxes, setShowPlayerBoxes] = useState(true);

  const togglePlayerBoxes = useCallback(() => {
    setShowPlayerBoxes(prev => !prev);
  }, []);

  const enablePlayerBoxes = useCallback(() => {
    setShowPlayerBoxes(true);
  }, []);

  // CLICKED DETECTION STATE:
  // When user clicks a green detection marker, we remember which detection they clicked.
  // This guarantees the boxes show regardless of where the browser's seek lands.
  // The clicked detection is cleared when the user plays or manually scrubs.
  const [clickedDetection, setClickedDetection] = useState(null);

  // Log detection frame map when regions change (one-time per region set)
  useEffect(() => {
    if (!highlightRegions?.length) return;
    const regionSummaries = highlightRegions.map(r => {
      const fps = r.fps || highlightRegionsFramerate || 30;
      const startFrame = Math.round(r.startTime * fps);
      const endFrame = Math.round(r.endTime * fps);
      const detFrames = (r.detections || []).map(d => d.frame ?? Math.round(d.timestamp * fps));
      return `  ${r.id}: frames[${startFrame}-${endFrame}] time[${r.startTime.toFixed(3)}-${r.endTime.toFixed(3)}]s fps=${fps} detectionFrames=[${detFrames.join(',')}]`;
    });
    console.log(`[DetectionSeek] REGION MAP (${highlightRegions.length} regions):\n${regionSummaries.join('\n')}`);
  }, [highlightRegions, highlightRegionsFramerate]);

  // Player detection for click-to-track feature
  // When clickedDetection is set, bypass region check — the user explicitly clicked a marker,
  // so detection must stay enabled even if browser seek lands slightly outside the region boundary.
  const playerDetectionEnabled = editorMode === EDITOR_MODES.OVERLAY &&
    (clickedDetection != null || isTimeInEnabledRegion(currentTime));

  /**
   * Park the player on a detection marker: show its boxes AND seek the
   * playhead to its exact frame. The single entry point for "land on marker
   * X" — a direct timeline tap (DetectionMarkerLayer), the guided walk's
   * entry-park, and its auto-advance all route through this one function so
   * the seek logic lives in exactly one place.
   *
   * @param {{regionId, frame, fps, timestamp, boxes, videoWidth, videoHeight}} marker
   */
  const parkOnDetection = useCallback((marker) => {
    console.log(`[DetectionSeek] SET clickedDetection frame=${marker.frame} boxes=${marker.boxes?.length} regionId=${marker.regionId}`);
    setClickedDetection(marker);
    // Seek to the exact frame time (no offset) — the backend already uses
    // math.ceil() for first-frame detection to avoid clip-boundary ambiguity.
    if (marker.frame !== undefined && marker.fps) {
      const seekTarget = frameToTime(marker.frame, marker.fps);
      console.log(`[DetectionSeek] PARK frame=${marker.frame} fps=${marker.fps} seekTarget=${seekTarget.toFixed(6)}s`);
      seek(seekTarget);
    } else {
      console.warn(`[OverlayContainer] Missing frame/fps data for marker at ${marker.timestamp}s - using timestamp. Re-export framing to fix.`);
      seek(marker.timestamp);
    }
  }, [seek]);

  // Guided athlete-pick walk (T11570) — entry-park, "Got it" confirm,
  // forward-then-wrap auto-advance through every unpicked marker. See
  // useGuidedAthletePick for the full state machine; this container only
  // feeds it inputs and calls scheduleGuidedAdvance from the pick handlers.
  //
  // `canPark` gates entry-park on regions actually having loaded AND the
  // video's duration being known -- `seek()` silently refuses otherwise
  // (T10750), which would set clickedDetection with NOTHING actually seeked,
  // then the scrub-away-clear effect wipes it on the next tick, landing the
  // guide in 'away' with nothing real tracked. `overlaySyncState === 'ready'`
  // (scoped to THIS project via overlayLoadedProjectId) is the SAME signal
  // OverlayScreen's own `canSyncActions` already uses for "the data for this
  // project has loaded" -- reused here, not a second readiness concept.
  // `sessionKey` resets the hook's one-shot entry-park latch per loaded
  // project (a fresh clip's data arriving gets its own entry-park).
  const canPark = overlaySyncState === 'ready' &&
    overlayLoadedProjectId === selectedProjectId && duration > 0;
  const guidedPick = useGuidedAthletePick({
    active: editorMode === EDITOR_MODES.OVERLAY,
    canPark,
    sessionKey: overlayLoadedProjectId,
    highlightRegions,
    isPlaying,
    showPlayerBoxes,
    clickedDetection,
    parkOnDetection,
  });

  // Clear clicked detection when user starts playing (they're moving away from the marker)
  useEffect(() => {
    if (isPlaying && clickedDetection) {
      setClickedDetection(null);
    }
  }, [isPlaying, clickedDetection]);

  // Clear clicked detection when user scrubs away from the clicked frame
  // This prevents stale boxes from showing when extending regions or scrubbing
  useEffect(() => {
    if (!clickedDetection) return;

    const fps = highlightRegionsFramerate || 30;
    const currentFrame = Math.round(currentTime * fps);
    const clickedFrame = clickedDetection.frame;

    // Use same threshold as regionDetectionData (±2 frames)
    const DETECTION_FRAME_THRESHOLD = 2;
    const frameDistance = Math.abs(currentFrame - clickedFrame);

    if (frameDistance > DETECTION_FRAME_THRESHOLD) {
      console.log(`[DetectionSeek] CLEAR clickedDetection: currentFrame=${currentFrame} clickedFrame=${clickedFrame} distance=${frameDistance} currentTime=${currentTime.toFixed(6)}s`);
      setClickedDetection(null);
    }
  }, [currentTime, clickedDetection, highlightRegionsFramerate]);

  // Get detection data from the current highlight region (stored during framing export)
  // This replaces the old usePlayerDetection hook that fetched from a per-frame cache
  //
  // CLICKED DETECTION PRIORITY:
  // If user clicked a green detection marker, show that detection DIRECTLY.
  // This bypasses all timing calculations and guarantees boxes appear.
  //
  // FRAME-BASED DETECTION MATCHING (fallback):
  // We use frame numbers (integers) instead of timestamps (floats) for matching.
  // This avoids floating-point precision issues and accounts for video seeking
  // imprecision (browsers seek to nearest keyframe, not exact requested time).
  const regionDetectionData = useMemo(() => {
    // PRIORITY 1: If user clicked a detection marker, show that detection directly
    // This is immune to browser seek imprecision - clicking green marker ALWAYS shows boxes
    if (clickedDetection && clickedDetection.boxes?.length > 0) {
      console.log(`[DetectionSeek] RENDER via clickedDetection frame=${clickedDetection.frame} playerDetectionEnabled=${playerDetectionEnabled} currentTime=${currentTime.toFixed(6)}s`);
      return {
        detections: clickedDetection.boxes,
        videoWidth: clickedDetection.videoWidth || 0,
        videoHeight: clickedDetection.videoHeight || 0,
        hasDetections: true
      };
    }

    // PRIORITY 2: Frame-based matching (for scrubbing/playback)
    if (!playerDetectionEnabled || !highlightRegions?.length) {
      return { detections: [], videoWidth: 0, videoHeight: 0, hasDetections: false };
    }

    // Find the current region based on currentTime
    // Note: regions use camelCase (startTime/endTime) from useHighlightRegions
    const currentRegion = highlightRegions.find(
      region => region.enabled && currentTime >= region.startTime && currentTime <= region.endTime
    );

    if (!currentRegion?.detections?.length) {
      return { detections: [], videoWidth: 0, videoHeight: 0, hasDetections: false };
    }

    // Get fps from region (set during framing export) or use default
    const fps = currentRegion.fps || highlightRegionsFramerate || 30;

    // Calculate current frame from currentTime (integer comparison is more reliable)
    const currentFrame = Math.round(currentTime * fps);

    const { detection: selectedDetection, frameDistance: selectedFrameDistance } =
      selectRegionDetection(currentRegion.detections, currentFrame, fps);

    if (!selectedDetection) {
      return {
        detections: [],
        videoWidth: currentRegion.videoWidth || 0,
        videoHeight: currentRegion.videoHeight || 0,
        hasDetections: currentRegion.detections.some(d => d.boxes?.length > 0)
      };
    }

    // Diagnostic: log detection match details for debugging box alignment
    const detectionFrame = selectedDetection.frame !== undefined
      ? selectedDetection.frame
      : Math.round(selectedDetection.timestamp * fps);
    console.debug('[Detection Match]', {
      currentTime: currentTime.toFixed(3),
      currentFrame,
      detectionFrame,
      frameDelta: selectedFrameDistance,
      detectionTimestamp: selectedDetection.timestamp?.toFixed(3),
      regionVideoSize: `${currentRegion.videoWidth}x${currentRegion.videoHeight}`,
      fps,
      boxCount: selectedDetection.boxes?.length || 0,
      regionId: currentRegion.id,
      regionLabel: currentRegion.label,
    });

    return {
      detections: selectedDetection.boxes || [],
      videoWidth: currentRegion.videoWidth || 0,
      videoHeight: currentRegion.videoHeight || 0,
      hasDetections: true
    };
  }, [clickedDetection, playerDetectionEnabled, highlightRegions, currentTime, highlightRegionsFramerate]);

  const playerDetections = regionDetectionData.detections;
  const isDetectionLoading = false; // No longer loading from API
  const regionHasDetections = regionDetectionData.hasDetections;

  // DERIVED STATE: Current highlight state
  // Uses global highlightColor from store (null = None/brightness boost, color = colored overlay)
  const currentHighlightState = useMemo(() => {
    // Pass through highlightColor directly - null means "None" (brightness boost)
    // Don't fall back to yellow, let null propagate to preview/export
    const effectiveColor = highlightColor;  // Can be null

    if (dragHighlight) {
      return {
        x: dragHighlight.x,
        y: dragHighlight.y,
        radiusX: dragHighlight.radiusX,
        radiusY: dragHighlight.radiusY,
        opacity: dragHighlight.opacity,
        color: effectiveColor
      };
    }

    if (!isTimeInEnabledRegion(currentTime)) {
      return null;
    }

    const highlight = getRegionHighlightAtTime(currentTime);
    if (!highlight) return null;

    return {
      x: highlight.x,
      y: highlight.y,
      radiusX: highlight.radiusX,
      radiusY: highlight.radiusY,
      opacity: highlight.opacity,
      color: effectiveColor
    };
  }, [dragHighlight, currentTime, isTimeInEnabledRegion, getRegionHighlightAtTime, highlightColor]);

  /**
   * quest_3 "Pick your player" completes only when EVERY detected frame (every
   * green marker on the timeline) has a player assigned — not just one marker
   * per region. A detection frame is assigned when its region has a user
   * (non-boundary) keyframe at that frame's time. `currentRegionId` + `assignedTime`
   * describe the assignment made in this same gesture, whose keyframe isn't yet
   * in `highlightRegions` (setRegions is async).
   */
  const maybeEmitPlayersAssigned = useCallback((currentRegionId, assignedTime = null) => {
    if (!highlightRegions?.length) return;
    const justAssigned =
      currentRegionId != null ? { regionId: currentRegionId, time: assignedTime } : null;
    const { total, assigned } = countDetectionAssignments(highlightRegions, justAssigned);
    if (total > 0 && assigned >= total) {
      useQuestStore.getState().recordAchievement('overlay_players_assigned');
    }
  }, [highlightRegions]);

  /**
   * Mirror per-detection assignment progress into the quest store so the
   * select_players step can show one checkbox per detection that fills in as
   * the user assigns each. This is EPHEMERAL display state only — it is never
   * persisted (no backend write), so it does not violate the gesture-based
   * persistence rule. The quest-completion write stays in maybeEmitPlayersAssigned.
   */
  useEffect(() => {
    const setProgress = useQuestStore.getState().setDetectionAssignProgress;
    if (editorMode !== EDITOR_MODES.OVERLAY) {
      setProgress(null);
      return;
    }
    const states = detectionAssignmentStates(highlightRegions);
    setProgress(states.length > 0 ? states : null);
  }, [editorMode, highlightRegions]);

  // Clear progress when the container unmounts so a stale count never shows elsewhere.
  useEffect(() => () => useQuestStore.getState().setDetectionAssignProgress(null), []);

  /**
   * Handle player selection from detection overlay
   */
  const handlePlayerSelect = useCallback((playerData) => {
    // When a detection marker is parked, the browser's seek lands NEAR but not
    // exactly on the detection frame. Anchoring the keyframe to the detection's
    // exact timestamp (not the imprecise currentTime) guarantees it falls within
    // ASSIGN_TOLERANCE_S so the marker counts as assigned and quest_3 completes.
    const assignTime = clickedDetection?.timestamp ?? currentTime;
    const region = getRegionAtTime(assignTime);
    if (!region) {
      console.warn('[OverlayContainer] No highlight region at assignment time');
      return;
    }

    const defaultOpacity = currentHighlightState?.opacity ?? 0.3;
    // Use global highlight color (null = None/brightness boost)
    const defaultColor = highlightColor;  // Can be null

    const highlight = {
      x: playerData.x,
      y: playerData.y,
      radiusX: playerData.radiusX,
      radiusY: playerData.radiusY,
      opacity: defaultOpacity,
      color: defaultColor,
      fromDetection: true,  // Mark keyframe as created from player detection
    };

    console.log('[OverlayContainer] Player detected, creating keyframe:', {
      time: currentTime,
      position: { x: playerData.x, y: playerData.y },
      region: { start: region.startTime, end: region.endTime }
    });

    addHighlightRegionKeyframe(assignTime, highlight, duration);
    maybeEmitPlayersAssigned(region.id, assignTime);
    // Guided walk: brief "Got it" confirm, then auto-advance to the next
    // unpicked marker. Scheduled synchronously in this gesture handler.
    guidedPick.scheduleGuidedAdvance(region.id, assignTime);
  }, [currentTime, clickedDetection, duration, currentHighlightState, addHighlightRegionKeyframe, getRegionAtTime, highlightColor, maybeEmitPlayersAssigned, guidedPick]);

  /**
   * Handle highlight changes during drag/resize
   */
  const handleHighlightChange = useCallback((newHighlight) => {
    setDragHighlight(newHighlight);
  }, []);

  /**
   * Fires at POINTERDOWN -- before the first move -- on any grab of the highlight
   * circle (body drag, a resize handle, or the display-only tap-to-enter target).
   * Must cancel a pending guided-pick advance from a PRIOR release here, not on
   * first move: the user can press-and-hold before moving (ordinary deciding-
   * where-to-drag behavior), and pointer capture keeps THIS gesture alive through
   * any seek the timer below would trigger -- so a cancel on first move alone
   * leaves a window where the timer fires while the pointer is already captured,
   * parking/seeking onto the next marker before the user has moved at all. The
   * eventual release then reschedules fresh from whichever marker is actually
   * parked at that point (T11570 review round 4 MAJOR; round 3 fixed the
   * first-move case, this covers the pointerdown-to-first-move gap it left open).
   */
  const handleHighlightDragStart = useCallback(() => {
    guidedPick.cancelPendingAdvance();
  }, [guidedPick]);

  /**
   * Handle highlight complete (create/update keyframe in enabled region)
   */
  const handleHighlightComplete = useCallback((highlightData) => {
    // Same snap-to-detection rationale as handlePlayerSelect: moving/resizing the
    // spotlight while parked on a marker must land the keyframe on the detection's
    // exact frame so it counts as assigning that detection.
    const assignTime = clickedDetection?.timestamp ?? currentTime;
    if (!isTimeInEnabledRegion(assignTime)) {
      console.warn('[OverlayContainer] Cannot add highlight keyframe - not in enabled region');
      setDragHighlight(null);
      return;
    }

    const frame = Math.round(assignTime * highlightRegionsFramerate);
    console.log(`[OverlayContainer] Highlight keyframe at ${assignTime.toFixed(2)}s (frame ${frame})`);

    // Mark as an assignment so it counts even when it lands on a region boundary
    // keyframe (edge detection frames). See isDetectionAssigned.
    addHighlightRegionKeyframe(assignTime, { ...highlightData, fromDetection: true });
    setDragHighlight(null);
    const region = getRegionAtTime(assignTime);
    if (region) {
      maybeEmitPlayersAssigned(region.id, assignTime);
      // Guided walk: same "Got it" confirm + auto-advance as handlePlayerSelect.
      guidedPick.scheduleGuidedAdvance(region.id, assignTime);
    }
  }, [currentTime, clickedDetection, highlightRegionsFramerate, isTimeInEnabledRegion, addHighlightRegionKeyframe, getRegionAtTime, maybeEmitPlayersAssigned, guidedPick]);

  // NOTE: Effects for highlight region initialization and persistence are in OverlayScreen.jsx
  // OverlayContainer only provides derived state and handlers to avoid duplicate effects

  return {
    // Video state
    overlayVideoUrl,
    overlayVideoMetadata,
    overlayVideoFile,
    isLoadingWorkingVideo,
    effectiveOverlayVideoUrl,
    effectiveOverlayMetadata,
    effectiveOverlayFile,

    // Highlight regions
    highlightRegions,
    highlightBoundaries,
    highlightRegionKeyframes,
    highlightRegionsFramerate,
    currentHighlightState,

    // Highlight region actions
    addHighlightRegion,
    deleteHighlightRegion,
    moveHighlightRegionStart,
    moveHighlightRegionEnd,
    commitHighlightRegionStart,
    commitHighlightRegionEnd,
    toggleHighlightRegion,
    addHighlightRegionKeyframe,
    removeHighlightRegionKeyframe,
    resetHighlightRegions,
    getRegionsForExport,
    isTimeInEnabledRegion,

    // Highlight effect
    highlightEffectType,
    setHighlightEffectType,
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,

    // Player detection (from highlight region data, not per-frame API)
    playerDetectionEnabled,
    playerDetections,
    detectionVideoWidth: regionDetectionData.videoWidth,
    detectionVideoHeight: regionDetectionData.videoHeight,
    isDetectionLoading,
    regionHasDetections,  // Whether current region has any detection data
    showPlayerBoxes,
    togglePlayerBoxes,
    enablePlayerBoxes,
    onDetectionMarkerTap: guidedPick.handleDetectionMarkerTap,  // Direct timeline tap: cancels pending auto-advance, re-parks, tracks step
    pickGuidePhase: guidedPick.phase,    // null | 'parked' | 'confirm' | 'away' | 'done'
    pickGuideStep: guidedPick.step,      // 1-based active marker number, or null
    pickGuideTotal: guidedPick.total,    // total detection markers across all regions
    onResumePickGuideStep: guidedPick.resumeTrackedMarker,  // "Go to step N" (away state)

    // Derived state
    hasFramingEdits,
    hasMultipleClips,

    // Spotlight loop playback (T5370)
    spotlightSpan,
    spotlightPlayMode,
    isPastSpotlight,
    handlePlaySpotlight,
    handlePlayFull,
    handleReturnToSpotlight,

    // Handlers
    handlePlayerSelect,
    handleHighlightChange,
    handleHighlightComplete,
    handleHighlightDragStart,

    // Persistence
    overlaySyncState,
    overlayLoadedProjectId,

    // State setters (for external use)
    setOverlayClipMetadata,
    setIsLoadingWorkingVideo,
  };
}

/**
 * OverlayVideoOverlays - Video overlay components for Overlay mode
 */
export function OverlayVideoOverlays({
  effectiveOverlayVideoUrl,
  effectiveOverlayMetadata,
  currentHighlightState,
  onHighlightChange,
  onHighlightComplete,
  isTimeInEnabledRegion,
  currentTime,
  highlightEffectType,
  zoom,
  panOffset,
  videoRef,
  // Player detection (auto-detected during framing export - U8)
  playerDetectionEnabled,
  playerDetections,
  detectionVideoWidth,
  detectionVideoHeight,
  isDetectionLoading,
  showPlayerBoxes,
  onPlayerSelect,
}) {
  if (!effectiveOverlayVideoUrl) return null;

  // Show detection boxes if: enabled, has detections, and boxes are toggled on
  const shouldShowDetections = playerDetectionEnabled && playerDetections?.length > 0 && showPlayerBoxes;

  return (
    <>
      {/* Highlight overlay */}
      {currentHighlightState && effectiveOverlayMetadata && (
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
        />
      )}

      {/* Player detection overlay - shows boxes when detected (auto-detection from framing export) */}
      {effectiveOverlayMetadata && shouldShowDetections && (
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
        />
      )}
    </>
  );
}

/**
 * OverlayTimeline - Timeline component for Overlay mode
 */
export function OverlayTimeline({
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  highlightRegions,
  highlightBoundaries,
  highlightKeyframes,
  highlightFramerate,
  onAddHighlightRegion,
  onDeleteHighlightRegion,
  onMoveHighlightRegionStart,
  onMoveHighlightRegionEnd,
  onRemoveHighlightKeyframe,
  onToggleHighlightRegion,
  onSelectedKeyframeChange,
  onHighlightChange,
  onHighlightComplete,
  zoom,
  panOffset,
  visualDuration,
  selectedLayer,
  onLayerSelect,
  onSeek,
  onDetectionMarkerClick,  // Called when user clicks a green detection marker
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  timelineZoom,
  onTimelineZoomByWheel,
  timelineZoomControls, // T10930: {zoomIn, zoomOut, resetZoom} -> TimelineZoomChip
  timelineScale,
  timelineScrollPosition,
  onTimelineScrollPositionChange,
  trimRange,
  isPlaying,
}) {
  return (
    <OverlayMode
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      currentTime={currentTime}
      duration={duration}
      highlightRegions={highlightRegions}
      highlightBoundaries={highlightBoundaries}
      highlightKeyframes={highlightKeyframes}
      highlightFramerate={highlightFramerate}
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
      visualDuration={visualDuration}
      selectedLayer={selectedLayer}
      onLayerSelect={onLayerSelect}
      onSeek={onSeek}
      onDetectionMarkerClick={onDetectionMarkerClick}
      sourceTimeToVisualTime={sourceTimeToVisualTime}
      visualTimeToSourceTime={visualTimeToSourceTime}
      timelineZoom={timelineZoom}
      onTimelineZoomByWheel={onTimelineZoomByWheel}
      timelineZoomControls={timelineZoomControls}
      timelineScale={timelineScale}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineScrollPositionChange={onTimelineScrollPositionChange}
      trimRange={trimRange}
      isPlaying={isPlaying}
    />
  );
}

export default OverlayContainer;
