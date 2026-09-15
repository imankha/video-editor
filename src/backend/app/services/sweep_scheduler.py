"""
Cleanup sweep scheduler: asyncio background loop that auto-exports games
and deletes expired R2 objects.

Uses a "cron till next event" pattern — after each sweep, queries
get_next_expiry() and sleeps until then (capped at 24h).
"""

import asyncio
import logging
import time
from datetime import UTC, datetime
from enum import Enum

from ..database import ensure_database, get_db_connection, sync_db_to_r2_explicit
from ..migrations import MigrationBlocked
from ..profile_context import set_current_profile_id
from ..storage import r2_delete_object_global
from ..user_context import set_current_user_id
from .auth_db import (
    count_refs_in_profile,
    delete_grace_deletion,
    delete_ref,
    expire_game_storage,
    get_expired_grace_deletions,
    get_expired_refs_for_profile,
    get_next_expiry,
    has_remaining_refs,
    insert_grace_deletion,
)
from .auto_export import (
    MAX_AUTO_EXPORT_ATTEMPTS,
    ArtifactVerdict,
    auto_export_game,
    recap_artifacts_present,
)

logger = logging.getLogger(__name__)

_sweep_task: asyncio.Task | None = None

MAX_DELAY = 86400  # 24 hours
MIN_DELAY = 60  # 1 minute
STARTUP_DELAY = 60  # Wait for app to stabilize
GRACE_PERIOD_DAYS = 14


class ReclaimVerdict(str, Enum):
    """Outcome of `_reclaim_verdict` -- whether it is safe to delete a profile's
    game_storage ref for an expired hash (T10121). Every non-RECLAIM outcome
    keeps the ref and retries next sweep; only KEEP_ARTIFACTS_MISSING can also
    transition a game to the terminal 'abandoned' state (see
    `_abandon_if_exhausted`)."""
    RECLAIM = "reclaim"
    KEEP_RETRYABLE = "keep_retryable"
    KEEP_UNSYNCED = "keep_unsynced"
    KEEP_SIBLING_LIVE = "keep_sibling_live"
    KEEP_ARTIFACTS_MISSING = "keep_artifacts_missing"


def _app_env() -> str:
    """Read APP_ENV live (so a monkeypatch of app.storage.APP_ENV is honored)."""
    from ..storage import APP_ENV
    return APP_ENV


def _game_deletion_allowed() -> bool:
    """Whether THIS environment may delete a game video from R2.

    Game videos live in a SHARED, env-prefix-free R2 namespace (games/{hash}.mp4)
    used by dev, staging, AND prod. A non-production sweep can only see its OWN
    environment's refs, so it would delete a video prod still references (prod's
    refs are invisible here) — stranding a prod user with a "ready" game and a 404
    video. Only production may reclaim the shared game namespace.
    """
    return _app_env() == "production"


async def start_sweep_loop():
    """Start the sweep loop as a background task. Called from app startup."""
    global _sweep_task
    _sweep_task = asyncio.create_task(_run_sweep_loop())
    logger.info("[Sweep] Background sweep loop started")


async def stop_sweep_loop():
    """Cancel the sweep loop. Called from app shutdown."""
    global _sweep_task
    if _sweep_task:
        _sweep_task.cancel()
        try:
            await _sweep_task
        except asyncio.CancelledError:
            pass
        _sweep_task = None
        logger.info("[Sweep] Background sweep loop stopped")


async def _ping_health():
    """Ping localhost health endpoint to prevent Fly.io auto-suspend."""
    import urllib.request
    while True:
        try:
            urllib.request.urlopen("http://localhost:8000/api/health", timeout=5)
            logger.debug("[Sweep] Keepalive ping OK")
        except Exception as e:
            logger.debug(f"[Sweep] Keepalive ping failed: {e}")
        await asyncio.sleep(30)


