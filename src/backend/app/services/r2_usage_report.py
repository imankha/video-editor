"""T13931: read side of the T13930 analytics shards -- the admin R2 usage view.

Every writer uploads its own `{env}/analytics/shards/{writer}/analytics.sqlite`
(analytics_store). The report lists each env prefix, downloads only shards whose ETag
changed since this process last read them, deserializes them in memory (no temp files)
and sums `r2_ops_daily` across writers. The merged result is cached in-process for
10 minutes; T13932's alert reuses load_merged_usage().

A shard that cannot be listed or read never disappears silently: it is reported with an
`error` and the whole result is marked `partial`. A partial result is not cached, so the
next read retries it.

Coverage: boto3 calls from the server and from Modal containers (T13933, credited as
`modal:{function}`). Presigned-URL traffic (browser, server httpx, Modal's ffmpeg range
reads) is not counted -- T13934 covers server httpx.
"""

import logging
import os
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from ..r2_usage import OpClass
from .analytics_store import analytics_local_path, writer_id

logger = logging.getLogger(__name__)

R2_USAGE_ENVS = ("dev", "staging", "production")
DAILY_WINDOW_DAYS = 30
TODAY_TOP_N = 10
CACHE_TTL_SECONDS = 600
R2_FREE_TIER_CLASS_A = int(os.getenv("R2_FREE_TIER_CLASS_A", "1000000"))
# The 2026-10-29 Cloudflare alert's cycle ran Oct 18 - Nov 17.
R2_BILLING_CYCLE_START_DAY = int(os.getenv("R2_BILLING_CYCLE_START_DAY", "18"))
if not 1 <= R2_BILLING_CYCLE_START_DAY <= 28:
    raise ValueError(f"R2_BILLING_CYCLE_START_DAY must be 1..28, got {R2_BILLING_CYCLE_START_DAY}")
COVERAGE = "server and Modal boto3 calls; excludes presigned-URL traffic"

SHARD_UNREADABLE = "unreadable"
ENV_LIST_FAILED = "list_failed"
_SHARD_SUFFIX = "/analytics.sqlite"

MergedKey = tuple[str, str, str, str]  # (day, env, source, op_class)


@dataclass
class MergedUsage:
    generated_at: datetime
    counts: dict[MergedKey, int] = field(default_factory=dict)
    shards: list[dict] = field(default_factory=list)
    partial: bool = False


@dataclass
class _ShardRead:
    etag: str
    schema: int
    rows: list[tuple[str, str, str, str, int]]  # (day, env, source, op_class, count)


_lock = threading.Lock()  # one refresh at a time; guards both caches
_shard_cache: dict[str, _ShardRead] = {}
_merged_cache: tuple[float, MergedUsage] | None = None


def clear_cache(keep_shards: bool = False) -> None:
    global _merged_cache
    with _lock:
        _merged_cache = None
        if not keep_shards:
            _shard_cache.clear()


def billing_cycle(today: date) -> tuple[date, date]:
    """(first, last) day of the R2 billing cycle containing `today`."""
    day = R2_BILLING_CYCLE_START_DAY
    if today.day >= day:
        start = today.replace(day=day)
    elif today.month == 1:
        start = date(today.year - 1, 12, day)
    else:
        start = today.replace(month=today.month - 1, day=day)
    next_start = date(start.year + 1, 1, day) if start.month == 12 else start.replace(month=start.month + 1)
    return start, next_start - timedelta(days=1)


def _read_shard_rows(body: bytes) -> tuple[int, list[tuple]]:
    conn = sqlite3.connect(":memory:")
    try:
        conn.deserialize(body)
        schema = conn.execute("PRAGMA user_version").fetchone()[0]
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'r2_ops_daily'"
        ).fetchone()
        if not has_table:
            return schema, []
        rows = conn.execute(
            "SELECT day, env, source, op_class, SUM(count) FROM r2_ops_daily "
            "GROUP BY day, env, source, op_class"
        ).fetchall()
        return schema, rows
    finally:
        conn.close()


def _merge(merged: MergedUsage, rows) -> None:
    for day, env, source, op_class, count in rows:
        key = (day, env, source, op_class)
        merged.counts[key] = merged.counts.get(key, 0) + count


def _load_local(merged: MergedUsage) -> None:
    """R2 disabled (tests, offline dev): the local shard is the only one."""
    from ..storage import APP_ENV

    path = analytics_local_path()
    if not path.exists():
        return
    shard = {
        "env": APP_ENV,
        "writer": writer_id(),
        "last_modified": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
        "schema": None,
        "error": None,
    }
    try:
        shard["schema"], rows = _read_shard_rows(path.read_bytes())
        _merge(merged, rows)
    except Exception as e:
        logger.error(f"[R2_USAGE_REPORT] local shard {path} unreadable: {e}")
        shard["error"] = SHARD_UNREADABLE
        merged.partial = True
    merged.shards.append(shard)


