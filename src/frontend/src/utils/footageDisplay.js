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

/**
 * T8822 — Light-touch overlap detection for the confirm list: which items' recorded
 * time ranges intersect another item's. Purely informational at upload time (the real
 * lane/angle system is T8880/T8890, built against the server's canonical
 * `offset_seconds` in Annotate) — only meaningful when we trust the embedded clock
 * (`confidence === 'time'`); name/unknown/manual orders have no reliable time evidence
 * to compare, so this returns an empty map for them.
 *
 * @returns {Map<string, string[]>} item name -> names of items it overlaps with
 */
export function overlapGroups(order, confidence) {
  const groups = new Map();
  if (confidence !== 'time') return groups;

  const timed = order.filter(
    (it) => it.creationTime instanceof Date && !Number.isNaN(it.creationTime.getTime()) && it.duration > 0
  );

  for (let i = 0; i < timed.length; i++) {
    const a = timed[i];
    const aStart = a.creationTime.getTime();
    const aEnd = aStart + a.duration * 1000;
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j];
      const bStart = b.creationTime.getTime();
      const bEnd = bStart + b.duration * 1000;
      if (aStart < bEnd && bStart < aEnd) {
        if (!groups.has(a.name)) groups.set(a.name, []);
        if (!groups.has(b.name)) groups.set(b.name, []);
        groups.get(a.name).push(b.name);
        groups.get(b.name).push(a.name);
      }
    }
  }
  return groups;
}

// Matches the angle-name convention T8880 will use in Annotate.
const SHORT_LABEL_MAX = 14;

/** Short label for an overlap badge: filename stem, middle-ellipsis-truncated to
 *  `SHORT_LABEL_MAX` chars. */
export function shortLabel(name) {
  const stem = name.replace(/\.[^./]+$/, '');
  if (stem.length <= SHORT_LABEL_MAX) return stem;
  const headLen = Math.ceil((SHORT_LABEL_MAX - 1) / 2);
  const tailLen = Math.floor((SHORT_LABEL_MAX - 1) / 2);
  return `${stem.slice(0, headLen)}…${stem.slice(stem.length - tailLen)}`;
}
