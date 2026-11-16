"""Admin operations endpoints: R2 usage (T13931), upload failures (T10270), share cleanup
(T2847), Postgres migrations, and the recap/poster backfills (T4140).

Split out of routers/admin.py by T5940; every URL is unchanged."""

import asyncio
import logging
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, Query

from ...services.pg import get_pg
from ...version import APP_BUILD, APP_VERSION
from . import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# R2 usage attribution (T13931)
# ---------------------------------------------------------------------------

@router.get("/r2-usage")
def r2_usage():
    """Per-source daily R2 Class A/B merged across every writer's analytics shard,
    plus the billing cycle vs the free tier. Admin only, on-demand; sync def -> threadpool
    (blocking R2 LIST/GET). Logic lives in services/r2_usage_report.py."""
    from ...services.r2_usage_report import build_r2_usage_report
    return build_r2_usage_report()


# ---------------------------------------------------------------------------
# Upload-failure observability (T10270)
# ---------------------------------------------------------------------------

@router.get("/upload-failures")
# T10270: sync def -> anyio threadpool (matches the other analytics handlers'
# concurrency model, backend-services.md).
def list_upload_failures(
    since_build: int = Query(None),
    since: str = Query(None, description="YYYY-MM-DD, overrides since_build's derived window"),
    until: str = Query(None, description="YYYY-MM-DD, overrides since_build's derived window"),
    kind: str = Query(None),
    stage: str = Query(None),
    reason: str = Query(None),
    user_id: str = Query(None),
    origin: str = Query(None),
    include_impersonated: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """GET /api/admin/upload-failures (design doc §3.6): a single query answers
    "which uploads failed since build X, for whom, at what stage, why" (AC1).

    Default window: the earliest date any row was recorded AT the current
    APP_BUILD (an honest "no failures recorded on this build" when there are
    none yet, falling back to today). `since`/`until` are an explicit UTC date
    override, independent of build. `rows`/`total` are date-window + filter
    scoped; `rates` are ALWAYS the honest game/clip pair (never summed, never
    without both attempts and successes -- feedback_tries_vs_success_must_both_show),
    excluding impersonated rows regardless of `include_impersonated` (that
    flag only controls whether admin reproductions show up in the LIST).
    """

    with get_pg() as conn:
        cur = conn.cursor()

        # T6090 pattern: tolerate a deployed-but-not-yet-migrated environment
        # instead of a bare 500 on UndefinedTable.
        cur.execute("SELECT to_regclass('public.upload_failures') IS NOT NULL AS ok")
        if not cur.fetchone()["ok"]:
            return {"migrated": False}

        today = datetime.now(UTC).date()
        build = since_build if since_build is not None else APP_BUILD

        if since or until:
            since_date = date.fromisoformat(since) if since else today
            until_date = date.fromisoformat(until) if until else today
        else:
            cur.execute(
                "SELECT MIN(occurred_at)::date AS d FROM upload_failures WHERE app_build = %s",
                (build,),
            )
            row = cur.fetchone()
            since_date = row["d"] if row and row["d"] else today
            until_date = today

        cur.execute(
            "SELECT COUNT(*) AS cnt FROM upload_failures WHERE app_build = %s",
            (build,),
        )
        rows_at_this_build = cur.fetchone()["cnt"]

        filters = ["occurred_at::date BETWEEN %s AND %s"]
        params = [since_date, until_date]
        if kind:
            filters.append("kind = %s")
            params.append(kind)
        if stage:
            filters.append("stage = %s")
            params.append(stage)
        if reason:
            filters.append("reason = %s")
            params.append(reason)
        if user_id:
            filters.append("user_id = %s")
            params.append(user_id)
        if origin:
            filters.append("origin = %s")
            params.append(origin)
        if not include_impersonated:
            filters.append("impersonated = FALSE")
        where_clause = "WHERE " + " AND ".join(filters)

        cur.execute(f"SELECT COUNT(*) AS cnt FROM upload_failures {where_clause}", params)
        total = cur.fetchone()["cnt"]

        cur.execute(
            f"SELECT * FROM upload_failures {where_clause} "
            "ORDER BY occurred_at DESC LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
        rows = cur.fetchall()

        # Honesty rules (design §3.6): game/clip are SEPARATE, every rate ships
        # attempts+succeeded+failed together, rate_pct is null (not 0%/100%)
        # when attempts==0. Mixed-grain disclosure: successes come from
        # daily_counters (day-keyed), failures from upload_failures (exact
        # timestamps, terminal=true) -- both bounded to the SAME [since_date,
        # until_date] window, but a day-vs-exact-timestamp ceiling remains
        # (the same one T7467 documented for the pulse cards).
        cur.execute(
            "SELECT COALESCE(SUM(game_uploads_succeeded), 0) AS succeeded, "
            "COALESCE(SUM(clips_uploaded), 0) AS clip_succeeded "
            "FROM daily_counters WHERE origin_type = 'all' AND counter_date BETWEEN %s AND %s",
            (since_date, until_date),
        )
        succ = cur.fetchone()
        game_succeeded, clip_succeeded = succ["succeeded"], succ["clip_succeeded"]

        cur.execute(
            "SELECT "
            "COUNT(*) FILTER (WHERE kind = 'game') AS game_failed, "
            "COUNT(*) FILTER (WHERE kind = 'clip') AS clip_failed "
            "FROM upload_failures WHERE terminal = TRUE AND impersonated = FALSE "
            "AND occurred_at::date BETWEEN %s AND %s",
            (since_date, until_date),
        )
        fail = cur.fetchone()
        game_failed, clip_failed = fail["game_failed"], fail["clip_failed"]

        # T2580: of the uploads finalized in the same window, how many have
        # their index (moov) at the end -- cannot start playing until fully
        # downloaded. null (not 0) when the table isn't migrated yet.
        cur.execute("SELECT to_regclass('public.upload_index_checks') IS NOT NULL AS ok")
        index_checks = None
        if cur.fetchone()["ok"]:
            cur.execute(
                "SELECT COUNT(*) AS checked, "
                "COUNT(*) FILTER (WHERE NOT index_at_front) AS not_at_front "
                "FROM upload_index_checks WHERE checked_at::date BETWEEN %s AND %s",
                (since_date, until_date),
            )
            row = cur.fetchone()
            index_checks = {"checked": row["checked"], "not_at_front": row["not_at_front"]}

    def _rate(succeeded, failed):
        attempts = succeeded + failed
        return {
            "attempts": attempts,
            "succeeded": succeeded,
            "failed": failed,
            "rate_pct": round(succeeded / attempts * 100, 2) if attempts else None,
        }

    game_rate = _rate(game_succeeded, game_failed)
    clip_rate = _rate(clip_succeeded, clip_failed)
    # T11010: clip_upload_attempted now fires (prepare_upload, kind='clip'), but
    # this panel's denominator stays outcome-based (succeeded+failed) so its
    # per-build windows remain comparable across the change -- disclosed rather
    # than silently presented as a true attempt count.
    clip_rate["denominator_note"] = "outcome-based (succeeded+failed), not the clip_upload_attempted count"

    return {
        "window": {
            "since_build": build,
            "commit_sha": APP_VERSION,
            "since_date": since_date.isoformat(),
            "until_date": until_date.isoformat(),
            "rows_at_this_build": rows_at_this_build,
        },
        "rows": rows,
        "total": total,
        "rates": {"game": game_rate, "clip": clip_rate},
        "index_checks": index_checks,
    }


# ---------------------------------------------------------------------------
# Share cleanup (T2847)
# ---------------------------------------------------------------------------

@router.post("/cleanup-shares")
async def cleanup_shares():
    """Run share table retention cleanup. Admin only."""

    from ...services.sharing_db import (
        cleanup_old_shares,
        cleanup_resolved_pending_shares,
        expire_stale_pending_shares,
    )

    resolved = cleanup_resolved_pending_shares()
    expired = expire_stale_pending_shares()
    old = cleanup_old_shares()

    return {
        "resolved_pending_deleted": resolved,
        "stale_pending_expired": expired,
        "old_shares_deleted": old,
    }


# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------

@router.post("/migrate-postgres")
async def run_postgres_migration():
    """Run pending Postgres-track migrations. Admin only.

    T5087: this used to also sweep every user's SQLite DBs as a bulk backstop
    (POST /api/admin/migrate); that sweep is deleted -- user_db/profile_db
    migrate JIT at the per-user seam (T5083/T5085, hardened by T8190) and have
    no bulk-sweep counterpart anymore. Postgres remains the one track that is
    deploy/admin-triggered by design (never JIT, since it is a shared DB with
    no per-user seam to hang the migration off of)."""
    return await asyncio.to_thread(_run_migrate_postgres)


def _run_migrate_postgres() -> dict:
    from ...migrations import migrate_postgres
    return migrate_postgres()


@router.get("/migration-status")
async def migration_status(user_id: str | None = Query(default=None)):
    """READ-ONLY migration status (T5970). No user_id -> code head versions only
    (zero cost). With user_id -> also the ACTUAL R2 schema version of each of that
    user's registered profiles, so an operator can ask "is this env at head?" without
    running the mutating full-R2-walk migrate. Side-effect-free (temp download + read
    + delete; no R2 write)."""
    from ...migrations import get_migration_status, get_migration_status_for_user

    if user_id is None:
        return get_migration_status()
    return await asyncio.to_thread(get_migration_status_for_user, user_id)


# ---------------------------------------------------------------------------
# Recap backfill (T4140)
# ---------------------------------------------------------------------------

# Single-flight state for the recap backfill. The real run is dispatched to a
# background thread and the request returns immediately: the db_sync middleware
# holds the caller's per-user WRITE lock for the whole request, so a synchronous
# multi-minute re-encode starves every other write from that user (observed:
# 13 minutes of queued Copy Link clicks in dev). The backfill itself only
# reads the profile DB and writes R2 objects, so it does not need the lock.
_BACKFILL_STATE: dict = {"running": False, "last_result": None, "task": None}


@router.post("/backfill-hiq-recaps")
async def backfill_hiq_recaps(limit: int = Query(25, ge=1, le=500),
                              dry_run: bool = Query(False)):
    """Upgrade legacy 480p recaps to full-quality hi-q re-edit masters (T4140).

    Heavy per-game re-encode, so it is throttled/batched by `limit` and NOT run
    on startup. Only games whose game video still exists (in-grace) are upgraded;
    already-reclaimed games keep their 480p recap. Pass `dry_run=true` for a
    fast synchronous candidate count. The real run returns 202-style
    `{"started": true}` immediately and executes in the background — GET this
    same path to poll `running`/`last_result` (a repeat POST while idle would
    start ANOTHER run).
    """
    from ...services.auto_export import backfill_hiq_recaps as _backfill

    if dry_run:
        return await asyncio.to_thread(_backfill, limit, True)

    if _BACKFILL_STATE["running"]:
        return {"started": False, "already_running": True,
                "last_result": _BACKFILL_STATE["last_result"]}

    _BACKFILL_STATE["running"] = True

    async def _run_in_background():
        try:
            _BACKFILL_STATE["last_result"] = await asyncio.to_thread(_backfill, limit, False)
        except Exception as exc:
            logger.exception("[Backfill] background run failed")
            _BACKFILL_STATE["last_result"] = {"error": str(exc)}
        finally:
            _BACKFILL_STATE["running"] = False

    _BACKFILL_STATE["task"] = asyncio.create_task(_run_in_background())
    return {"started": True, "limit": limit,
            "note": "running in background; GET this path to poll "
                    "running/last_result"}


@router.get("/backfill-hiq-recaps")
async def backfill_hiq_recaps_status():
    """Read-only status of the recap backfill (see POST above)."""
    return {"running": _BACKFILL_STATE["running"],
            "last_result": _BACKFILL_STATE["last_result"]}


_POSTER_BACKFILL_STATE: dict = {"running": False, "last_result": None, "task": None}


@router.post("/backfill-share-posters")
async def backfill_share_posters(limit: int = Query(25, ge=1, le=500),
                                 dry_run: bool = Query(False),
                                 force: bool = Query(False)):
    """Generate posters for PUBLISHED reels that have none (T4890).

    Reels published before the poster feature carry no og:image, so their share
    links unfurl text-only until backfilled. Per-video ffmpeg frame grab, so it is
    throttled/batched by `limit` and NOT run on startup. Only reels whose video
    object still exists are processed; reels whose poster already exists are healed
    (no re-encode). Pass `dry_run=true` for a synchronous candidate count. The real
    run returns immediately and executes in the background -- GET this same path to
    poll `running`/`last_result`.

    The frame is chosen by `select_poster_frame` -- the open-play window's own
    start (already past the slow-mo skip margin), or 2 seconds into it when
    there's no slow-mo section (T6630 round 8; was always +2s, which stacked
    with the skip), or the user's pre-export marker (T5410). It is NOT the
    first frame; that was the pre-T5410 behaviour.

    `force=true` REGENERATES posters for ALL published reels, not just ones missing
    a poster -- this is how legacy posters are upgraded to the current selection.
    **Without it the candidate set is usually 0**, because existing reels already
    have a poster (just an older one). Rows with `poster_source IN ('overlay',
    'upload')` are ALWAYS skipped (`skipped_override`), even under force -- a user's
    manual cover choice is never clobbered by a sweep. See `backfill_posters` for
    the full per-row contract.
    """
    from ...services.poster import backfill_posters as _backfill

    if dry_run:
        return await asyncio.to_thread(_backfill, limit, True, force)

    if _POSTER_BACKFILL_STATE["running"]:
        return {"started": False, "already_running": True,
                "last_result": _POSTER_BACKFILL_STATE["last_result"]}

    _POSTER_BACKFILL_STATE["running"] = True

    async def _run_in_background():
        try:
            _POSTER_BACKFILL_STATE["last_result"] = await asyncio.to_thread(_backfill, limit, False, force)
        except Exception as exc:
            logger.exception("[PosterBackfill] background run failed")
            _POSTER_BACKFILL_STATE["last_result"] = {"error": str(exc)}
        finally:
            _POSTER_BACKFILL_STATE["running"] = False

    _POSTER_BACKFILL_STATE["task"] = asyncio.create_task(_run_in_background())
    return {"started": True, "limit": limit,
            "note": "running in background; GET this path to poll running/last_result"}


@router.get("/backfill-share-posters")
async def backfill_share_posters_status():
    """Read-only status of the share-poster backfill (see POST above)."""
    return {"running": _POSTER_BACKFILL_STATE["running"],
            "last_result": _POSTER_BACKFILL_STATE["last_result"]}


# T11170 (G2): the T9760 quest-upfront backfill endpoint was deleted here. It
# never ran on prod, and the per-login JIT grant (session_init ->
# storage_credits.grant_welcome_credits) already pays every user their remainder
# on their next session, so no bulk sweep is needed.