async def _run_sweep_loop():
    """Self-scheduling sweep: runs, finds next expiry, sleeps until then."""
    await asyncio.sleep(STARTUP_DELAY)

    while True:
        try:
            keepalive = asyncio.create_task(_ping_health())
            try:
                await asyncio.to_thread(do_sweep)
            finally:
                keepalive.cancel()

            next_expiry = get_next_expiry()
            if next_expiry is None:
                delay = MAX_DELAY
            else:
                delay = (next_expiry - datetime.now(UTC)).total_seconds()
                delay = max(delay, MIN_DELAY)
                delay = min(delay, MAX_DELAY)

            logger.info(f"[Sweep] Next run in {delay / 3600:.1f}h")
            await asyncio.sleep(delay)

        except asyncio.CancelledError:
            logger.info("[Sweep] Shutdown")
            break
        except Exception:
            logger.exception("[Sweep] Error, retrying in 1h")
            await asyncio.sleep(3600)


def do_sweep():
    """Phase 1: iterate users, export expired games. Phase 2: grace-delete R2 objects."""
    t0 = time.perf_counter()
    total_expired = 0

    # Phase 1: iterate all users' profiles for expired storage refs
    from ..migrations import _get_profile_ids
    from .auth_db import get_all_users_for_admin

    users = get_all_users_for_admin()
    for user in users:
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            try:
                ensure_database()
            except MigrationBlocked as e:
                # T5085: pre-T5083 this could not happen -- ensure_database()
                # is now the JIT seam, and a SINGLE blocked profile must not
                # abort the sweep for every remaining user (the un-wrapped
                # call would propagate to _run_sweep_loop's except Exception
                # and retry the WHOLE sweep in 1h). Skip this profile only;
                # it re-enters the seam (and Phase 1) on the next sweep.
                logger.error(
                    f"[Sweep] user={user_id[:8]} profile={profile_id[:8]} blocked at "
                    f"migration seam ({e.reason}) -- skipping this profile, sweep continues"
                )
                continue

            expired_refs = get_expired_refs_for_profile()
            if not expired_refs:
                continue

            expired_hashes = {r["blake3_hash"] for r in expired_refs}
            total_expired += len(expired_refs)
            logger.info(f"[Sweep] user={user_id[:8]} profile={profile_id[:8]} has {len(expired_refs)} expired refs")

            for ref in expired_refs:
                blake3_hash = ref["blake3_hash"]
                game_ids = _find_games_for_hash(
                    user_id, profile_id, blake3_hash, expired_hashes
                )

                export_statuses = []
                for game_id in game_ids:
                    try:
                        status = auto_export_game(user_id, profile_id, game_id)
                        export_statuses.append(status)
                        logger.info(f"[Sweep] game={game_id} user={user_id[:8]} status={status}")
                    except Exception as e:
                        logger.error(f"[Sweep] Auto-export failed: user={user_id} game={game_id}: {e}")

                verdict = _reclaim_verdict(
                    user_id, profile_id, blake3_hash, expired_hashes, export_statuses
                )

                if verdict == ReclaimVerdict.KEEP_RETRYABLE:
                    # Keep the ref (and the source video) if any game on this
                    # hash still has a retryable auto-export — a failed export
                    # under the attempt cap. Reclaiming now would delete the
                    # source before we could ever produce its recap (bug 23p).
                    # The next sweep retries.
                    logger.warning(
                        f"[Sweep] hash={blake3_hash[:12]} auto-export not settled "
                        f"(failed, under retry cap) — keeping ref to retry next sweep"
                    )
                    continue
                if verdict != ReclaimVerdict.RECLAIM:
                    logger.warning(
                        f"[Sweep] hash={blake3_hash[:12]} verdict={verdict.value} "
                        f"— keeping ref to retry next sweep"
                    )
                    continue

                delete_ref(user_id, profile_id, blake3_hash)

                if not has_remaining_refs(blake3_hash):
                    insert_grace_deletion(blake3_hash, GRACE_PERIOD_DAYS)
                    logger.info(f"[Sweep] Grace period started hash={blake3_hash[:12]} ({GRACE_PERIOD_DAYS}d)")

    if not total_expired:
        logger.info("[Sweep] No expired refs")

    # Phase 2: delete R2 objects whose grace period has elapsed
    grace_expired = get_expired_grace_deletions()
    # HARD ENV GATE: only production may delete the shared, cross-env game
    # namespace. A non-prod sweep sees only its own refs and would orphan a video
    # prod still uses (see _game_deletion_allowed). Non-prod still ran Phase 1
    # bookkeeping above but must NEVER delete; leave the grace rows queued so
    # production's sweep is the single authority that reclaims the bytes.
    if grace_expired and not _game_deletion_allowed():
        logger.warning(
            f"[Sweep] Non-production env (APP_ENV={_app_env()}) — skipping R2 "
            f"deletion of {len(grace_expired)} grace-expired game object(s). Game "
            f"videos are a shared cross-env resource; only production deletes them."
        )
        grace_expired = []
    if grace_expired:
        logger.info(f"[Sweep] Phase 2: deleting {len(grace_expired)} grace-expired R2 objects")
    for blake3_hash in grace_expired:
        # AUTHORITATIVE GATE (SQLite source of truth, not the PG ref-set):
        # before permanently deleting the R2 source, verify no profile still
        # holds a LIVE (non-expired) game_storage ref for this hash.  The grace
        # deletion was queued off has_remaining_refs (game_storage_refs empty),
        # which can lag a profile's local SQLite state (T6770: no longer a
        # driftable counter, but still a separate store that can be behind).
        # Deleting while a live ref exists strands a user with a "ready" game
        # and a 404 video (the bug that lost imankh games 2/3/5).
        total_refs, live_refs, authoritative = _count_refs_all_profiles(blake3_hash, users)
        if live_refs > 0:
            if authoritative:
                # Every profile was read from authoritative data and a live ref
                # exists: the video is genuinely wanted.  Cancel the grace
                # deletion.  T6770: there is no counter to heal anymore --
                # game_storage_refs is a derived ref-set (COUNT(*) can't drift),
                # so the anomaly here is a grace row queued while a live ref
                # already existed, not a stale counter value.
                logger.error(
                    f"[Sweep] ABORT delete hash={blake3_hash[:12]} — {live_refs} live "
                    f"ref(s) still exist across profiles ({total_refs} total); "
                    f"canceling grace deletion"
                )
                delete_grace_deletion(blake3_hash)
            else:
                # At least one profile could not be authoritatively read this
                # sweep (transient R2 sync failure / missing DB).  total_refs is
                # NOT the truth, so leave the grace row queued so we re-evaluate
                # next sweep once the profile syncs.  Never delete on incomplete
                # information.
                logger.error(
                    f"[Sweep] DEFER delete hash={blake3_hash[:12]} — could not "
                    f"authoritatively confirm refs (indeterminate profile); keeping "
                    f"grace row to retry next sweep"
                )
            continue

        # T10121 D5: the same artifact gate Phase 1 checks before delete_ref
        # is checked again here before the PERMANENT R2 delete -- this catches
        # rows already queued in r2_grace_deletions by mechanisms B/C/D/E
        # before this fix shipped (their ref was already deleted, so Phase 1
        # this sweep never re-examines them). Reuses the existing DEFER shape:
        # log, leave the grace row queued, continue.
        if _phase2_artifact_gate_missing(blake3_hash, users):
            logger.error(
                f"[Sweep] DEFER delete hash={blake3_hash[:12]} — recap artifacts "
                f"missing for a game on this hash; keeping grace row to retry next sweep"
            )
            continue

        r2_delete_object_global(f"games/{blake3_hash}.mp4")
        delete_grace_deletion(blake3_hash)
        logger.info(f"[Sweep] Deleted R2 object hash={blake3_hash[:12]} (grace expired)")
        # Belt-and-suspenders: expire any lingering game_storage rows for this
        # hash across all initialized profiles.  Normally Phase 1 deletes all
        # refs before Phase 2 runs; this catches edge cases such as refs with a
        # future expiry that Phase 1 didn't touch (bug 27p class).
        n_expired = _expire_game_storage_all_profiles(blake3_hash, users)
        if n_expired:
            logger.info(
                f"[Sweep] Expired {n_expired} lingering game_storage ref(s) "
                f"after deletion of hash={blake3_hash[:12]}"
            )

    elapsed = time.perf_counter() - t0
    logger.info(f"[Sweep] Complete in {elapsed:.2f}s (refs={total_expired}, grace_deleted={len(grace_expired)})")


