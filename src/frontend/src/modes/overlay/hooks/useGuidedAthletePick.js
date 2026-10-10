import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  orderedDetectionMarkers,
  detectionAssignmentStates,
  nextUnpickedMarker,
  ASSIGN_TOLERANCE_S,
} from '../utils/detectionAssignment';

/** Brief "Got it" confirm pause after a pick, before auto-advancing. */
export const PICK_CONFIRM_MS = 650;

/**
 * Frames of playhead distance from the tracked marker that still counts as
 * "parked" on it (T11980). Mirrors OverlayContainer's own clickedDetection
 * scrub-away threshold (`DETECTION_FRAME_THRESHOLD`), but applied against
 * the TRACKED MARKER'S OWN fps rather than a region-agnostic fallback fps.
 */
const PARKED_FRAME_TOLERANCE = 2;

/**
 * 0ms under `prefers-reduced-motion` (task spec) — the confirm state still
 * shows (the check mark + "Got it" render), it just doesn't linger. Read at
 * call time rather than subscribed-to: the duration only matters at the
 * instant a pick schedules the advance, same precedent as other one-shot
 * media reads in this codebase (no live-updating React state needed for a
 * value used once per call).
 */
function getPickConfirmMs() {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 0;
  }
  return PICK_CONFIRM_MS;
}

/**
 * useGuidedAthletePick - Auto-walk the user through every unpicked detection
 * marker (T11570): entry-park on the first one, a brief "Got it" confirm
 * after each pick, then auto-advance to the next unpicked marker
 * (forward-then-wrap via `nextUnpickedMarker`), looping until all are
 * assigned.
 *
 * EPHEMERAL VIEW STATE ONLY — the walk's phase/active-marker/confirm-timer
 * live here in memory. The only DB write stays the existing per-pick
 * keyframe write the caller already makes (`addHighlightRegionKeyframe`);
 * this hook never persists anything itself. `scheduleGuidedAdvance` is
 * called SYNCHRONOUSLY from the pick gesture handler (never a `useEffect`
 * watching state), per the project's gesture-based persistence rule.
 *
 * @param {Object} params
 * @param {boolean} params.active - true only while the guided walk should be
 *   live (Overlay is the current editor mode). Flips to inactive -> clears
 *   tracked state and cancels any pending advance.
 * @param {boolean} params.canPark - true once a park is actually capable of
 *   landing: region/detection data has loaded AND the video's duration is
 *   known (`seek()` silently refuses otherwise, T10750). Entry-park WAITS
 *   for this rather than firing blind at mount with zero markers.
 * @param {*} params.sessionKey - identity of the current clip/load session
 *   (e.g. the loaded project id). Entry-park fires at most once per key —
 *   changing it (a new clip loaded) allows exactly one more entry-park.
 * @param {Array} params.highlightRegions - highlight regions (keyframes + detections)
 * @param {boolean} params.isPlaying - caller's video isPlaying
 * @param {boolean} params.showPlayerBoxes - caller's box-visibility toggle.
 *   false suspends the guide entirely: the OUTPUT phase is hidden (mirroring
 *   the pre-T11570 `awaitingPlayerSelection && showPlayerBoxes` contract) AND
 *   `scheduleGuidedAdvance` becomes a no-op, so an ordinary highlight edit
 *   made while boxes are hidden can never trigger an invisible auto-jump
 *   (T11570 review round 2 MAJOR fix). Tracked state (trackedMarkerIndex)
 *   is left untouched, so re-enabling boxes resumes exactly where the walk
 *   left off rather than restarting it; direct marker taps and "Go to
 *   step N" stay live regardless — those are explicit navigation, not an
 *   automatic advance.
 * @param {Object|null} params.clickedDetection - caller's parked-detection
 *   state (OverlayContainer) — null once play/scrub clears it ("away")
 * @param {Function} params.parkOnDetection - (marker) => void; shows boxes +
 *   seeks there (OverlayContainer.parkOnDetection)
 * @param {number} params.currentTime - caller's playhead position (seconds).
 *   Drives the 'parked' vs 'away' distinction directly (T11980): the tracked
 *   marker counts as PARKED when the playhead sits within
 *   `PARKED_FRAME_TOLERANCE` frames of it, measured using the marker's OWN
 *   `fps` — not `clickedDetection`'s mere presence. `clickedDetection` is
 *   cleared by OverlayContainer using `highlightRegionsFramerate` (a
 *   different, possibly-mismatched fps for mixed-fps regions), which could
 *   clear it even while the playhead is still genuinely on the marker by its
 *   own fps — showing "Go to frame N" (away) while the sidebar still said
 *   "(now)". Deriving phase from currentTime directly removes that
 *   possible disagreement.
 */
