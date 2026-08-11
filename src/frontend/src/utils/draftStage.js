// Canonical pipeline stage of a reel draft, derived from the same persistent
// fields ProjectManager's status counts and DraftTile's status chip already
// read (T6800). ONE derivation shared by tile sizing, stage-row grouping,
// group status counts, and tests — never re-derive these buckets inline.

import { splitByAspect } from '../constants/aspectRatios';

export const DRAFT_STAGE = {
  NOT_STARTED: 'not_started',
  IN_FRAMING: 'in_framing',
  IN_OVERLAY: 'in_overlay',
  READY: 'ready',
};

// Pipeline order — stage rows render in this order (T6810).
export const DRAFT_STAGE_ORDER = [
  DRAFT_STAGE.NOT_STARTED,
  DRAFT_STAGE.IN_FRAMING,
  DRAFT_STAGE.IN_OVERLAY,
  DRAFT_STAGE.READY,
];

export const DRAFT_STAGE_LABELS = {
  [DRAFT_STAGE.NOT_STARTED]: 'Not Started',
  [DRAFT_STAGE.IN_FRAMING]: 'In Framing',
  [DRAFT_STAGE.IN_OVERLAY]: 'In Overlay',
  [DRAFT_STAGE.READY]: 'Ready',
};

// Text tint per stage — matches the CollapsibleGroup legend colors so the row
// labels and the group-header counts read as the same system.
export const DRAFT_STAGE_TINTS = {
  [DRAFT_STAGE.NOT_STARTED]: 'text-gray-400',
  [DRAFT_STAGE.IN_FRAMING]: 'text-blue-400',
  [DRAFT_STAGE.IN_OVERLAY]: 'text-blue-300',
  [DRAFT_STAGE.READY]: 'text-green-400',
};

/**
 * Stage buckets (mirrors ProjectManager.getProjectStatusCounts exactly):
 *   READY       has_final_video (includes ready-to-publish AND published)
 *   IN_OVERLAY  a working video exists but no final yet
 *   IN_FRAMING  any clip framed/exported, or overlay edits without a render
 *   NOT_STARTED nothing above
 */
export function getDraftStage(project) {
  if (project.has_final_video) return DRAFT_STAGE.READY;
  if (project.has_working_video) return DRAFT_STAGE.IN_OVERLAY;
  if (
    project.clips_in_progress > 0 ||
    project.clips_exported > 0 ||
    project.has_overlay_edits
  ) {
    return DRAFT_STAGE.IN_FRAMING;
  }
  return DRAFT_STAGE.NOT_STARTED;
}

/**
 * Splits a draft list into one bucket per stage present, pipeline order,
 * dropping empty buckets — the stage analogue of splitByAspect, and shaped the
 * same way so callers can treat "one row" and "N rows" identically (T6810).
 */
export function splitByStage(list) {
  return DRAFT_STAGE_ORDER.map(stage => ({
    stage,
    projects: list.filter(project => getDraftStage(project) === stage),
  })).filter(bucket => bucket.projects.length > 0);
}

/**
 * Stage rows for a draft list — one entry per pipeline stage present, each
 * carrying its aspect sub-rows (T6810). Not-Started drafts all render
 * landscape (DraftTile sizes them at source aspect regardless of target
 * ratio, T6800), so that stage gets ONE row with no aspect chip (ratio null)
 * instead of a split that would separate identically-shaped tiles by an
 * invisible target ratio. This null-ratio branch and DraftTile's landscape
 * override are two halves of the same row-height invariant — change together.
 */
export function stageRowsFor(draftList) {
  return splitByStage(draftList).map(({ stage, projects }) => ({
    stage,
    byAspect: stage === DRAFT_STAGE.NOT_STARTED
      ? [{ ratio: null, projects }]
      : splitByAspect(projects),
  }));
}