def _count_refs_all_profiles(blake3_hash: str, users: list) -> tuple[int, int, bool]:
    """Sum (total_refs, live_refs, authoritative) for a hash across all profiles.

    live_refs > 0 means at least one profile still holds a non-expired
    game_storage ref — the video is still wanted and must NOT be deleted.
    authoritative is False when at least one profile could not be trusted this
    sweep (transient R2 sync failure / missing local DB / read error); in that
    case total_refs is not the truth and the caller must not heal the counter to
    it. Reads local profile DBs (downloaded by Phase 1 this same sweep), so this
    is cheap and only runs for the rare grace-expired hashes in Phase 2.
    """
    from ..database import USER_DATA_BASE, has_recent_sync_error
    from ..migrations import _get_profile_ids

    total = live = 0
    authoritative = True
    for user in users:
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
            # INDETERMINATE => LIVE.  We may only trust a 0-count from a profile
            # whose local DB is authoritative this sweep.  A profile whose R2
            # restore failed transiently (cooldown active) fell through to an
            # EMPTY local DB in Phase 1 (ensure_database creates a fresh, valid
            # game_storage table on error) — reading it would return 0 refs and
            # let the irreversible R2 delete proceed while a live ref still sits
            # in the un-downloaded DB.  Likewise a profile with no local DB at
            # all was never read.  Count either as a live ref AND mark the whole
            # count non-authoritative: never delete on incomplete information.
            # (A genuinely new/empty profile syncs cleanly — NOT_FOUND, no
            # cooldown — and is counted normally below.)
            if not db_path.exists() or has_recent_sync_error(user_id, profile_id):
                logger.error(
                    f"[Sweep] hash={blake3_hash[:12]} user={user_id[:8]} "
                    f"profile={profile_id[:8]} not authoritatively synced "
                    f"(db_exists={db_path.exists()}) — assuming live ref, will not delete"
                )
                live += 1
                authoritative = False
                continue
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            try:
                t, live_n = count_refs_in_profile(blake3_hash)
                total += t
                live += live_n
            except Exception:
                # A profile we cannot read is indeterminate — treat as a live
                # ref so we never delete a video on incomplete information.
                logger.exception(
                    f"[Sweep] count_refs_in_profile failed for "
                    f"user={user_id[:8]} profile={profile_id[:8]} — assuming live ref"
                )
                live += 1
                authoritative = False
    return total, live, authoritative


