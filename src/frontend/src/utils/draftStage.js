// Canonical pipeline stage of a reel draft, derived from the same persistent
// fields ProjectManager's status counts and DraftTile's status chip already
// read (T6800). ONE derivation shared by tile sizing, stage-row grouping,
// group status counts, and tests — never re-derive these buckets inline.

import { RATIO, RATIO_ORDER } from '../constants/aspectRatios';

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
  [DRAFT_STAGE.IN_FRAMING]: 'In Focus',
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
 * Whether a draft's tile renders at SOURCE aspect (landscape) rather than its
 * TARGET output ratio. A tile stays source-aspect until real framing has been
 * applied:
 *   NOT_STARTED  nothing touched yet (T6800)
 *   IN_FRAMING   clips entered the Framing screen but NO crop keyframes exist
 *                yet (has_crop_keyframes false) — "entered framing" is not the
 *                same as "framed" (T6900)
 * Once crop keyframes exist (or the draft has a working/final video), the tile
 * takes the target ratio. This is the ONE predicate DraftTile's sizeClass and
 * stageRowsFor's row grouping both read — the two halves of the row-height
 * invariant, which must always agree on a tile's shape.
 */
export function rendersSourceAspect(project) {
  const stage = getDraftStage(project);
  if (stage === DRAFT_STAGE.NOT_STARTED) return true;
  if (stage === DRAFT_STAGE.IN_FRAMING && !project.has_crop_keyframes) return true;
  return false;
}

// The aspect a draft's tile ACTUALLY renders at: landscape while source-aspect
// (T6800/T6900), else the target ratio. Row grouping must bucket by this, not
// the raw target field, or an unframed portrait draft (rendered landscape)
// would land in a portrait row and break the uniform row height.
function renderedRatio(project) {
  return rendersSourceAspect(project)
    ? RATIO.LANDSCAPE
    : (project.aspect_ratio || RATIO.PORTRAIT);
}

/**
 * Buckets a draft list by the aspect its tiles RENDER at (portrait first),
 * dropping empty buckets — the stage-row analogue of splitByAspect, but keyed
 * on rendered shape so every bucket is one uniform tile height.
 */
export function splitByRenderedAspect(list) {
  return RATIO_ORDER
    .map(ratio => ({ ratio, projects: list.filter(p => renderedRatio(p) === ratio) }))
    .filter(bucket => bucket.projects.length > 0);
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
 * Aspect sub-rows for ONE stage's projects (T6810, extracted for T8080 so the
 * By-Phase view's phase-then-game grouping can reuse the exact same
 * row-height invariant instead of re-deriving it). Not-Started drafts all
 * render landscape (DraftTile sizes them at source aspect regardless of
 * target ratio, T6800), so that stage gets ONE row with no aspect chip
 * (ratio null) instead of a split that would separate identically-shaped
 * tiles by an invisible target ratio. Every other stage buckets by RENDERED
 * aspect (splitByRenderedAspect), so an In-Framing draft that hasn't been
 * cropped yet — which DraftTile renders landscape (T6900) — groups with the
 * landscape tiles instead of its target-ratio row. This null-ratio branch,
 * splitByRenderedAspect, and DraftTile's landscape override are the halves of
 * the same row-height invariant — change together via rendersSourceAspect.
 */
export function aspectRowsForStage(stage, projects) {
  return stage === DRAFT_STAGE.NOT_STARTED
    ? [{ ratio: null, projects }]
    : splitByRenderedAspect(projects);
}

/**
 * Stage rows for a draft list — one entry per pipeline stage present, each
 * carrying its aspect sub-rows via aspectRowsForStage (T6810).
 */
export function stageRowsFor(draftList) {
  return splitByStage(draftList).map(({ stage, projects }) => ({
    stage,
    byAspect: aspectRowsForStage(stage, projects),
  }));
}

/**
 * By-Phase view (T8080) — flips stageRowsFor's primary axis: one entry per
 * pipeline stage present (pipeline order). WITHIN a stage, buckets by
 * RENDERED aspect first (via aspectRowsForStage, same row-height invariant
 * every other grouping in this file honors), then by game within each aspect
 * bucket — never the other way around, or a landscape game's cluster could
 * sit on the same wrapped line as a portrait game's cluster and mix tile
 * heights (found live-testing the first version of this view, which grouped
 * game-first and let aspect vary freely within one game's row).
 *
 * `orderedGameGroups` must already be in the SAME order the By-Game view uses
 * (ProjectManager's `groupedProjects.sortedKeys`, "Other reels" appended last)
 * so the two views can never disagree on game ordering — only which axis is
 * outermost.
 *
 * @param {Array<{key: string, label: string, projects: Array}>} orderedGameGroups
 */
export function phaseRowsFor(orderedGameGroups) {
  return DRAFT_STAGE_ORDER.map(stage => {
    // This stage's projects per game, preserving the caller's game order.
    const perGameStageProjects = orderedGameGroups
      .map(({ key, label, projects }) => ({
        key, label, projects: projects.filter(project => getDraftStage(project) === stage),
      }))
      .filter(game => game.projects.length > 0);

    if (perGameStageProjects.length === 0) return { stage, count: 0, byAspect: [] };

    // Aspect-major (row-height invariant): bucket ALL of this stage's projects
    // by rendered aspect first via the shared helper, then re-split each
    // aspect bucket by game (id lookup, since aspectRowsForStage only knows
    // projects, not which game each came from).
    const allStageProjects = perGameStageProjects.flatMap(game => game.projects);
    const byAspect = aspectRowsForStage(stage, allStageProjects).map(({ ratio, projects: aspectProjects }) => {
      const aspectIds = new Set(aspectProjects.map(p => p.id));
      const byGame = perGameStageProjects
        .map(({ key, label, projects }) => {
          const gameAspectProjects = projects.filter(p => aspectIds.has(p.id));
          return gameAspectProjects.length > 0 ? { key, label, projects: gameAspectProjects } : null;
        })
        .filter(Boolean);
      return { ratio, byGame };
    });

    return { stage, count: allStageProjects.length, byAspect };
  }).filter(({ count }) => count > 0);
}
