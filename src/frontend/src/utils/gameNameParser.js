/**
 * Reads what a game video's filename says about the game, so the upload form can
 * pre-fill itself instead of asking the parent to retype it.
 *
 * Formats (prod scan 2026-10-14, 200 filenames):
 * - Veo "team-a-vs-team-b-YYYY-MM-DD": both teams + date (team A is ours).
 * - Matchups typed with spaces ("Tigers vs. Hawks September 26", "Ravens v Ballers"):
 *   opponent only. "Our team" is never guessed from these, because it is saved to the profile.
 * - "<opponent> half 1" / "<opponent> 1st half": opponent.
 * - Any date in the name: Veo month names ("nov-16-2024"), ISO / underscored / compact
 *   (PXL_, dji_, VID-, screen recorders), iOS MM-DD-YYYY, DD-MM-YYYY when the day is
 *   over 12, "Oct 2" (most recent past date when the year is missing).
 *
 * Example: "match-west-coast-fc-ecnl-vs-sporting-ca-ecnl-2026-09-13.mp4"
 *   -> { ourTeamName: 'West Coast FC ECNL', opponentName: 'Sporting CA ECNL', gameDate: '2026-09-13' }
 */

// Small set of common youth-soccer club abbreviations that should render
// upper-case rather than title-cased ("fc" -> "FC", not "Fc").
const KNOWN_ACRONYMS = new Set([
  'fc', 'sc', 'ca', 'ecnl', 'ecrl', 'usl', 'npl', 'edp', 'ayso', 'ussf',
]);

const GAME_FILENAME_PATTERN =
  /^(?:match[-_ ]+)?(.+?)[-_ ]+vs[-_ ]+(.+?)[-_ ]+(\d{4}[-_]\d{2}[-_]\d{2})(?:[-_ ].*)?$/i;
const SPACED_MATCHUP = /^(.+?)\s+(?:vs\.?|v\.?)\s+(.+)$/i;
// Veo zip titles end in "(1st Half)" / "(2nd Half)"; it names the half, not the opponent.
const PAREN_HALF = /\s*\((?:1st|2nd)\s*half\)\s*$/i;
const HALF = /^(.+?)[\s_-]+(?:half[\s_-]*[12]|[12](?:st|nd)[\s_-]*half)$/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// Month-name dates win: in Veo's "nov-16-2024-41308-pm-2024-11-17" the title date is the game, the trailing one is later.
const NAMED_DATE = new RegExp(`(?<![a-z])${MONTH_RE}[\\s_.-]+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])(?:,?[\\s_-]+(\\d{4})(?!\\d))?`, 'gi');
const NUMERIC_DATES = [
  { re: /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/g, ymd: (m) => [m[1], m[2], m[3]] },
  { re: /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g, ymd: (m) => [m[1], m[2], m[3]] },
  // iOS screen recordings are MM-DD-YYYY; a first number over 12 can only be a day.
  { re: /(?<!\d)(\d{2})-(\d{2})-(\d{4})(?!\d)/g, ymd: (m) => (Number(m[1]) > 12 ? [m[3], m[2], m[1]] : [m[3], m[1], m[2]]) },
];

function basename(filename) {
  const name = filename || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function slugToTeamName(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) =>
      KNOWN_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(' ');
}

function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = y >= 2000 && y <= 2100
    && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}

/** Every valid date in `text` as { iso, raw }: month-name dates first, then numeric ones left to right. */
function findDates(text, now) {
  const named = [...text.matchAll(NAMED_DATE)].map((m) => {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const day = Number(m[2]);
    let year = m[3] ? Number(m[3]) : now.getUTCFullYear();
    // No year: a game is in the past, so take the most recent such date.
    if (!m[3] && Date.UTC(year, month - 1, day) > now.getTime()) year -= 1;
    return { iso: isoDate(year, month, day), raw: m[0] };
  });
  const numeric = NUMERIC_DATES
    .flatMap(({ re, ymd }) => [...text.matchAll(re)].map((m) => {
      const [y, mo, d] = ymd(m).map(Number);
      return { iso: isoDate(y, mo, d), raw: m[0], index: m.index };
    }))
    .sort((a, b) => a.index - b.index);
  return [...named, ...numeric].filter((d) => d.iso);
}

/** One side of a typed matchup, minus its dates and copy suffixes like "(2)"; null when no name is left. */
function cleanSide(side, dates) {
  let out = side;
  for (const d of dates) out = out.split(d.raw).join(' ');
  out = out.replace(/\(\d+\)/g, ' ').replace(/_+/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();
  return /[a-z]/i.test(out) && out.split(' ').length <= 8 ? out : null;
}

/**
 * @param {string} filename - the raw uploaded file's name, extension included.
 * @param {string} [existingTeamName] - the profile's already-known team name,
 *   if any. Used only to pick which side of "vs" is "ours" when it matches.
 * @param {Date} [now] - "today", for a date written without a year.
 * @param {{ourTeamFromMatchup?: boolean}} [options] - T13246: a Veo zip title is
 *   "{Our team} vs. {Opponent}" by Veo's own convention, so its typed matchup also
 *   yields ourTeamName (a typed FILENAME never does: it is saved to the profile).
 * @returns {{ourTeamName: string|null, opponentName: string|null, gameDate: string|null}|null}
 *   null when the name says nothing; otherwise the fields it does not say are null.
 */
export function parseGameFilename(filename, existingTeamName = '', now = new Date(), options = {}) {
  const base = basename(filename).replace(PAREN_HALF, '').trim();
  const known = typeof existingTeamName === 'string'
    ? existingTeamName.trim().toLowerCase()
    : '';

  const veo = base.match(GAME_FILENAME_PATTERN);
  if (veo) {
    const gameDate = isoDate(...veo[3].split(/[-_]/).map(Number));
    const teamA = slugToTeamName(veo[1]);
    const teamB = slugToTeamName(veo[2]);
    if (!gameDate || !teamA || !teamB) return null;
    // Veo's own convention names the account's team first, opponent second.
    // The only reason to flip that default is proof: the profile's stored team
    // name already matches the SECOND slug.
    const flip = known && known === teamB.toLowerCase();
    return flip
      ? { ourTeamName: teamB, opponentName: teamA, gameDate }
      : { ourTeamName: teamA, opponentName: teamB, gameDate };
  }

  const dates = findDates(base, now);
  const gameDate = dates[0]?.iso ?? null;
  let opponentName = null;
  let ourTeamName = null;
  const typed = base.match(SPACED_MATCHUP);
  const half = base.match(HALF);
  if (typed) {
    const left = cleanSide(typed[1], dates);
    const right = cleanSide(typed[2], dates);
    const flipped = !!known && !!right && known === right.toLowerCase();
    opponentName = flipped ? left : right;
    if (options.ourTeamFromMatchup) ourTeamName = flipped ? right : left;
  } else if (half) {
    opponentName = cleanSide(half[1], dates);
  }

  if (!opponentName && !gameDate) return null;
  return { ourTeamName, opponentName, gameDate };
}

export default { parseGameFilename };