def _expire_game_storage_all_profiles(blake3_hash: str, users: list) -> int:
    """Expire any remaining game_storage rows for this hash across local profiles.

    Called after Phase 2 R2 deletion.  Normal flow: Phase 1 deletes all refs via
    delete_ref() before Phase 2 runs, so this is usually a no-op.  It catches the
    edge case where a profile has a future-expiry ref (bug 27p class) that Phase 1
    didn't pick up because the ref wasn't expired yet.

    Only touches profiles whose DB file already exists locally to avoid downloading
    from R2 purely for this belt-and-suspenders step.
    """
    from ..database import USER_DATA_BASE
    from ..migrations import _get_profile_ids

    total = 0
    for user in users:
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
            if not db_path.exists():
                continue
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            try:
                n = expire_game_storage(blake3_hash)
                total += n
                if n:
                    sync_db_to_r2_explicit(user_id, profile_id)
            except Exception:
                logger.exception(
                    f"[Sweep] expire_game_storage failed for "
                    f"user={user_id[:8]} profile={profile_id[:8]}"
                )
    return total


def _find_games_for_hash(
    user_id: str, profile_id: str, blake3_hash: str, all_expired_hashes: set[str]
) -> set[int]:
    """Find all games (single and multi-video) using this hash that need export.

    "Need export" means never exported (auto_export_status IS NULL) OR a prior
    export failed and is still under the retry cap. Games that succeeded,
    skipped, or exhausted their retries are excluded.

    For multi-video games, only includes games where ALL video hashes are in
    the expired set. Can't use a SQL join since game_storage_refs is in
    auth.sqlite while game_videos is in profile.sqlite.
    """
    # A game needs (re)export when it was never run, or it failed/is stuck
    # pending and still has retries left. {p} is the games-table alias prefix
    # ("" or "g."). T10121: the 'pending' arm closes mechanism B -- a machine
    # death mid-export (Fly suspend/deploy/OOM) previously left a game at
    # 'pending' forever, matching neither IS NULL nor 'failed', so it was
    # never re-selected even though auto_export_game already tolerates
    # re-entering a pending game (T2460).
    def needs_export(p):
        return (f"({p}auto_export_status IS NULL OR "
                f"({p}auto_export_status = 'failed' "
                f"AND COALESCE({p}auto_export_attempts, 0) < ?) OR "
                f"({p}auto_export_status = 'pending' "
                f"AND COALESCE({p}auto_export_attempts, 0) < ?))")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Single-video games
        single = cursor.execute(
            f"""SELECT id FROM games
               WHERE blake3_hash = ? AND {needs_export('')}""",
            (blake3_hash, MAX_AUTO_EXPORT_ATTEMPTS, MAX_AUTO_EXPORT_ATTEMPTS),
        ).fetchall()

        # Multi-video games using this hash
        multi_candidates = cursor.execute(
            f"""SELECT DISTINCT g.id FROM games g
               JOIN game_videos gv ON gv.game_id = g.id
               WHERE gv.blake3_hash = ? AND {needs_export('g.')}""",
            (blake3_hash, MAX_AUTO_EXPORT_ATTEMPTS, MAX_AUTO_EXPORT_ATTEMPTS),
        ).fetchall()

        # Filter: only include multi-video games where ALL hashes are expired
        multi = []
        for row in multi_candidates:
            all_hashes = cursor.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ?",
                (row['id'],),
            ).fetchall()
            if all(h['blake3_hash'] in all_expired_hashes for h in all_hashes):
                multi.append(row)

    return {g['id'] for g in list(single) + list(multi)}


