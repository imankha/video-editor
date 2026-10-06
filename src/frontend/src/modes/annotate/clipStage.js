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
// T9580 (N41): the FOCUS-stage label is "Frame" (shortened 2026-09-18 from the
// first-clip invitation wording "Frame this clip"), single-sourced from
// displayNames.ANNOTATE so the desktop strip and the sidebar share it. Later
// stages keep their T9320/T9330 labels.

import { ANNOTATE } from '../../config/displayNames';

export const CLIP_STAGE = {
  // The play has no highlight project yet. The main CTA creates it and opens
  // Framing in one gesture.
  NO_PROJECT: 'NO_PROJECT',
  // A project exists but no working video yet (fresh draft, drifted, or a
  // below-migration project with a null snapshot) — open it in Framing.
  FOCUS: 'FOCUS',
  // has_working_video, no final — next step is Spotlight (Overlay mode).
  SPOTLIGHT: 'SPOTLIGHT',
  // has_final_video, not yet published.
  FINAL: 'FINAL',
  // is_published.
  PUBLISHED: 'PUBLISHED',
};

export const HIGHLIGHT_STATUS = {
  NOT_STARTED: 'Highlight Not Started',
  CLIPPED: 'Clipped',
  FRAMING: 'Framing',
  FRAMED: 'Framed',
  SPOTLIGHT_STARTED: 'Spotlight started',
  OVERLAID: 'Overlaid',
  PUBLISHED: 'Finished',
};

// T11430 §4.3: orientation vocabulary, single-sourced (no magic strings at
// call sites). Derived from the project's canonical aspect ratio, never
// source-video dims — see design doc §4.3.
export const ORIENTATION = {
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape',
};

// T11430 §4.3: '9:16' -> portrait, '16:9' -> landscape, anything else -> null
// (no silent fallback/guess — CLAUDE.md "no silent fallbacks for internal data").
export function deriveOrientation(aspectRatio) {
  if (aspectRatio === '9:16') return ORIENTATION.PORTRAIT;
  if (aspectRatio === '16:9') return ORIENTATION.LANDSCAPE;
  return null;
}

// T11430 §4.6: strip the leading "Highlight " from NOT_STARTED so composed
// strings read "Portrait Video Not Started", not "Portrait Video Highlight
// Not Started". Every other HIGHLIGHT_STATUS value is already a bare word.
function bareStatusWord(status) {
  return status === HIGHLIGHT_STATUS.NOT_STARTED ? 'Not Started' : status;
}

const ORIENTATION_LABEL = {
  [ORIENTATION.PORTRAIT]: 'Portrait',
  [ORIENTATION.LANDSCAPE]: 'Landscape',
};

/**
 * getClipStage — the ordered stage table for a clip's own project.
 *
 * @param {object} region        the clip region (reads autoProjectId, startTime,
 *                               endTime, reelSourceStartTime, reelSourceEndTime)
 * @param {object|null} linkedProject the project row (reads has_working_video,
 *                               has_final_video, is_published)
 * @returns {{stage: string, status: string, label: string, action: 'focus'|'overlay'|'preview'|'published'|null}}
 *          `action` is a token each surface maps to its own navigation prop
 *          to Framing, Overlay, or the final-video viewer; null = no CTA.
 *
 * Order matters — first match wins.
 */
