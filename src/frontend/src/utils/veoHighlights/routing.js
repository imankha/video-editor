/**
 * T13240 - where a dropped Veo highlights zip can go. Pure: finds the user's games that are the
 * same match (Path A, suggested plays). Path B (clips) and "make a game" need no game.
 */
const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Veo team names carry a suffix the game's opponent often omits ("Legends FC San Diego" vs
// "Legends"), so one name matching the other's leading whole words counts as the same team.
const sameTeam = (a, b) => !!a && !!b && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `));

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
 * Games this zip's highlights can become suggested plays on: the game's opponent must match the
 * zip's (a long-enough game is no evidence it is the same match; offering one put another
 * match's highlights on the wrong game), AND its video must be long enough. Newest first.
 * A zip without "vs." in its name matches nothing.
 * @param {string} zipName
 * @param {number} minLengthS
 * @param {{id:number, opponent_name:string|null, game_date:string|null, video_duration:number|null}[]} games
 */
export function rankCandidateGames(zipName, minLengthS, games) {
  const opponent = zipOpponent(zipName);
  if (opponent == null) return [];
  // video_duration is what GET /api/games returns. A game without one (still processing)
  // cannot be shown to contain the moments, so it is not a candidate.
  return games
    .filter((g) => sameTeam(normalize(g.opponent_name), opponent))
    .filter((g) => g.video_duration != null && g.video_duration >= minLengthS)
    .sort((a, b) => (b.game_date || '').localeCompare(a.game_date || ''));
}
