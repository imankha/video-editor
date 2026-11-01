"""T14030: Journey rollup -- exit screen, dwell, retry bursts and transitions per stage.

Admin-triggered (POST /api/admin/analytics/journey/rollup), in-process: walks every
non-test user's user.sqlite through the JIT seam (ensure_user_database, then
migrate_local_user_db_at_seam, the backfill_posters shape), folds each user's
`user_action_log` in memory and writes only per-stage counts into this writer's
analytics.sqlite shard (schema step 2). No per-user or per-event row leaves the user DB.

Stage attribution: every signal belongs to the user's furthest JOURNEY_LADDER stage at
the moment of the row, computed from the same log, so the inspector's stage selection
reads "while people were at this stage".

A DB that cannot be brought to head is skipped and counted (below_head_skipped), never
read raw; any other error is counted in users_failed. Full rebuild per run; readers
take the newest run across shards (analytics_store.newest_journey_rollup).
"""

import json
import logging
import sqlite3
import threading
import uuid
from bisect import bisect_right
from datetime import UTC, datetime
from typing import Any

from ..analytics import BREADCRUMB_SCREENS, JOURNEY_LADDER, RETRY_BURST_ACTIONS, detect_retry_bursts
from ..r2_usage import R2Source, r2_source_scope
from .analytics_journey import percent_or_fraction
from .analytics_store import AnalyticsStore, StoreState, newest_journey_rollup

logger = logging.getLogger(__name__)

# Upper bounds in seconds of a stage's total dwell on one screen; above the last is gt_30m.
DWELL_BUCKETS = (("lt_10s", 10), ("s10_60", 60), ("m1_5", 300), ("m5_30", 1800))
DWELL_BUCKET_KEYS = (*(k for k, _ in DWELL_BUCKETS), "gt_30m")

_sweep_lock = threading.Lock()


class RollupStoreUnavailable(RuntimeError):
    """The analytics store has no confirmed baseline (or is not started): nothing to write to."""


class RollupAlreadyRunning(RuntimeError):
    pass


def _dwell_bucket(seconds: float) -> str:
    for key, limit in DWELL_BUCKETS:
        if seconds < limit:
            return key
    return "gt_30m"


def _stage_ranks(ladder: list[dict]) -> dict[str, int]:
    """action -> ladder rank; an action in two stages reaches the higher one."""
    ranks: dict[str, int] = {}
    for rank, stage in enumerate(ladder):
        for action in stage["actions"]:
            ranks[action] = max(rank, ranks.get(action, rank))
    return ranks


def _parse(at: str) -> datetime:
    return datetime.fromisoformat(at.replace("Z", "+00:00"))


def _exit_context(row) -> dict | None:
    try:
        ctx = json.loads(row["context"]) if row["context"] else None
    except (json.JSONDecodeError, TypeError):
        logger.warning("[JourneyRollup] unreadable session_exit context at %s", row["created_at"])
        return None
    return ctx if isinstance(ctx, dict) else None


def aggregate_user(rows, ladder: list[dict], cohort_month: str) -> dict[str, Any]:
    """One user's log -> the sets/counts that user contributes (pure).

    exit_screen {(stage, last_screen)}: the latest exit while at that stage;
    stage_dwell {(stage, screen, bucket)}: dwell summed over the stage's exits;
    retry_burst {(stage, action)}: stage at the burst's first attempt;
    transition {(from, to, cohort_month): n}: consecutive ladder events, repeats included."""
    keys = [s["key"] for s in ladder]
    ranks = _stage_ranks(ladder)
    furthest = 0
    checkpoints: list[tuple[datetime, int]] = []  # (at, furthest) at each advance
    prev = 0
    transition: dict[tuple, int] = {}
    last_exit: dict[str, str] = {}
    dwell: dict[tuple[str, str], float] = {}
    attempts: dict[str, list[str]] = {}
    for row in sorted(rows, key=lambda r: _parse(r["created_at"])):
        action = row["action"]
        if action in ranks:
            rank = ranks[action]
            if rank != prev:
                key = (keys[prev], keys[rank], cohort_month)
                transition[key] = transition.get(key, 0) + 1
                prev = rank
            if rank > furthest:
                furthest = rank
                checkpoints.append((_parse(row["created_at"]), furthest))
        elif action == "session_exit":
            ctx = _exit_context(row)
            if ctx is None:
                continue
            stage = keys[furthest]
            if ctx.get("last_screen") in BREADCRUMB_SCREENS:
                last_exit[stage] = ctx["last_screen"]
            for screen, secs in (ctx.get("dwell") or {}).items():
                if screen in BREADCRUMB_SCREENS and isinstance(secs, (int, float)):
                    dwell[(stage, screen)] = dwell.get((stage, screen), 0.0) + secs
        elif action in RETRY_BURST_ACTIONS:
            attempts.setdefault(action, []).append(row["created_at"])

    at_times = [at for at, _ in checkpoints]
    retry_burst = set()
    for action, stamps in attempts.items():
        for burst in detect_retry_bursts(stamps):
            i = bisect_right(at_times, datetime.fromisoformat(burst["window_start"]))
            retry_burst.add((keys[checkpoints[i - 1][1]] if i else keys[0], action))
    return {
        "exit_screen": set(last_exit.items()),
        "stage_dwell": {(stage, screen, _dwell_bucket(secs)) for (stage, screen), secs in dwell.items()},
        "retry_burst": retry_burst,
        "transition": transition,
    }