export function getClipStage(region, linkedProject, { framingInProgress = false } = {}) {
  const hasProject = !!region?.autoProjectId;
  if (!hasProject) {
    return {
      stage: CLIP_STAGE.NO_PROJECT,
      status: HIGHLIGHT_STATUS.NOT_STARTED,
      label: ANNOTATE.FRAME_THIS_CLIP,
      action: 'focus',
    };
  }

  // A render accepted for this project is already Framing even though the
  // working-video row does not exist until the background job completes.
  if (framingInProgress) {
    return {
      stage: CLIP_STAGE.FOCUS,
      status: HIGHLIGHT_STATUS.FRAMING,
      label: ANNOTATE.FRAME_THIS_CLIP,
      action: 'focus',
    };
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

  // T11430: a published highlight is frozen — publish freezes the badge, so
  // this check happens BEFORE the T8070 staleness gate (projectReflectsClip)
  // below. A published highlight never demotes back to FOCUS/CLIPPED from
  // boundary drift.
  if (linkedProject?.is_published) {
    return { stage: CLIP_STAGE.PUBLISHED, status: HIGHLIGHT_STATUS.PUBLISHED, label: 'View Highlight', action: 'published' };
  }

  if (projectReflectsClip && linkedProject?.has_final_video) {
    return { stage: CLIP_STAGE.FINAL, status: HIGHLIGHT_STATUS.OVERLAID, label: 'Preview Highlight', action: 'preview' };
  }
  if (projectReflectsClip && linkedProject?.has_working_video) {
    return { stage: CLIP_STAGE.SPOTLIGHT, status: linkedProject.has_overlay_edits ? HIGHLIGHT_STATUS.SPOTLIGHT_STARTED : HIGHLIGHT_STATUS.FRAMED, label: 'Add spotlight', action: 'overlay' };
  }
  if (projectReflectsClip) {
    return { stage: CLIP_STAGE.FOCUS, status: HIGHLIGHT_STATUS.CLIPPED, label: ANNOTATE.FRAME_THIS_CLIP, action: 'focus' };
  }
  if (projectIsFreshDraft) {
    // Subsumes the old "Open clip (Draft)" label.
    return { stage: CLIP_STAGE.FOCUS, status: HIGHLIGHT_STATUS.CLIPPED, label: ANNOTATE.FRAME_THIS_CLIP, action: 'focus' };
  }
  // Drifted (non-null snapshot, boundaries moved) OR below-migration (produced
  // video but null snapshot): the project EXISTS, so it should open — never fall
  // back to offering to re-create it (T9330 deliberate change).
  return { stage: CLIP_STAGE.FOCUS, status: HIGHLIGHT_STATUS.CLIPPED, label: ANNOTATE.FRAME_THIS_CLIP, action: 'focus' };
}

export function isFramingExportInProgress(activeExports, projectId) {
  if (!projectId) return false;
  return Object.values(activeExports || {}).some((entry) =>
    String(entry.projectId) === String(projectId) &&
    entry.type === 'framing' &&
    (entry.status === 'pending' || entry.status === 'processing')
  );
}

/**
 * getClipStages — T11430 §4.6/§4.8 collection wrapper over the existing
 * per-instance core (getClipStage). Composes an orientation-qualified status
 * string per instance, synthesizes a not-started counterpart instance for a
 * missing orientation when the opposite orientation has a published instance,
 * and derives the primary "create" CTA across all instances for one play.
 *
 * @param {object} region    the clip region (see getClipStage)
 * @param {Array} instances  highlight instances for this play:
 *   { projectId, aspectRatio: '9:16'|'16:9', highlightOrdinal: number|null,
 *     hasWorkingVideo, hasFinalVideo, isPublished, archivedAt,
 *     reelSourceStartTime?, reelSourceEndTime? }
 * @param {object} [opts]
 * @param {object} [opts.activeExports]
 * @returns {{instances: Array, primaryCta: {label: string, action: string}, hasAnyPublished: boolean}}
 */
export function getClipStages(region, instances, { activeExports } = {}) {
  const list = instances || [];

  // Count real instances per orientation for ordinal-suffix + synthesized
  // counterpart logic.
  const orientationCounts = { [ORIENTATION.PORTRAIT]: 0, [ORIENTATION.LANDSCAPE]: 0 };
  for (const instance of list) {
    const orientation = deriveOrientation(instance.aspectRatio);
    if (orientation) orientationCounts[orientation] += 1;
  }

  const resultInstances = list.map((instance) => {
    const orientation = deriveOrientation(instance.aspectRatio);

    // Per-instance region: each instance carries its OWN T8070 producing-window
    // snapshot (projects.reel_source_*, fixround1 MAJOR 1). Use it directly — NOT
    // the shared per-play region.reelSource* — so making a 2nd highlight never
    // un-stales a 1st the user drifted off its window. The play's CURRENT
    // boundaries (region.startTime/endTime) are still the thing compared against
    // this per-instance snapshot.
    const instanceRegion = {
      ...region,
      autoProjectId: instance.projectId,
      reelSourceStartTime: instance.reelSourceStartTime ?? null,
      reelSourceEndTime: instance.reelSourceEndTime ?? null,
    };

    const linkedProjectShape = {
      has_working_video: instance.hasWorkingVideo,
      has_final_video: instance.hasFinalVideo,
      is_published: instance.isPublished,
    };

    // Framing is driven ONLY by a real activeExports entry — never inferred
    // from hasWorkingVideo/hasFinalVideo/snapshot shape. A working video with
    // no final video and no snapshot but no active export is the existing
    // "below-migration" case (getClipStage's own fallthrough) and correctly
    // reads Clipped, not a fabricated Framing.
    const core = getClipStage(instanceRegion, linkedProjectShape, {
      framingInProgress: isFramingExportInProgress(activeExports, instance.projectId),
    });

    const ordinal = instance.highlightOrdinal;
    const ordinalSuffix = ordinal != null && ordinal >= 2 ? ` ${ordinal}` : '';
    const orientationLabel = orientation ? ORIENTATION_LABEL[orientation] : null;
    if (!orientationLabel) {
      // design §4.3: an unexpected aspect ratio must be surfaced loudly, never
      // silently defaulted to portrait/landscape. We still render the bare
      // (un-oriented) status rather than crash, but warn so the bad value is
      // visible instead of silently swallowed.
      console.warn(
        `[clipStage] highlight instance ${instance.projectId} has unmapped aspect_ratio ` +
        `"${instance.aspectRatio}" — status rendered without an orientation prefix`
      );
    }
    const status = orientationLabel
      ? `${orientationLabel} Video${ordinalSuffix} ${bareStatusWord(core.status)}`
      : core.status;

    return {
      ...core,
      status,
      projectId: instance.projectId,
      orientation,
      ordinal: ordinal ?? null,
      aspectRatio: instance.aspectRatio,
      archivedAt: instance.archivedAt,
    };
  });

  const hasAnyPublished = list.some((instance) => instance.isPublished);

  // T11430 §4.6: synthesize a not-started counterpart for the missing
  // orientation when it has zero instances and the opposite orientation has
  // a published instance.
  const counterparts = [
    [ORIENTATION.PORTRAIT, ORIENTATION.LANDSCAPE],
    [ORIENTATION.LANDSCAPE, ORIENTATION.PORTRAIT],
  ];
  for (const [present, missing] of counterparts) {
    const presentHasPublished = list.some(
      (instance) => deriveOrientation(instance.aspectRatio) === present && instance.isPublished
    );
    if (presentHasPublished && orientationCounts[missing] === 0) {
      resultInstances.push({
        stage: CLIP_STAGE.NO_PROJECT,
        status: `${ORIENTATION_LABEL[missing]} Video ${bareStatusWord(HIGHLIGHT_STATUS.NOT_STARTED)}`,
        label: ANNOTATE.FRAME_THIS_CLIP,
        action: 'focus-new',
        projectId: null,
        orientation: missing,
        ordinal: null,
        aspectRatio: null,
        archivedAt: null,
        synthesizedOrientation: missing,
      });
    }
  }

  const primaryCta = {
    label: list.length === 0 ? ANNOTATE.FRAME_THIS_CLIP : ANNOTATE.MAKE_ANOTHER_HIGHLIGHT,
    action: 'focus-new',
  };

  return {
    instances: resultInstances,
    primaryCta,
    hasAnyPublished,
  };
}