def _load_env(client, bucket: str, env: str, merged: MergedUsage) -> None:
    prefix = f"{env}/analytics/shards/"
    try:
        listed = [
            obj
            for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix)
            for obj in page.get("Contents", [])
            if obj["Key"].endswith(_SHARD_SUFFIX)
        ]
    except Exception as e:
        logger.error(f"[R2_USAGE_REPORT] LIST {prefix} failed: {e}")
        merged.shards.append({"env": env, "writer": None, "last_modified": None, "schema": None,
                              "error": ENV_LIST_FAILED})
        merged.partial = True
        return
    for obj in listed:
        key = obj["Key"]
        shard = {
            "env": env,
            "writer": key[len(prefix):-len(_SHARD_SUFFIX)],
            "last_modified": obj["LastModified"].isoformat(),
            "schema": None,
            "error": None,
        }
        cached = _shard_cache.get(key)
        if cached is None or cached.etag != obj["ETag"]:
            try:
                resp = client.get_object(Bucket=bucket, Key=key)
                schema, rows = _read_shard_rows(resp["Body"].read())
                cached = _ShardRead(etag=resp["ETag"], schema=schema, rows=rows)
                _shard_cache[key] = cached
            except Exception as e:
                logger.error(f"[R2_USAGE_REPORT] shard {key} unreadable: {e}")
                _shard_cache.pop(key, None)
                shard["error"] = SHARD_UNREADABLE
                merged.partial = True
                merged.shards.append(shard)
                continue
        shard["schema"] = cached.schema
        _merge(merged, cached.rows)
        merged.shards.append(shard)


def load_merged_usage() -> MergedUsage:
    """Every writer's r2_ops_daily summed by (day, env, source, op_class), all envs."""
    global _merged_cache
    from ..storage import APP_ENV, R2_BUCKET, get_r2_client

    with _lock:
        if _merged_cache is not None and time.monotonic() - _merged_cache[0] < CACHE_TTL_SECONDS:
            return _merged_cache[1]
        merged = MergedUsage(generated_at=datetime.now(UTC))
        client = get_r2_client()
        if client is None:
            _load_local(merged)
        else:
            envs = R2_USAGE_ENVS if APP_ENV in R2_USAGE_ENVS else (*R2_USAGE_ENVS, APP_ENV)
            for env in envs:
                _load_env(client, R2_BUCKET, env, merged)
        # A partial result is not cached: the next read retries the failed shard.
        _merged_cache = None if merged.partial else (time.monotonic(), merged)
        return merged


def _class_columns() -> dict[str, int]:
    return {"class_a": 0, "class_b": 0, "free": 0, "unclassified": 0}


_COLUMN = {
    OpClass.A.value: "class_a",
    OpClass.B.value: "class_b",
    OpClass.FREE.value: "free",
    OpClass.UNCLASSIFIED.value: "unclassified",
}


def build_r2_usage_report() -> dict:
    """Payload for GET /api/admin/r2-usage."""
    merged = load_merged_usage()
    now = merged.generated_at
    today = now.date()
    window_start = (today - timedelta(days=DAILY_WINDOW_DAYS - 1)).isoformat()
    cycle_start, cycle_end = billing_cycle(today)

    daily: dict[tuple[str, str, str], dict] = {}
    cycle = _class_columns()
    for (day, env, source, op_class), count in merged.counts.items():
        column = _COLUMN.get(op_class)
        if column is None:
            logger.error(f"[R2_USAGE_REPORT] unknown op_class {op_class!r} in a shard; counted as unclassified")
            column = "unclassified"
        if day >= window_start:
            row = daily.setdefault((day, env, source), {"day": day, "env": env, "source": source,
                                                        **_class_columns()})
            row[column] += count
        if cycle_start.isoformat() <= day <= cycle_end.isoformat():
            cycle[column] += count

    today_rows = [r for r in daily.values() if r["day"] == today.isoformat()]
    today_top = sorted(today_rows, key=lambda r: (-r["class_a"], -r["class_b"], r["env"], r["source"]))
    cycle_days = (cycle_end - cycle_start).days + 1
    elapsed_days = (now - datetime.combine(cycle_start, datetime.min.time(), UTC)).total_seconds() / 86400
    return {
        "generated_at": now.isoformat(),
        "coverage": COVERAGE,
        "partial": merged.partial,
        "cycle": {
            "start": cycle_start.isoformat(),
            "end": cycle_end.isoformat(),
            "elapsed_days": round(elapsed_days, 2),
            "class_a": cycle["class_a"],
            "class_b": cycle["class_b"],
            "free_tier_class_a": R2_FREE_TIER_CLASS_A,
            # Linear pace; under a day of data is projected as one full day.
            "projected_class_a": round(cycle["class_a"] / max(elapsed_days, 1.0) * cycle_days),
        },
        "daily": sorted(daily.values(), key=lambda r: (r["day"], r["env"], r["source"]), reverse=True),
        "today_top": [
            {"env": r["env"], "source": r["source"], "class_a": r["class_a"], "class_b": r["class_b"]}
            for r in today_top[:TODAY_TOP_N]
        ],
        "shards": merged.shards,
    }
