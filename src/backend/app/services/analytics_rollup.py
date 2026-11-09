"""T7400: action-weekly cohort rollup -- distinct users active per
(cohort_week, sport, action, week_index), plus per-action monthly engagement
distributions, into analytics.sqlite (schema step 4).

Admin-triggered (POST /api/admin/analytics/rollup), in-process, full rebuild per run:
walks every non-test user's user.sqlite through the JIT seam (same shape as
analytics_journey_rollup.sweep), reduces user_action_log to the aggregates below, and
writes only the aggregate rows into this writer's shard. Raw events never leave the
per-user DB -- this is the sweep the epic requires instead of a per-event shared store.

Sport (T14950 grouping, 2026-11-09): a row's sport is its user_action_log
context["sport"] when present, else UNRECORDED_SPORT. That is NOT analytics.py's
`no_sport` sentinel -- here it means "no tag on this historical row" (row predates
SPORT_TAG_INSTRUMENTED_AT for that action, or the action never carries one), not
"tagged sport-less". Only FLOW_EVENTS actions are counted (the doc's closed universe).

A user whose DB can't be brought to head, or whose user_segments row has no
acquired_at, is counted in users_failed (not silently dropped) -- this task's
acceptance criterion names only users_swept/users_failed/computed_at, unlike the
journey rollup's three-way split. Full rebuild per run; readers take the newest run
across shards (analytics_store.newest_action_rollup) -- same per-writer-shard shape as
the journey rollup: two shards after two runs describe the same population twice, so
summing would double count.
"""

import json
import logging
import statistics
import threading
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from .analytics_journey_rollup import map_users
from .analytics_store import AnalyticsStore, StoreState

logger = logging.getLogger(__name__)

UNRECORDED_SPORT = "unrecorded"

_sweep_lock = threading.Lock()


class ActionRollupStoreUnavailable(RuntimeError):
    """The analytics store has no confirmed R2 baseline yet: nothing to write to."""


class ActionRollupAlreadyRunning(RuntimeError):
    pass


def _cohort_week(acquired_at: date) -> str:
    """ISO Monday of acquired_at's week."""
    monday = acquired_at - timedelta(days=acquired_at.isoweekday() - 1)
    return monday.isoformat()


def _parse(at: str) -> datetime:
    return datetime.fromisoformat(at.replace("Z", "+00:00"))


def rollup_population() -> list[dict]:
    """Every non-test user with their signup time and acquired_at (cohort anchor)."""
    from .pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT u.user_id, s.acquired_at FROM users u "
            "LEFT JOIN user_segments s ON s.user_id = u.user_id "
            "WHERE NOT u.is_test_account ORDER BY u.created_at"
        )
        return [dict(r) for r in cur.fetchall()]


def _read_user_log(user_id: str) -> list | None:
    """The user's action log through the JIT seam; None when the DB is below head."""
    from .. import migrations
    from . import user_db

    user_db.ensure_user_database(user_id)
    result = migrations.migrate_local_user_db_at_seam(user_id)
    if result.status != "ok":
        return None
    with user_db.get_user_db_connection(user_id) as conn:
        return conn.execute("SELECT action, context, created_at FROM user_action_log").fetchall()


def _walk_user(uid: str) -> tuple[str, list | None]:
    """("ok", rows) | ("failed", None) for one user."""
    try:
        rows = _read_user_log(uid)
    except Exception:
        logger.exception(f"[ActionRollup] user {uid} unreadable; counted in users_failed")
        return "failed", None
    return ("failed", None) if rows is None else ("ok", rows)


def aggregate_user(rows, cohort_week: str) -> dict[str, Any]:
    """One user's log -> the weekly-active keys + monthly per-action counts this user
    contributes (pure)."""
    from ..analytics import FLOW_EVENTS

    monday = date.fromisoformat(cohort_week)
    weekly: set[tuple[str, str, str, int]] = set()  # (cohort_week, sport, action, week_index)
    monthly: dict[tuple[str, str], int] = {}  # (month, action) -> count
    for row in rows:
        action = row["action"]
        if action not in FLOW_EVENTS:
            continue
        created = _parse(row["created_at"])
        try:
            ctx = json.loads(row["context"]) if row["context"] else None
        except (json.JSONDecodeError, TypeError):
            ctx = None
        sport = (ctx or {}).get("sport") or UNRECORDED_SPORT
        week_index = (created.date() - monday).days // 7
        if week_index >= 0:
            weekly.add((cohort_week, sport, action, week_index))
        month = created.strftime("%Y-%m")
        monthly[(month, action)] = monthly.get((month, action), 0) + 1
    return {"weekly": weekly, "monthly": monthly}