def _games_using_hash(blake3_hash: str) -> set[int]:
    """ALL games (regardless of auto_export_status) using this hash in the
    CURRENT profile -- single-video via games.blake3_hash, multi-video via
    game_videos. Unlike `_find_games_for_hash`'s needs-export selector (which
    deliberately excludes 'complete'/'skipped'/'abandoned' games), the D4
    sibling check and the D1 artifact gate must see EVERY game on a hash,
    settled or not, before a source video is permanently deleted.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        single = cursor.execute(
            "SELECT id FROM games WHERE blake3_hash = ?", (blake3_hash,)
        ).fetchall()
        multi = cursor.execute(
            "SELECT DISTINCT game_id AS id FROM game_videos WHERE blake3_hash = ?",
            (blake3_hash,),
        ).fetchall()
    return {row['id'] for row in list(single) + list(multi)}


def _has_live_sibling_hash(blake3_hash: str) -> bool:
    """True if a game using `blake3_hash` also uses a SIBLING video hash that
    still carries a LIVE (future-expiry) game_storage ref in this profile
    (T10121 D4) -- refuses to reclaim one half of a multi-video game while its
    other half is still active (mechanism D).

    Keyed off a LIVE ref specifically via `count_refs_in_profile`, NOT off
    "the sibling is absent from this sweep's expired-hashes set" -- that
    phrasing would strand an ALREADY-reclaimed sibling (its own ref long
    deleted) forever, since a deleted ref is permanently "not expired this
    sweep" without ever becoming live again.
    """
    game_ids = _games_using_hash(blake3_hash)
    if not game_ids:
        return False

    placeholders = ",".join("?" * len(game_ids))
    with get_db_connection() as conn:
        cursor = conn.cursor()
        siblings = cursor.execute(
            f"""SELECT DISTINCT blake3_hash FROM game_videos
               WHERE game_id IN ({placeholders}) AND blake3_hash != ?""",
            (*game_ids, blake3_hash),
        ).fetchall()

    for row in siblings:
        _, live = count_refs_in_profile(row['blake3_hash'])
        if live > 0:
            return True
    return False


def _reclaim_verdict(
    user_id: str, profile_id: str, blake3_hash: str,
    expired_hashes: set[str], export_statuses: list[str],
) -> ReclaimVerdict:
    """Decide whether it's safe to delete this profile's ref to `blake3_hash`
    (T10121 D1-D6), checked cheapest-first: two SQLite-only bail-outs before
    ever touching R2.

    A recap-gate verdict of ArtifactVerdict.UNVERIFIABLE (no R2 client
    configured -- local dev/tests) does NOT block reclaim here: D2 says the
    sweep proceeds exactly as it did before this task, just with a WARNING,
    matching the games.py:943 precedent for the same "can't check, R2 isn't
    configured" condition on the ref-creation side.
    """
    if _find_games_for_hash(user_id, profile_id, blake3_hash, expired_hashes):
        return ReclaimVerdict.KEEP_RETRYABLE

    if 'unsynced' in export_statuses:
        return ReclaimVerdict.KEEP_UNSYNCED

    if _has_live_sibling_hash(blake3_hash):
        return ReclaimVerdict.KEEP_SIBLING_LIVE

    game_ids = _games_using_hash(blake3_hash)
    verdicts = [recap_artifacts_present(user_id, gid) for gid in game_ids]
    if any(v == ArtifactVerdict.MISSING for v in verdicts):
        return ReclaimVerdict.KEEP_ARTIFACTS_MISSING
    if any(v == ArtifactVerdict.UNVERIFIABLE for v in verdicts):
        logger.warning(
            f"[Sweep] hash={blake3_hash[:12]} recap artifacts UNVERIFIABLE "
            f"(no R2 client configured) — proceeding with reclaim per D2"
        )
    return ReclaimVerdict.RECLAIM


def _phase2_artifact_gate_missing(blake3_hash: str, users: list) -> bool:
    """True if ANY profile-owned game using this hash has a MISSING recap
    artifact (T10121 D5) -- the Phase-2 twin of the Phase-1 artifact gate,
    checked right before the PERMANENT R2 delete. Needed because a game whose
    ref was already deleted by mechanisms B/C/D/E before this fix shipped has
    no expired ref left for Phase 1 to re-examine this sweep -- Phase 2's
    grace-expired hash is the only remaining chance to catch it.

    Only walks profiles whose DB is already local (mirrors
    `_expire_game_storage_all_profiles`) -- Phase 1 already downloaded
    anything live this sweep, so a profile with no local file has no game
    left to check.
    """
    from ..database import USER_DATA_BASE
    from ..migrations import _get_profile_ids

    for user in users:
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
            if not db_path.exists():
                continue
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            for game_id in _games_using_hash(blake3_hash):
                if recap_artifacts_present(user_id, game_id) == ArtifactVerdict.MISSING:
                    return True
    return False
