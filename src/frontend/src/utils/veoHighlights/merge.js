/**
 * T13200 - Merge parsed entries into moments (memory-only, never persisted).
 *   1. exact duplicates (same CRC-32 + size) collapse, labels unioned
 *   2. sort by stamp (ties keep zip index order)
 *   3. fold clips overlapping the running moment by MORE than half the shorter one
 * Label priority decides display order and which entry Path B would upload.
 */
const PRIORITY = ['Goal', 'Shot on goal', 'Attack', 'Defence', 'Highlight'];
export const rank = (label) => {
  const i = PRIORITY.indexOf(label);
  return i === -1 ? PRIORITY.length : i;
};

/**
 * @param {object[]} entries parsed entries each carrying `durationS`
 * @returns {{moments: object[], afterDedupe: number}}
 */
export function mergeMoments(entries) {
  for (const e of entries) {
    if (!(e.durationS > 0)) throw new Error(`Missing duration for ${e.name}`);
  }
  // 1. exact dedupe
  const byKey = new Map();
  for (const e of entries) {
    const key = `${e.crc32}:${e.size}`;
    const hit = byKey.get(key);
    if (hit) {
      if (!hit.labels.includes(e.label)) hit.labels.push(e.label);
    } else {
      byKey.set(key, { ...e, labels: [e.label] });
    }
  }
  const unique = [...byKey.values()].sort((a, b) => a.stamp_s - b.stamp_s || a.index - b.index);

  // 2-3. fold overlaps
  const groups = [];
  for (const e of unique) {
    const g = groups[groups.length - 1];
    const eEnd = e.stamp_s + e.durationS;
    if (g) {
      const overlap = Math.min(g.end, eEnd) - Math.max(g.start, e.stamp_s);
      const shorter = Math.min(g.end - g.start, e.durationS);
      if (overlap > shorter / 2) {
        g.entries.push(e);
        g.end = Math.max(g.end, eEnd);
        continue;
      }
    }
    groups.push({ start: e.stamp_s, end: eEnd, entries: [e] });
  }

  const moments = groups.map((g) => {
    const labels = [];
    for (const e of g.entries) for (const l of e.labels) if (!labels.includes(l)) labels.push(l);
    labels.sort((a, b) => rank(a) - rank(b)); // stable: ties keep first-seen order
    const topRank = (e) => Math.min(...e.labels.map(rank));
    const best = g.entries.reduce((b, e) => (topRank(e) < topRank(b) ? e : b));
    return {
      stamp_s: g.start,
      duration_s: g.end - g.start,
      labels,
      entries: g.entries.map((e) => ({ ...e, upload: e === best })),
    };
  });
  return { moments, afterDedupe: unique.length };
}
