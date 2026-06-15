/** Format seconds as "M:SS" or "H:MM:SS"; null/NaN -> null (no silent 0).
 *  Use this for video CONTROLS (scrubber/timecode). For copy that talks to the
 *  user about a length, use formatDurationHuman. */
export function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Conversational duration for user-facing copy: "30s", "12s", "1m 30s",
 *  "3m 12s", "1h 2m". null/NaN -> null. Prefer this anywhere we're TALKING to
 *  the user about a length; keep formatDuration (M:SS) for video controls. */
export function formatDurationHuman(seconds) {
  if (seconds == null || isNaN(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}
