/**
 * T8350: multi-clip reel staleness -- pure read-time derivation, no persistence.
 *
 * A clip is STALE when its live boundaries no longer match the window its
 * reel's most recent produced artifact was rendered from. Reuses T8070 Sec 4's
 * rule byte-identically: strict equality, values compared without arithmetic,
 * no epsilon, with a not-null guard (a NULL reel_source_* snapshot means the
 * reel was never produced from this clip, or the profile DB predates v049 --
 * either way, not stale).
 */
export function isClipStale(clip) {
  const s = clip.reel_source_start_time;
  const e = clip.reel_source_end_time;
  if (s == null || e == null) return false;
  return clip.start_time !== s || clip.end_time !== e;
}

/** Count of stale clips across a reel's clips (0 = no cue). */
export function staleClipCount(clips = []) {
  return clips.reduce((n, c) => n + (isClipStale(c) ? 1 : 0), 0);
}
