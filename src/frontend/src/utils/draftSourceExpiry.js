import { getDaysUntil } from '../components/ExpirationBadge';

/**
 * T8320 — pure render-time join. Given a draft `project` and a Map of
 * game_id -> game (each game carrying `storage_status` / `storage_expires_at`
 * from list_games), derive the draft's WORST source-video expiry state so Reel
 * Drafts can surface it the way the Games tab already does on GameTile.
 *
 * This is a computed join, NOT stored state (no store write, no useEffect, no
 * persisted field) — it duplicates nothing the games list already holds.
 *
 * Returns:
 *   - `null` when the draft references no source game we know about (no
 *     game_ids, or every referenced game row is absent — a deleted game =>
 *     NO chip, never a crash; data-always-ready).
 *   - `{ expired, daysLeft }` otherwise:
 *       expired  — true if ANY source game's storage_status is 'expired'
 *                  (reclaimed/expired source; the safe-direction backend default,
 *                  T8320).
 *       daysLeft — the MIN days-until-expiry across source games (drives the
 *                  <14d countdown chip); null when unknown. Only meaningful when
 *                  `expired` is false.
 *
 * References (T5800) carry no storage semantics: list_games sets their
 * storage_status/storage_expires_at to null, so they contribute neither an
 * expired flag nor a countdown here — a reference-only draft yields
 * { expired: false, daysLeft: null } and renders no chip.
 */
export function deriveDraftSourceExpiry(project, gamesById) {
  const gameIds = project?.game_ids;
  if (!gameIds?.length || !gamesById) return null;

  let expired = false;
  let minDaysLeft = null;
  let sawSource = false;

  for (const id of gameIds) {
    const game = gamesById.get(id);
    if (!game) continue; // deleted / absent game row — skip, never crash
    sawSource = true;
    if (game.storage_status === 'expired') {
      expired = true;
      continue;
    }
    const days = getDaysUntil(game.storage_expires_at);
    if (days !== null && (minDaysLeft === null || days < minDaysLeft)) {
      minDaysLeft = days;
    }
  }

  if (!sawSource) return null;
  return { expired, daysLeft: minDaysLeft };
}
