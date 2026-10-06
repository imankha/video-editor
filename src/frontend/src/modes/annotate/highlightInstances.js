// T11910: the ONE place a backend `highlight_instances` payload becomes the
// camelCase `region.highlightInstances` shape clipStage.getClipStages reads.
// Used by BOTH the load path (useAnnotate.importAnnotations) and every response
// that changes a play's highlights (create / force_new / export-complete
// refresh), so "just created" and "reloaded" can never render differently.
//
// Tolerates already-camelCase input via the same `??` double-read pattern the
// rest of the importer uses.
export function mapHighlightInstances(raw) {
  return (raw ?? []).map((i) => ({
    projectId: i.projectId ?? i.project_id,
    aspectRatio: i.aspectRatio ?? i.aspect_ratio,
    highlightOrdinal: i.highlightOrdinal ?? i.highlight_ordinal,
    hasWorkingVideo: i.hasWorkingVideo ?? i.has_working_video,
    hasFinalVideo: i.hasFinalVideo ?? i.has_final_video,
    isPublished: i.isPublished ?? i.is_published,
    archivedAt: i.archivedAt ?? i.archived_at,
    // fixround1 MAJOR 1: per-project producing-window snapshot, so each
    // instance's staleness is judged against its OWN window.
    reelSourceStartTime: i.reelSourceStartTime ?? i.reel_source_start_time ?? null,
    reelSourceEndTime: i.reelSourceEndTime ?? i.reel_source_end_time ?? null,
  }));
}