export function useGuidedAthletePick({
  active,
  canPark,
  sessionKey,
  highlightRegions,
  isPlaying,
  showPlayerBoxes = true,
  clickedDetection,
  parkOnDetection,
  currentTime,
}) {
  const pendingAdvanceRef = useRef(null);
  const [trackedMarkerIndex, setTrackedMarkerIndex] = useState(null);
  const [isConfirmingPick, setIsConfirmingPick] = useState(false);

  const orderedMarkers = useMemo(
    () => orderedDetectionMarkers(highlightRegions),
    [highlightRegions]
  );
  const total = orderedMarkers.length;
  const assignedCount = useMemo(
    () => detectionAssignmentStates(highlightRegions).filter(Boolean).length,
    [highlightRegions]
  );
  const done = total > 0 && assignedCount >= total;

  // Exposed in the return value too: the caller must cancel this the moment
  // a NEW drag starts (before its own release reschedules), so a confirm
  // timer from a PRIOR release can't fire mid-drag and park/seek out from
  // under geometry the user is actively tuning (T11570 review round 3 MAJOR).
  const cancelPendingAdvance = useCallback(() => {
    if (pendingAdvanceRef.current) {
      clearTimeout(pendingAdvanceRef.current);
      pendingAdvanceRef.current = null;
    }
    setIsConfirmingPick(false);
  }, []);

  const parkOnEntry = useCallback((entry) => {
    parkOnDetection({
      regionId: entry.regionId,
      frame: entry.detection.frame,
      fps: entry.region?.fps,
      timestamp: entry.detection.timestamp,
      boxes: entry.detection.boxes,
      videoWidth: entry.region?.videoWidth,
      videoHeight: entry.region?.videoHeight,
    });
    setTrackedMarkerIndex(entry.index);
  }, [parkOnDetection]);

  // Entry-park: becoming active with unpicked markers parks on the first
  // one. Fires AT MOST ONCE PER `sessionKey` (a ref-held one-shot latch, not
  // a dependency), and only once `canPark` is true (regions have actually
  // loaded AND the video's duration is known -- seek() silently no-ops
  // without it, T10750). Deliberately NOT keyed on `highlightRegions` itself
  // (which changes on every pick) -- the latch is what prevents re-parking
  // mid-walk, not an omitted dependency.
  const enteredForKeyRef = useRef(null);
  useEffect(() => {
    if (!active) {
      setTrackedMarkerIndex(null);
      cancelPendingAdvance();
      enteredForKeyRef.current = null;
      return;
    }
    if (!canPark || enteredForKeyRef.current === sessionKey) return;
    enteredForKeyRef.current = sessionKey;
    const first = nextUnpickedMarker(highlightRegions, -1);
    if (first) parkOnEntry(first);
    // highlightRegions/cancelPendingAdvance/parkOnEntry are deliberately NOT
    // dependencies: highlightRegions is read fresh via closure every time this
    // effect actually RUNS (gated by canPark/sessionKey above), and making it
    // a dependency would re-fire entry-park on every pick (which changes it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, canPark, sessionKey]);

  // The user is moving on themselves — playing, scrubbed away (the caller
  // nulls clickedDetection on both of those), or just hid the detection
  // boxes — so stop the guide from yanking the playhead out from under
  // them. The boxes-hidden case matters even for an advance that was
  // scheduled WHILE boxes were still visible: if the user hides them
  // during the 650ms confirm window, the pending advance must not still
  // fire into an invisible jump once they've gone.
  useEffect(() => {
    if (isPlaying || !clickedDetection || !showPlayerBoxes) cancelPendingAdvance();
  }, [isPlaying, clickedDetection, showPlayerBoxes, cancelPendingAdvance]);

  // Cancel on unmount.
  useEffect(() => cancelPendingAdvance, [cancelPendingAdvance]);

  /**
   * Call synchronously from the pick gesture handler (handlePlayerSelect /
   * handleHighlightComplete), right after the keyframe write, with the
   * ACTUAL (regionId, assignedTime) that was just picked. The picked marker
   * might not be `trackedMarkerIndex` — boxes can show, and be tapped,
   * whenever the playhead happens to sit near a detection frame (see
   * OverlayContainer.regionDetectionData), independent of what the guide is
   * currently tracking (e.g. parked 'away' on marker 3, user pauses on
   * marker 6 and picks it there). So the advance origin — and the step
   * number "Got it" displays during confirm — must be derived from the pick
   * itself, never trusted from stale tracked state. Shows "Got it" for
   * PICK_CONFIRM_MS (0ms under prefers-reduced-motion), then auto-advances.
   *
   * Two early-outs, both no-ops (never confirm, never schedule anything):
   *  - `pickedIndex === -1` — the caller fires this on EVERY highlight
   *    edit that lands in an enabled region (OverlayContainer.
   *    handleHighlightComplete), not just detection-marker picks. An
   *    ordinary manual reposition at a time with no marker is NOT an
   *    internal bug (hence no warning — this is an expected, legitimate
   *    case), it just has nothing for the guided walk to confirm or
   *    advance from.
   *  - `!showPlayerBoxes` — boxes hidden means the user is editing without
   *    the guide's help; auto-jumping the playhead to the next marker
   *    would be an invisible, unexplained seek with no guide shown to
   *    justify it (T11570 review round 2 MAJOR fix).
   */
  const scheduleGuidedAdvance = useCallback((regionId, assignedTime) => {
    if (!showPlayerBoxes) return;
    const pickedIndex = orderedMarkers.findIndex(
      (m) => m.regionId === regionId &&
        Math.abs(m.detection.timestamp - assignedTime) <= ASSIGN_TOLERANCE_S
    );
    if (pickedIndex === -1) return;

    cancelPendingAdvance();
    setTrackedMarkerIndex(pickedIndex); // confirm must show the marker ACTUALLY picked
    setIsConfirmingPick(true);
    pendingAdvanceRef.current = setTimeout(() => {
      pendingAdvanceRef.current = null;
      setIsConfirmingPick(false);
      const next = nextUnpickedMarker(
        highlightRegions,
        pickedIndex,
        { regionId, time: assignedTime }
      );
      if (next) parkOnEntry(next);
      else setTrackedMarkerIndex(null); // every marker picked — walk is done
    }, getPickConfirmMs());
  }, [showPlayerBoxes, cancelPendingAdvance, highlightRegions, orderedMarkers, parkOnEntry]);

  /**
   * A direct tap on ANY marker (assigned or not) cancels the pending
   * auto-advance and re-parks there, tracking its step number.
   */
  const handleDetectionMarkerTap = useCallback((marker) => {
    cancelPendingAdvance();
    parkOnDetection(marker);
    const idx = orderedMarkers.findIndex(
      (m) => m.regionId === marker.regionId &&
        Math.abs(m.detection.timestamp - marker.timestamp) <= ASSIGN_TOLERANCE_S
    );
    if (idx === -1) {
      console.warn(
        '[useGuidedAthletePick] Tapped marker not found in orderedDetectionMarkers -- step display cleared.',
        marker
      );
    }
    setTrackedMarkerIndex(idx >= 0 ? idx : null);
  }, [cancelPendingAdvance, parkOnDetection, orderedMarkers]);

  /** "Go to step N" (away state) — re-parks on the tracked marker. */
  const resumeTrackedMarker = useCallback(() => {
    if (trackedMarkerIndex == null) return;
    const entry = orderedMarkers[trackedMarkerIndex];
    if (entry) parkOnEntry(entry);
  }, [trackedMarkerIndex, orderedMarkers, parkOnEntry]);

  // T11980 (b): is the playhead actually sitting on the tracked marker right
  // now? Measured against THAT marker's own fps, not a region-agnostic
  // fallback -- see the `currentTime` param doc for why this replaced a bare
  // `clickedDetection` truthiness check (clickedDetection can clear from a
  // DIFFERENT fps mismatch while the playhead is still genuinely on the
  // marker by its own fps).
  const isParkedAtTrackedMarker = useMemo(() => {
    if (trackedMarkerIndex == null) return false;
    const marker = orderedMarkers[trackedMarkerIndex];
    if (!marker || currentTime == null) return false;
    const fps = marker.region?.fps || 30;
    const toleranceS = PARKED_FRAME_TOLERANCE / fps;
    return Math.abs(currentTime - marker.detection.timestamp) <= toleranceS;
  }, [trackedMarkerIndex, orderedMarkers, currentTime]);

  // Order matters: 'confirm'/'parked' are checked BEFORE 'done' so that tapping
  // a marker to revisit it after the whole walk is finished shows "Picking"
  // (Confirming on a re-pick) for that marker, then falls back to 'done' once
  // it's no longer actively tracked — never stuck re-showing 'away' for a walk
  // that has nothing left to pick.
  const internalPhase = total === 0 ? null
    : isConfirmingPick ? 'confirm'
    : (trackedMarkerIndex != null && isParkedAtTrackedMarker) ? 'parked'
    : done ? 'done'
    : trackedMarkerIndex != null ? 'away'
    : null;

  // Boxes hidden -> suspend the guide's OUTPUT entirely (pre-T11570 contract:
  // `awaitingPlayerSelection && showPlayerBoxes`). The state machine above
  // keeps running underneath so re-enabling boxes resumes exactly where the
  // walk left off, rather than restarting it.
  const phase = showPlayerBoxes ? internalPhase : null;

  return {
    phase, // null | 'parked' | 'confirm' | 'away' | 'done'
    step: trackedMarkerIndex != null ? trackedMarkerIndex + 1 : null,
    total,
    atMarker: isParkedAtTrackedMarker,
    scheduleGuidedAdvance,
    cancelPendingAdvance,
    handleDetectionMarkerTap,
    resumeTrackedMarker,
  };
}

export default useGuidedAthletePick;
