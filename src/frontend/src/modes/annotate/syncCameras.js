/**
 * T17700: pure helpers for Sync (the renamed Line up / T8900 Fix timing). Read-only
 * derivations over the container's `sourceVideos.videos` entries
 * ({ sequence, kind: 'main'|'angle', virtualStart, virtualEnd, coversPlayhead }).
 */

/**
 * The camera Sync would move from here: the active video when it is a camera
 * (angle), else a camera covering the playhead while the main camera plays. Null
 * for back-to-back videos: they play in upload order, so moving one changes nothing.
 */
export function syncTargetFor(videos, activeSequence) {
  const active = videos.find((v) => v.sequence === activeSequence);
  if (!active) return null;
  if (active.kind === 'angle') return active;
  return videos.find((v) => v.kind === 'angle' && v.coversPlayhead && v.sequence !== activeSequence) ?? null;
}

/**
 * The game (wall) time under the playhead `t`, read from the main video covering it:
 * that video's stored offset plus how far into it the playhead is. This is what
 * "Starts here" stores as a placed-at-end video's offset. Null when no main video
 * covers `t` or its offset is missing (logged: every placed video has one, T8870).
 */
export function wallTimeAt(t, videos, gameVideos) {
  const cover = videos.find((v) => v.kind === 'main' && t >= v.virtualStart && t < v.virtualEnd);
  if (!cover) return null;
  const gv = gameVideos.find((g) => g.sequence === cover.sequence);
  if (gv?.offset_seconds == null) {
    console.warn('[Sync] covering video has no offset_seconds', cover.sequence);
    return null;
  }
  return { sequence: cover.sequence, wall: gv.offset_seconds + (t - cover.virtualStart) };
}
