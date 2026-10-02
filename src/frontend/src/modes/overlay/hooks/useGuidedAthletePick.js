import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  orderedDetectionMarkers,
  detectionAssignmentStates,
  nextUnpickedMarker,
} from '../utils/detectionAssignment';

/** Brief "Got it" confirm pause after a pick, before auto-advancing. */
export const PICK_CONFIRM_MS = 650;

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
 * @param {Array} params.highlightRegions - highlight regions (keyframes + detections)
 * @param {boolean} params.isPlaying - caller's video isPlaying
 * @param {Object|null} params.clickedDetection - caller's parked-detection
 *   state (OverlayContainer) — null once play/scrub clears it ("away")
 * @param {Function} params.parkOnDetection - (marker) => void; shows boxes +
 *   seeks there (OverlayContainer.parkOnDetection)
 */
export function useGuidedAthletePick({
  active,
  highlightRegions,
  isPlaying,
  clickedDetection,
  parkOnDetection,
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
  // one. Keyed ONLY on `active` — never on highlightRegions, which changes
  // on every pick and must never re-trigger entry-park mid-walk.
  useEffect(() => {
    if (!active) {
      setTrackedMarkerIndex(null);
      cancelPendingAdvance();
      return;
    }
    const first = nextUnpickedMarker(highlightRegions, -1);
    if (first) parkOnEntry(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // The user is moving on themselves — playing, or scrubbed away (the
  // caller nulls clickedDetection on both of those) — so stop the guide
  // from yanking the playhead out from under them.
  useEffect(() => {
    if (isPlaying || !clickedDetection) cancelPendingAdvance();
  }, [isPlaying, clickedDetection, cancelPendingAdvance]);

  // Cancel on unmount.
  useEffect(() => cancelPendingAdvance, [cancelPendingAdvance]);

  /**
   * Call synchronously from the pick gesture handler (handlePlayerSelect /
   * handleHighlightComplete), right after the keyframe write. Shows "Got it"
   * for PICK_CONFIRM_MS, then auto-advances to the next unpicked marker.
   */
  const scheduleGuidedAdvance = useCallback((regionId, assignedTime) => {
    cancelPendingAdvance();
    setIsConfirmingPick(true);
    pendingAdvanceRef.current = setTimeout(() => {
      pendingAdvanceRef.current = null;
      setIsConfirmingPick(false);
      const next = nextUnpickedMarker(
        highlightRegions,
        trackedMarkerIndex ?? -1,
        { regionId, time: assignedTime }
      );
      if (next) parkOnEntry(next);
      else setTrackedMarkerIndex(null); // every marker picked — walk is done
    }, PICK_CONFIRM_MS);
  }, [cancelPendingAdvance, highlightRegions, trackedMarkerIndex, parkOnEntry]);

  /**
   * A direct tap on ANY marker (assigned or not) cancels the pending
   * auto-advance and re-parks there, tracking its step number.
   */
  const handleDetectionMarkerTap = useCallback((marker) => {
    cancelPendingAdvance();
    parkOnDetection(marker);
    const idx = orderedMarkers.findIndex(
      (m) => m.regionId === marker.regionId &&
        Math.abs(m.detection.timestamp - marker.timestamp) < 0.001
    );
    setTrackedMarkerIndex(idx >= 0 ? idx : null);
  }, [cancelPendingAdvance, parkOnDetection, orderedMarkers]);

  /** "Go to step N" (away state) — re-parks on the tracked marker. */
  const resumeTrackedMarker = useCallback(() => {
    if (trackedMarkerIndex == null) return;
    const entry = orderedMarkers[trackedMarkerIndex];
    if (entry) parkOnEntry(entry);
  }, [trackedMarkerIndex, orderedMarkers, parkOnEntry]);

  // Order matters: 'confirm'/'parked' are checked BEFORE 'done' so that tapping
  // a marker to revisit it after the whole walk is finished shows "Picking"
  // (Confirming on a re-pick) for that marker, then falls back to 'done' once
  // it's no longer actively tracked — never stuck re-showing 'away' for a walk
  // that has nothing left to pick.
  const phase = total === 0 ? null
    : isConfirmingPick ? 'confirm'
    : (clickedDetection && trackedMarkerIndex != null) ? 'parked'
    : done ? 'done'
    : trackedMarkerIndex != null ? 'away'
    : null;

  return {
    phase, // null | 'parked' | 'confirm' | 'away' | 'done'
    step: trackedMarkerIndex != null ? trackedMarkerIndex + 1 : null,
    total,
    scheduleGuidedAdvance,
    handleDetectionMarkerTap,
    resumeTrackedMarker,
  };
}

export default useGuidedAthletePick;