def fold_rollups(per_user: list[dict[str, Any]]) -> dict[str, list[tuple]]:
    """Per-user contributions -> table rows (users per key; transitions also summed)."""
    counts: dict[str, dict[tuple, int]] = {"exit_screen": {}, "stage_dwell": {}, "retry_burst": {}}
    trans: dict[tuple, list[int]] = {}
    for agg in per_user:
        for kind, table in counts.items():
            for key in agg[kind]:
                table[key] = table.get(key, 0) + 1
        for key, n in agg["transition"].items():
            users_n = trans.setdefault(key, [0, 0])
            users_n[0] += 1
            users_n[1] += n
    return {
        "rollup_exit_screen": sorted((*k, n) for k, n in counts["exit_screen"].items()),
        "rollup_stage_dwell": sorted((*k, n) for k, n in counts["stage_dwell"].items()),
        "rollup_retry_burst": sorted((*k, n) for k, n in counts["retry_burst"].items()),
        "rollup_transition": sorted((*k, u, n) for k, (u, n) in trans.items()),
    }


def rollup_population() -> list[dict]:
    """Every non-test user with their signup time (cohort month)."""
    from .pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id, created_at FROM users WHERE NOT is_test_account ORDER BY created_at")
        return [dict(r) for r in cur.fetchall()]


def _read_user_log(user_id: str) -> list | None:
    """The user's action log through the JIT seam; None when the DB is below head."""
    from .. import migrations
    from . import user_db

    try:
        user_db.ensure_user_database(user_id)
    except migrations.MigrationBlocked as e:
        logger.warning(f"[JourneyRollup] user {user_id} blocked at the migration seam ({e.reason}); skipped")
        return None
    result = migrations.migrate_local_user_db_at_seam(user_id)
    if result.status != "ok":
        logger.warning(f"[JourneyRollup] user {user_id} not at head ({result.status}); skipped")
        return None
    with user_db.get_user_db_connection(user_id) as conn:
        return conn.execute("SELECT action, context, created_at FROM user_action_log").fetchall()


def sweep(users: list[dict], store: AnalyticsStore | None) -> dict[str, Any]:
    """Walk `users`, write one run into `store`, upload it. Returns the run summary."""
    from ..migrations import MigrationBlocked

    if store is None or store.state == StoreState.UNCONFIRMED:
        raise RollupStoreUnavailable("analytics store has no confirmed R2 baseline yet; retry shortly")
    if not _sweep_lock.acquire(blocking=False):
        raise RollupAlreadyRunning("a journey rollup is already running in this process")
    try:
        per_user, walked, failed, below_head = [], 0, 0, 0
        for user in users:
            uid = user["user_id"]
            try:
                rows = _read_user_log(uid)
            except MigrationBlocked as e:
                logger.warning(f"[JourneyRollup] user {uid} blocked opening user.sqlite ({e.reason}); skipped")
                rows = None
            except Exception:
                logger.exception(f"[JourneyRollup] user {uid} unreadable; counted in users_failed")
                failed += 1
                continue
            if rows is None:
                below_head += 1
                continue
            walked += 1
            per_user.append(aggregate_user(rows, JOURNEY_LADDER, user["created_at"].strftime("%Y-%m")))
        meta = {
            "run_id": uuid.uuid4().hex,
            "computed_at": datetime.now(UTC).isoformat(),
            "users_walked": walked,
            "users_failed": failed,
            "below_head_skipped": below_head,
        }
        store.write_journey_rollup(meta, fold_rollups(per_user))
        upload = store.upload_if_dirty()
        logger.info(f"[JourneyRollup] run {meta['run_id']}: walked={walked} below_head={below_head} "
                    f"failed={failed} upload={upload.value}")
        return {**meta, "upload": upload.value}
    finally:
        _sweep_lock.release()


