/**
 * T13240 - where a dropped Veo highlights zip can go. Pure: ranks the user's games as
 * Path A (suggested plays) candidates. Path B (clips) needs no game.
 */
const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Normalized opponent from `Veo highlights {Team} vs. {Opponent}[ (1st Half)].zip`, else null. */
export function zipOpponent(zipName) {
  const base = zipName.replace(/\.zip$/i, '').replace(/\s*\((?:1st|2nd) half\)\s*$/i, '');
  const m = /\bvs\.?\s+(.+)$/i.exec(base);
  return m ? normalize(m[1]) : null;
}

/** Seconds a video must last to contain every moment: last stamp + that moment's length. */
export function minGameLengthS(moments) {
  return Math.max(...moments.map((m) => m.stamp_s + m.duration_s));
}

/**
 * Games long enough for the zip's moments, opponent match first, then newest date.
 * @param {string} zipName
 * @param {number} minLengthS
 * @param {{id:number, opponent_name:string|null, game_date:string|null, effective_duration:number|null}[]} games
 */
export function rankCandidateGames(zipName, minLengthS, games) {
  const opponent = zipOpponent(zipName);
  const matches = (g) => opponent != null && normalize(g.opponent_name) === opponent;
  return games
    .filter((g) => (g.effective_duration ?? 0) >= minLengthS)
    .sort((a, b) =>
      Number(matches(b)) - Number(matches(a)) || (b.game_date || '').localeCompare(a.game_date || ''));
}
