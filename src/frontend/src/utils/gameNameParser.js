/**
 * Parses "TeamA vs TeamB" style export filenames (Veo and similar camera/
 * platform exports) into an opponent name, game date, and "our team" guess,
 * so the upload form can pre-fill itself instead of asking the parent to
 * retype what's already in the filename.
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

function normalizeDate(raw) {
  const isoLike = raw.replace(/_/g, '-');
  const [y, m, d] = isoLike.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? isoLike : null;
}

/**
 * @param {string} filename - the raw uploaded file's name, extension included.
 * @param {string} [existingTeamName] - the profile's already-known team name,
 *   if any. Used only to pick which side of "vs" is "ours" when it matches.
 * @returns {{ourTeamName: string, opponentName: string, gameDate: string}|null}
 */
export function parseGameFilename(filename, existingTeamName = '') {
  const match = basename(filename).match(GAME_FILENAME_PATTERN);
  if (!match) return null;

  const gameDate = normalizeDate(match[3]);
  if (!gameDate) return null;

  const teamA = slugToTeamName(match[1]);
  const teamB = slugToTeamName(match[2]);
  if (!teamA || !teamB) return null;

  // Veo's own convention names the account's team first, opponent second.
  // The only reason to flip that default is proof: the profile's stored team
  // name already matches the SECOND slug.
  const known = existingTeamName.trim().toLowerCase();
  const flip = known && known === teamB.toLowerCase();

  return flip
    ? { ourTeamName: teamB, opponentName: teamA, gameDate }
    : { ourTeamName: teamA, opponentName: teamB, gameDate };
}

export default { parseGameFilename };
