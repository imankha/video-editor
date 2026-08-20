/**
 * Match-date helpers — ONE local-calendar date parser for the whole app (T7330).
 *
 * `games.game_date` is a date-only TEXT column ("YYYY-MM-DD"). It must never be read with
 * `new Date("2026-03-01")`, which is UTC midnight and reads as Feb 28 in any negative-offset
 * timezone — a March 1st match would file under February (the T7290 landmine). This module
 * exists so that parse has exactly one implementation: ProjectManager groups with it,
 * GameTile and ReferenceGameCard label with it, and a second copy can never drift from it.
 */

/** Parse a "YYYY-MM-DD" string as a LOCAL calendar date. Returns null for anything else. */
export function parseLocalCalendarDate(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!parts) return null;
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/**
 * Parse a game's match date. NULL/empty is a real external-data case — games predating the
 * required field, plus materialized and shared rows — and returns null quietly. A non-empty
 * value that will not parse is NOT that case: both writers are `<input type="date">`, so it
 * means our own data is wrong, and it says so instead of hiding.
 */
export function parseMatchDate(gameDate) {
  if (gameDate === null || gameDate === undefined || gameDate === '') return null;
  const parsed = parseLocalCalendarDate(gameDate);
  if (!parsed) {
    console.warn(`[games] Unparseable game_date ${JSON.stringify(gameDate)} -- expected `
      + 'YYYY-MM-DD. Falling back to upload date for placement; the row is a data bug.');
  }
  return parsed;
}

/**
 * Tile label for a match date: "Sat, Mar 21".
 *
 * The weekday is what makes this worth showing next to a title that already ends in the
 * date — youth sport is weekend-shaped, so a Wednesday makeup game reads differently at a
 * glance — and it keeps the two copies visually distinct so the second doesn't read as an
 * echo. Returns '' when there is no match date: the upload date is NEVER substituted here,
 * because a March match uploaded in June would then contradict the March header it sits
 * under (the contradiction T7290 set out to remove).
 */
export function formatMatchDateLabel(gameDate) {
  const date = parseMatchDate(gameDate);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Range label for a tournament group: "Jul 3 – Jul 6" (en dash), or "Apr 18" when every
 * match shares a day. Built from REAL match dates only — a member with no game_date contributes nothing —
 * and returns null when no member has one, so the header simply omits the line rather than
 * inventing a range out of upload timestamps.
 */
export function formatMatchDateRange(dates) {
  const real = dates.filter(Boolean).sort((a, b) => a - b);
  if (real.length === 0) return null;
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const first = fmt(real[0]);
  const last = fmt(real[real.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}
