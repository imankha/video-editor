// T9330: single source of truth for a clip's stage-aware primary CTA, shared by
// the desktop under-canvas strip (AnnotateFullscreenOverlay layout="strip") and
// the sidebar (ClipDetailsEditor). Before this, each surface computed its own
// stage with its own vocabulary — two computations, one underlying state.
//
// VOCABULARY (see T9330-design §0.1): the thing `region.autoProjectId` points at
// is that CLIP'S OWN PROJECT (its Focus/Overlay-produced video), NOT a "reel".
// "Reel"/"Highlight Reel" is reserved for the separate multi-clip published
// object. So this module talks about the clip's project, never a reel.
//
// Composes two carried-over invariants:
//   - T8070 staleness: a produced stage is only surfaced while the clip's CURRENT
//     boundaries still match the snapshot the video was produced from
//     (`reelSourceStartTime`/`reelSourceEndTime`, EXACT equality, no epsilon —
//     a genuine nudge is a real drift). A drift demotes back to FOCUS.
//   - T8470 Part D: a fresh draft project (no snapshot, no produced video) is a
//     live link into Focus, never an actionable "create" dead end.
//
// T9580 (N41): the FOCUS-stage label is "Frame this clip" (the first-clip
// invitation wording), single-sourced from displayNames.ANNOTATE so the desktop
// strip and the sidebar share it. Later stages keep their T9320/T9330 labels.

import { ANNOTATE } from '../../config/displayNames';

export const CLIP_STAGE = {
  // The clip has no project yet — manual-create territory (ClipDetailsEditor's
  // "Create Clip" affordance). NOT this CTA's job; the stage CTA only renders
  // once a project exists (or is being created — the overlay shows a disabled
  // "Apply AI Focus" during that in-flight window via its own `focusPending`).
  NO_PROJECT: 'NO_PROJECT',
  // A project exists but no working video yet (fresh draft, drifted, or a
  // below-migration project with a null snapshot) — open it in AI Focus.
  FOCUS: 'FOCUS',
  // has_working_video, no final — next step is Spotlight (Overlay mode).
  SPOTLIGHT: 'SPOTLIGHT',
  // has_final_video, not yet published.
  FINAL: 'FINAL',
  // is_published.
  PUBLISHED: 'PUBLISHED',
};

/**
 * getClipStage — the ordered stage table for a clip's own project.
 *
 * @param {object} region        the clip region (reads autoProjectId, startTime,
 *                               endTime, reelSourceStartTime, reelSourceEndTime)
 * @param {object|null} linkedProject the project row (reads has_working_video,
 *                               has_final_video, is_published)
 * @returns {{stage: string, label: string, action: 'focus'|'overlay'|null}}
 *          `action` is a token each surface maps to its own navigation prop
 *          (onOpenInFocus / onOpenInOverlay); null = disabled / not this CTA.
 *
 * Order matters — first match wins.
 */
export function getClipStage(region, linkedProject) {
  const hasProject = !!region?.autoProjectId;
  if (!hasProject) {
    return { stage: CLIP_STAGE.NO_PROJECT, label: 'Create Clip', action: null };
  }

  // T8070: exact-equality staleness gate (no epsilon).
  const projectReflectsClip =
    region.reelSourceStartTime != null &&
    region.reelSourceEndTime != null &&
    region.startTime === region.reelSourceStartTime &&
    region.endTime === region.reelSourceEndTime;

  // T8470 Part D: fresh draft — a project exists but has no snapshot and no
  // produced video yet. A live link into Focus, never a dead end.
  const projectIsFreshDraft =
    region.reelSourceStartTime == null &&
    region.reelSourceEndTime == null &&
    !linkedProject?.has_working_video &&
    !linkedProject?.has_final_video;

  if (projectReflectsClip && linkedProject?.has_final_video) {
    return linkedProject.is_published
      ? { stage: CLIP_STAGE.PUBLISHED, label: 'View Published', action: 'focus' }
      : { stage: CLIP_STAGE.FINAL, label: 'View Final', action: 'focus' };
  }
  if (projectReflectsClip && linkedProject?.has_working_video) {
    return { stage: CLIP_STAGE.SPOTLIGHT, label: 'Apply Spotlight', action: 'overlay' };
  }
  if (projectReflectsClip) {
    return { stage: CLIP_STAGE.FOCUS, label: ANNOTATE.FRAME_THIS_CLIP, action: 'focus' };
  }
  if (projectIsFreshDraft) {
    // Subsumes the old "Open clip (Draft)" label.
    return { stage: CLIP_STAGE.FOCUS, label: ANNOTATE.FRAME_THIS_CLIP, action: 'focus' };
  }
  // Drifted (non-null snapshot, boundaries moved) OR below-migration (produced
  // video but null snapshot): the project EXISTS, so it should open — never fall
  // back to offering to re-create it (T9330 deliberate change).
  return { stage: CLIP_STAGE.FOCUS, label: ANNOTATE.FRAME_THIS_CLIP, action: 'focus' };
}
