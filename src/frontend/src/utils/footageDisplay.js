/**
 * T8820 — Presentational formatters for the confirm strip + reorder list.
 *
 * Parent-language, spelled-out units ("23 min", "1 hr 8 min") so the intake copy
 * reads like a person talking, not a media player. Kept separate from
 * collections/format.js (which is "1h 8m" for compact chrome) — different audience,
 * different voice, so it is a distinct formatter rather than a shared one.
 */

// A silent stretch longer than this between two continuous segments reads as two
// separate games rather than a halftime break (EPIC edge-case table). 3 hours.
export const HUGE_GAP_S = 10800;

/** "23 min" / "1 hr 8 min" — rounded to whole minutes for a length we're TELLING
 *  a parent about. Returns '' for a missing/NaN duration (chips omit the line). */
export function humanizeMinutes(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
  return `${m} min`;
}

/** Recorded wall-clock time as "2:03 PM"; null when there is no usable Date. */
export function formatClockTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The trust-building EVIDENCE a chip/row shows under its number + duration: the
 * recorded clock time when we ordered by embedded time (mono, so it reads as data),
 * otherwise the filename (timestamps were discarded or never trusted).
 *
 * @returns {{text: string, mono: boolean}}
 */
export function footageEvidence(item, confidence) {
  if (confidence === 'time') {
    const clock = formatClockTime(item.creationTime);
    if (clock) return { text: clock, mono: true };
  }
  return { text: item.name, mono: false };
}

/**
 * A gap connector's label + whether it is the huge "two games?" case.
 * @returns {{huge: boolean, label: string}}
 */
export function gapDisplay(seconds) {
  if (seconds > HUGE_GAP_S) {
    const hr = Math.round(seconds / 3600);
    return { huge: true, label: `${hr} hr gap - two games?` };
  }
  const min = Math.round(seconds / 60);
  return { huge: false, label: `${min} min break` };
}
