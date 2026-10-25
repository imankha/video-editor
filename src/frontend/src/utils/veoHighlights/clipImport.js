/**
 * T13230 - Path B metadata: Veo label -> our clip name/tags/notes (EPIC.md decision V3).
 * Only "Goal" exists in our tag vocabulary; other labels stay in notes. The rating is the
 * parent's judgment, so it is sent as an explicit null (unrated); omitting it would get the
 * batch upload's default of 5.
 */
import { parseVeoName } from './parser.js';
import { rank } from './merge.js';
import { parseGameFilename } from '../gameNameParser.js';

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
    rating: null,
  };
}

/**
 * T13245: game title from `Veo highlights {Team} vs. {Opponent} (1st Half).zip`: the zip name
 * minus the "Veo highlights " prefix and ".zip", original casing, whitespace collapsed. The game
 * gets no opponent field: GET /api/games rebuilds the title as "Vs {opponent}" whenever one is
 * set, which would replace this title (and the title already names the opponent).
 */
export function veoGameTitle(zipName) {
  return zipName.replace(/\.zip$/i, '').replace(/^Veo highlights\s+/i, '').replace(/\s+/g, ' ').trim();
}

export const clipMetaForMoment = (moment) => metaFor(moment.labels, moment.stamp_s);

/** @returns {{name,tags,notes,rating}|null} null when the file name is not a Veo highlight name */
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

// M_D_YY / D_M_YY written with - or _ ("Scrimmage Game 10_25_25"). Only a reading that the numbers
// force counts: 10_4_25 is Oct 4 or Apr 10 and stays empty (T13246 Q3).
const SHORT_DATE = /(?<!\d)(\d{1,2})[-_](\d{1,2})[-_](\d{4}|\d{2})(?!\d)/;

function unambiguousShortDate(title) {
  const m = SHORT_DATE.exec(title);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  let month;
  let day;
  if (a === b || (b > 12 && a <= 12)) [month, day] = [a, b];
  else if (a > 12 && b <= 12) [month, day] = [b, a];
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * T13246: what a Veo zip's NAME honestly says about the game, for the details step of "make a game".
 * Reuses the filename parser on the zip title; the date is empty unless the name itself holds an
 * unambiguous one (zip entry times are the download day, mp4 times are render time: neither is the
 * match date).
 * @returns {{opponentName: string|null, ourTeamName: string|null, gameDate: string|null}|null}
 */
export function veoGameDetails(zipName, profileTeam = '', now = new Date()) {
  const title = veoGameTitle(zipName);
  const parsed = parseGameFilename(`${title}.zip`, profileTeam, now, { ourTeamFromMatchup: true });
  const gameDate = parsed?.gameDate ?? unambiguousShortDate(title);
  if (!parsed && !gameDate) return null;
  return { opponentName: parsed?.opponentName ?? null, ourTeamName: parsed?.ourTeamName ?? null, gameDate };
}