@r2_source_scope(R2Source.ANALYTICS_STORE)
def load_newest_rollup() -> tuple[dict | None, bool]:
    """(newest run across this env's shards, partial). This writer's shard is read from
    the live local store (fresher than its last upload); a shard that cannot be listed
    or read marks the result partial, never disappears silently."""
    from ..storage import APP_ENV, R2_BUCKET, get_r2_sync_client
    from .analytics_store import current_store

    store = current_store()
    blobs: list[bytes] = []
    own = store.snapshot() if store is not None else None
    if own is not None:
        blobs.append(own)
    partial = False
    client = get_r2_sync_client()
    if client is not None:
        prefix = f"{APP_ENV}/analytics/shards/"
        try:
            keys = [obj["Key"]
                    for page in client.get_paginator("list_objects_v2").paginate(Bucket=R2_BUCKET, Prefix=prefix)
                    for obj in page.get("Contents", [])
                    if obj["Key"].endswith("/analytics.sqlite") and (store is None or obj["Key"] != store.key)]
        except Exception as e:
            logger.error(f"[JourneyRollup] LIST {prefix} failed: {e}")
            keys, partial = [], True
        for key in keys:
            try:
                blobs.append(client.get_object(Bucket=R2_BUCKET, Key=key)["Body"].read())
            except Exception as e:
                logger.error(f"[JourneyRollup] shard {key} unreadable: {e}")
                partial = True
    conns = []
    for blob in blobs:
        conn = sqlite3.connect(":memory:")
        conn.deserialize(blob)
        conns.append(conn)
    try:
        return newest_journey_rollup(conns), partial
    finally:
        for conn in conns:
            conn.close()


def journey_left(rollup: dict | None, stage: str) -> dict[str, Any]:
    """The inspector's "Where they left" section for one stage (pure)."""
    if rollup is None:
        return {"computed_at": None}
    exits = sorted(((r[1], r[2]) for r in rollup["rollup_exit_screen"] if r[0] == stage),
                   key=lambda x: (-x[1], x[0]))
    exit_users = sum(n for _, n in exits)
    dwell: dict[str, dict[str, int]] = {}
    for st, screen, bucket, n in rollup["rollup_stage_dwell"]:
        if st == stage:
            dwell.setdefault(screen, dict.fromkeys(DWELL_BUCKET_KEYS, 0))[bucket] = n
    out: dict[str, list[int]] = {}
    for frm, to, _cohort, users, n in rollup["rollup_transition"]:
        if frm == stage:
            acc = out.setdefault(to, [0, 0])
            acc[0] += users
            acc[1] += n
    meta = rollup["meta"]
    return {
        "computed_at": meta["computed_at"],
        "run_id": meta["run_id"],
        "users_walked": meta["users_walked"],
        "users_failed": meta["users_failed"],
        "below_head_skipped": meta["below_head_skipped"],
        "exit_users": exit_users,
        "exit_screens": [{"screen": s, "users": n, "share": percent_or_fraction(n, exit_users)}
                         for s, n in exits],
        "dwell": sorted(({"screen": s, "users": sum(b.values()), "buckets": b} for s, b in dwell.items()),
                        key=lambda d: (-d["users"], d["screen"])),
        "retry_bursts": sorted(({"action": a, "users": n} for st, a, n in rollup["rollup_retry_burst"]
                                if st == stage), key=lambda d: (-d["users"], d["action"])),
        "transitions_out": sorted(({"to_stage": to, "users": u, "transitions": n} for to, (u, n) in out.items()),
                                  key=lambda d: (-d["users"], d["to_stage"])),
    }
