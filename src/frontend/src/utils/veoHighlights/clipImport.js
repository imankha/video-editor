/**
 * T13230 - Path B metadata: Veo label -> our clip name/tags/notes (EPIC.md decision V3).
 * Only "Goal" exists in our tag vocabulary; other labels stay in notes. No rating is
 * set here: the rating is the parent's judgment.
 */
import { parseVeoName } from './parser.js';
import { rank } from './merge.js';

const TAG_BY_LABEL = { Goal: 'Goal' };

export function formatStamp(totalS) {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = Math.floor(totalS % 60);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function metaFor(labels, stamp_s) {
  return {
    name: `${labels[0]} ${formatStamp(stamp_s)}`,
    tags: labels.filter((l) => TAG_BY_LABEL[l]).map((l) => TAG_BY_LABEL[l]),
    notes: `Veo: ${labels.join(', ')}`,
  };
}

export const clipMetaForMoment = (moment) => metaFor(moment.labels, moment.stamp_s);

/** @returns {{name,tags,notes}|null} null when the file name is not a Veo highlight name */
export function clipMetaForLooseFile(file) {
  const p = parseVeoName(file.name);
  return p ? metaFor([p.label], p.stamp_s) : null;
}

/** Label filter chips for the pick list, in label priority order. */
export function filterChips(moments) {
  const counts = new Map();
  for (const m of moments) for (const l of m.labels) counts.set(l, (counts.get(l) || 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => rank(a.label) - rank(b.label));
}
