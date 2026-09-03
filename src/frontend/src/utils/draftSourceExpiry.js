import { getDaysUntil, EXPIRY_WARNING_DAYS } from '../components/ExpirationBadge';

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

/**
 * T8330 — the single predicate for "this game's source video is at risk AND the
 * loss is still preventable", shared by the account-level expiry banner. Built
 * from the SAME classification primitives deriveDraftSourceExpiry uses
 * (storage_status === 'expired', getDaysUntil, EXPIRY_WARNING_DAYS) so there is
 * one expiry classification in the frontend, not two.
 *
 * "Preventable" is the banner's whole point (its CTA is "Extend storage"):
 *   - active game inside the warning window (< EXPIRY_WARNING_DAYS days) — the
 *     ordinary expiring-soon case; extend now.
 *   - EXPIRED but still in the grace window — the task's "already expired,
 *     deletes in N days, still rescuable" case; `can_extend` is exactly what
 *     list_games sets true while the object survives, so it is the grace signal.
 * A permanently-deleted game (storage_status 'expired', can_extend false) is
 * already lost — nothing to extend — so it is deliberately NOT at risk here;
 * urging "Extend storage" for it would be a dead CTA.
 */
export function isGameStorageAtRisk(game) {
  if (!game) return false;
  if (game.storage_status === 'expired') return game.can_extend === true;
  const days = getDaysUntil(game.storage_expires_at);
  return days !== null && days < EXPIRY_WARNING_DAYS;
}

/**
 * T8330 — aggregate the per-game at-risk predicate across every Reel Draft to
 * drive the account-level banner. A game counts only when a draft actually
 * depends on it (project.game_ids references it) AND it is at risk: a bare
 * expiring game with nothing built from it is the business model, not data loss.
 *
 * Pure render-time join over data already loaded (the games list + drafts'
 * game_ids) — no fetch, no store write, no persisted state. O(total game
 * references across drafts), never O(drafts × games).
 *
 * Returns { atRiskGameCount, dependentDraftCount }:
 *   atRiskGameCount    — distinct at-risk games at least one draft depends on.
 *   dependentDraftCount — drafts depending on ≥1 such game.
 * Both zero when nothing is at risk (the banner then renders nothing).
 */
export function computeStorageExpiryRisk(projects, gamesById) {
  if (!projects?.length || !gamesById?.size) {
    return { atRiskGameCount: 0, dependentDraftCount: 0 };
  }

  const atRiskGameIds = new Set();
  let dependentDraftCount = 0;

  for (const project of projects) {
    const gameIds = project?.game_ids;
    if (!gameIds?.length) continue;

    let dependsOnAtRisk = false;
    for (const id of gameIds) {
      if (isGameStorageAtRisk(gamesById.get(id))) {
        atRiskGameIds.add(id);
        dependsOnAtRisk = true;
      }
    }
    if (dependsOnAtRisk) dependentDraftCount += 1;
  }

  return { atRiskGameCount: atRiskGameIds.size, dependentDraftCount };
}