def _percentile(sorted_values: list[int], pct: int) -> float:
    k = (len(sorted_values) - 1) * (pct / 100)
    f, c = int(k), min(int(k) + 1, len(sorted_values) - 1)
    if f == c:
        return float(sorted_values[f])
    return sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)


def fold_rollups(per_user: list[dict[str, Any]]) -> dict[str, list[tuple]]:
    """Per-user contributions -> table rows (distinct users per weekly key; monthly
    counts reduced to a distribution summary over active users, never stored per-user)."""
    weekly_users: dict[tuple, int] = {}
    monthly_counts: dict[tuple[str, str], list[int]] = {}
    for agg in per_user:
        for key in agg["weekly"]:
            weekly_users[key] = weekly_users.get(key, 0) + 1
        for key, n in agg["monthly"].items():
            monthly_counts.setdefault(key, []).append(n)
    weekly_rows = sorted((*k, n) for k, n in weekly_users.items())
    monthly_rows = []
    for (month, action), counts in sorted(monthly_counts.items()):
        counts_sorted = sorted(counts)
        monthly_rows.append((
            month, action, len(counts_sorted),
            float(statistics.median(counts_sorted)),
            _percentile(counts_sorted, 25),
            _percentile(counts_sorted, 75),
        ))
    return {"rollup_action_weekly": weekly_rows, "rollup_engagement_monthly": monthly_rows}


def sweep(users: list[dict], store: AnalyticsStore | None) -> dict[str, Any]:
    """Walk `users`, write one run into `store`, upload it. Returns the run summary."""
    if store is None or store.state == StoreState.UNCONFIRMED:
        raise ActionRollupStoreUnavailable("analytics store has no confirmed R2 baseline yet; retry shortly")
    if not _sweep_lock.acquire(blocking=False):
        raise ActionRollupAlreadyRunning("an action rollup is already running in this process")
    try:
        per_user, swept, failed, log_rows = [], 0, 0, 0
        walkable = [u for u in users if u.get("acquired_at") is not None]
        failed += len(users) - len(walkable)
        user_ids = [u["user_id"] for u in walkable]
        results = dict(zip(user_ids, map_users(_walk_user, user_ids), strict=True))
        for user in walkable:
            uid = user["user_id"]
            status, rows = results[uid]
            if status == "failed":
                failed += 1
                continue
            swept += 1
            log_rows += len(rows)
            cohort_week = _cohort_week(user["acquired_at"])
            per_user.append(aggregate_user(rows, cohort_week))
        meta = {
            "run_id": uuid.uuid4().hex,
            "computed_at": datetime.now(UTC).isoformat(),
            "users_swept": swept,
            "users_failed": failed,
            "log_rows_reduced": log_rows,
        }
        store.write_action_rollup(meta, fold_rollups(per_user))
        upload = store.upload_if_dirty()
        logger.info(f"[ActionRollup] run {meta['run_id']}: swept={swept} failed={failed} "
                    f"log_rows={log_rows} upload={upload.value}")
        return {**meta, "upload": upload.value}
    finally:
        _sweep_lock.release()


def load_newest_action_rollup() -> tuple[dict | None, bool]:
    """(newest run across this env's shards, partial) -- same shard-collection shape as
    analytics_journey_rollup.load_newest_rollup."""
    import sqlite3

    from ..storage import APP_ENV, R2_BUCKET, get_r2_sync_client
    from .analytics_store import current_store, newest_action_rollup

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
            listed = [obj["Key"]
                      for page in client.get_paginator("list_objects_v2").paginate(Bucket=R2_BUCKET, Prefix=prefix)
                      for obj in page.get("Contents", [])
                      if obj["Key"].endswith("/analytics.sqlite") and (store is None or obj["Key"] != store.key)]
        except Exception as e:
            logger.error(f"[ActionRollup] LIST {prefix} failed: {e}")
            listed, partial = [], True
        for key in listed:
            try:
                blobs.append(client.get_object(Bucket=R2_BUCKET, Key=key)["Body"].read())
            except Exception as e:
                logger.error(f"[ActionRollup] shard {key} unreadable: {e}")
                partial = True
    conns = []
    for blob in blobs:
        conn = sqlite3.connect(":memory:")
        conn.deserialize(blob)
        conns.append(conn)
    try:
        return newest_action_rollup(conns), partial
    finally:
        for conn in conns:
            conn.close()
