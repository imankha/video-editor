"""T13930: analytics.sqlite -- the flat, aggregates-only analytics store on R2.

Per-writer shards: each process writes ONLY its own object,
`{APP_ENV}/analytics/shards/{writer_id}/analytics.sqlite`; readers list the shards and
sum them. Two machines never write the same key, so a CAS conflict is an anomaly
(two live processes sharing a writer_id), never routine.

Not one of the three migration tracks: no _SCHEMA_DDL, no migrations/ file, no JIT
seam. The schema is created/evolved here from PRAGMA user_version, additive only.
Step 2 (T14030) is the Journey rollup; T7400's rollup_action_weekly takes step 3.

Two read rules, by table kind:
  - counters (r2_ops_daily): every writer counts different traffic, so readers SUM shards.
  - rebuilt rollups (step 2, rollup_*): each run is a full rebuild over every user, so two
    shards holding two runs describe the same population twice. Every row carries
    run_id; a shard keeps only its latest run; readers take the run with the newest
    computed_at across shards and read only that run (newest_journey_rollup). Never sum.

Cadence and cost (design T13930 sec 4.3): the R2 hook only increments memory
(r2_usage.UsageBuffer). Every 60s the buffer is folded into the local file; every hour
(and on graceful shutdown) the file is uploaded IF app activity made it dirty. The
store's own R2 ops are counted under `analytics_store` but never make it dirty, so an
idle machine stops uploading: worst case ~30 Class A/day per writer.

Persistence rule 7, both halves:
  - restore side: the local file is opened only after its R2 baseline is confirmed
    (GET own shard -> adopt bytes + ETag, or 404 -> fresh). Until then counts wait in
    memory.
  - upload side: HEAD-etag compare, then PUT. A mismatch refuses, logs CRITICAL, and
    FREEZES the shard -- no merge, no retry, no overwrite. Local counting continues;
    what was counted since the last good upload is lost on restart (re-adopts R2).
"""

import asyncio
import logging
import os
import socket
import sqlite3
import threading
import time
from datetime import UTC, datetime, timedelta
from enum import Enum
from pathlib import Path

from ..r2_usage import R2Source, UsageKey, r2_source_scope, usage_buffer

logger = logging.getLogger(__name__)

FLUSH_INTERVAL_SECONDS = 60
UPLOAD_INTERVAL_SECONDS = 3600
BASELINE_RETRY_MAX_SECONDS = 3600
RETENTION_DAYS = 90
SHUTDOWN_FLUSH_TIMEOUT_SECONDS = 5

# Ordered, additive-only schema steps; step N leaves PRAGMA user_version = N.
_SCHEMA_STEPS: dict[int, list[str]] = {
    1: [
        """CREATE TABLE IF NOT EXISTS r2_ops_daily (
            day      TEXT NOT NULL,
            env      TEXT NOT NULL,
            source   TEXT NOT NULL,
            op_class TEXT NOT NULL,
            op       TEXT NOT NULL,
            count    INTEGER NOT NULL,
            PRIMARY KEY (day, env, source, op)
        )""",
        "CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ],
    # T14030: Journey rollup. Aggregates only: counts keyed by stage, no user/event rows.
    2: [
        """CREATE TABLE IF NOT EXISTS rollup_meta (
            run_id             TEXT PRIMARY KEY,
            computed_at        TEXT NOT NULL,
            users_walked       INTEGER NOT NULL,
            users_failed       INTEGER NOT NULL,
            below_head_skipped INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS rollup_exit_screen (
            run_id      TEXT NOT NULL,
            stage       TEXT NOT NULL,
            last_screen TEXT NOT NULL,
            users       INTEGER NOT NULL,
            PRIMARY KEY (run_id, stage, last_screen)
        )""",
        """CREATE TABLE IF NOT EXISTS rollup_stage_dwell (
            run_id TEXT NOT NULL,
            stage  TEXT NOT NULL,
            screen TEXT NOT NULL,
            bucket TEXT NOT NULL,
            users  INTEGER NOT NULL,
            PRIMARY KEY (run_id, stage, screen, bucket)
        )""",
        """CREATE TABLE IF NOT EXISTS rollup_retry_burst (
            run_id TEXT NOT NULL,
            stage  TEXT NOT NULL,
            action TEXT NOT NULL,
            users  INTEGER NOT NULL,
            PRIMARY KEY (run_id, stage, action)
        )""",
        """CREATE TABLE IF NOT EXISTS rollup_transition (
            run_id       TEXT NOT NULL,
            from_stage   TEXT NOT NULL,
            to_stage     TEXT NOT NULL,
            cohort_month TEXT NOT NULL,
            users        INTEGER NOT NULL,
            transitions  INTEGER NOT NULL,
            PRIMARY KEY (run_id, from_stage, to_stage, cohort_month)
        )""",
    ],
    # T7410: first-party visit beacon. Counter-like (each visit lands on exactly one
    # writer), so readers SUM across shards -- never "newest run" like step 2.
    3: [
        """CREATE TABLE IF NOT EXISTS visit_daily (
            day        TEXT NOT NULL,
            source     TEXT NOT NULL,
            page_class TEXT NOT NULL,
            count      INTEGER NOT NULL,
            PRIMARY KEY (day, source, page_class)
        )""",
    ],
    # T7400: action-weekly cohort rollup + monthly engagement distributions. Full
    # rebuild per run, same per-writer-shard shape as step 2 (newest run wins, never
    # summed across shards). Table name distinct from step 2's `rollup_meta` --
    # separate run lineage, separate reader.
    4: [
        """CREATE TABLE IF NOT EXISTS action_rollup_meta (
            run_id           TEXT PRIMARY KEY,
            computed_at      TEXT NOT NULL,
            users_swept      INTEGER NOT NULL,
            users_failed     INTEGER NOT NULL,
            log_rows_reduced INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS rollup_action_weekly (
            run_id         TEXT NOT NULL,
            cohort_week    TEXT NOT NULL,
            sport          TEXT NOT NULL,
            action         TEXT NOT NULL,
            week_index     INTEGER NOT NULL,
            distinct_users INTEGER NOT NULL,
            PRIMARY KEY (run_id, cohort_week, sport, action, week_index)
        )""",
        """CREATE TABLE IF NOT EXISTS rollup_engagement_monthly (
            run_id       TEXT NOT NULL,
            month        TEXT NOT NULL,
            action       TEXT NOT NULL,
            active_users INTEGER NOT NULL,
            median_count REAL NOT NULL,
            p25          REAL NOT NULL,
            p75          REAL NOT NULL,
            PRIMARY KEY (run_id, month, action)
        )""",
    ],
}

# Column order after run_id, as written and as newest_journey_rollup returns rows.
JOURNEY_ROLLUP_TABLES: dict[str, tuple[str, ...]] = {
    "rollup_exit_screen": ("stage", "last_screen", "users"),
    "rollup_stage_dwell": ("stage", "screen", "bucket", "users"),
    "rollup_retry_burst": ("stage", "action", "users"),
    "rollup_transition": ("from_stage", "to_stage", "cohort_month", "users", "transitions"),
}
_ROLLUP_META_COLUMNS = ("run_id", "computed_at", "users_walked", "users_failed", "below_head_skipped")

# T7400: column order after run_id, as written and as newest_action_rollup returns rows.
ACTION_ROLLUP_TABLES: dict[str, tuple[str, ...]] = {
    "rollup_action_weekly": ("cohort_week", "sport", "action", "week_index", "distinct_users"),
    "rollup_engagement_monthly": ("month", "action", "active_users", "median_count", "p25", "p75"),
}
_ACTION_ROLLUP_META_COLUMNS = ("run_id", "computed_at", "users_swept", "users_failed", "log_rows_reduced")


class StoreState(str, Enum):
    UNCONFIRMED = "unconfirmed"  # R2 baseline unknown: nothing written locally or uploaded
    CONFIRMED = "confirmed"
    FROZEN = "frozen"            # CAS conflict: never uploads again in this process


class UploadResult(str, Enum):
    UPLOADED = "uploaded"
    CLEAN = "clean"
    CONFLICT = "conflict"
    FAILED = "failed"            # transient: still dirty, retried next upload tick
    NOT_CONFIRMED = "not_confirmed"
    FROZEN = "frozen"
    LOCK_TIMEOUT = "lock_timeout"


def analytics_local_path() -> Path:
    # A SIBLING of user_data/, never inside it: user-iteration code globs and lists
    # user_data/ children as user ids.
    from ..database import USER_DATA_BASE
    return USER_DATA_BASE.parent / "analytics_data" / "analytics.sqlite"


def writer_id() -> str:
    # Fly machine ids survive in-place deploys, so a machine keeps its shard.
    return os.getenv("ANALYTICS_WRITER_ID") or os.getenv("FLY_MACHINE_ID") or f"local-{socket.gethostname()}"


def shard_key(env: str, writer: str) -> str:
    return f"{env}/analytics/shards/{writer}/analytics.sqlite"


def _is_not_found(e: Exception) -> bool:
    code = str(((getattr(e, "response", None) or {}).get("Error") or {}).get("Code", ""))
    return code in ("404", "NoSuchKey")


def _ensure_schema(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for step in sorted(s for s in _SCHEMA_STEPS if s > version):
        for statement in _SCHEMA_STEPS[step]:
            conn.execute(statement)
        conn.execute(f"PRAGMA user_version = {step}")
    conn.commit()
    # A newer shard (rollback) keeps its user_version; this code uses the tables it knows.


VisitKey = tuple[str, str, str]  # (day, source, page_class)


class AnalyticsStore:
    def __init__(self, local_path: Path, key: str, writer_id: str, env: str):
        self.local_path = local_path
        self.key = key
        self.writer_id = writer_id
        self.env = env
        self.state = StoreState.UNCONFIRMED
        self._lock = threading.Lock()  # guards _conn, generations, the HEAD+PUT pair
        self._conn: sqlite3.Connection | None = None
        self._expected_etag: str | None = None
        self._dirty_gen = 0
        self._uploaded_gen = 0
        self._final_flush_done = False
        self._visit_lock = threading.Lock()  # guards _visit_buffer only (never held with _lock)
        self._visit_buffer: dict[VisitKey, int] = {}

    # -- visit beacon (T7410) -----------------------------------------------

    def record_visit(self, source: str, page_class: str) -> None:
        """Buffer one visit in memory; flush_local drains it into visit_daily on the
        next tick (same cadence as the r2_ops usage buffer). Safe before a confirmed
        baseline -- the count just waits longer in memory."""
        day = datetime.now(UTC).date().isoformat()
        key = (day, source, page_class)
        with self._visit_lock:
            self._visit_buffer[key] = self._visit_buffer.get(key, 0) + 1

    def _drain_visits(self) -> dict[VisitKey, int]:
        with self._visit_lock:
            drained, self._visit_buffer = self._visit_buffer, {}
        return drained

    # -- baseline ------------------------------------------------------------

    @r2_source_scope(R2Source.ANALYTICS_STORE)
    def confirm_baseline(self) -> bool:
        """Adopt this writer's R2 shard (or start fresh on 404) BEFORE opening the
        local file, so a live connection's file is never swapped. False = R2 error:
        stay UNCONFIRMED, counts keep waiting in memory, the caller retries later."""
        from ..storage import R2_BUCKET, get_r2_sync_client

        client = get_r2_sync_client()
        self.local_path.parent.mkdir(parents=True, exist_ok=True)
        if client is None:
            logger.info(f"[ANALYTICS_STORE] R2 disabled -- local-only store at {self.local_path}")
        else:
            try:
                resp = client.get_object(Bucket=R2_BUCKET, Key=self.key)
                body = resp["Body"].read()
                tmp = self.local_path.with_suffix(".download")
                tmp.write_bytes(body)
                tmp.replace(self.local_path)
                self._expected_etag = resp["ETag"]
                logger.info(f"[ANALYTICS_STORE] adopted shard {self.key} etag={self._expected_etag}")
            except Exception as e:
                if not _is_not_found(e):
                    logger.warning(f"[ANALYTICS_STORE] baseline GET failed for {self.key}: {e}")
                    return False
                if self.local_path.exists():
                    # Never uploaded, so it cannot be proven current: R2 (no shard) wins.
                    logger.warning(f"[ANALYTICS_STORE] no R2 shard; discarding unconfirmed local {self.local_path}")
                    self.local_path.unlink()
                self._expected_etag = None
        conn = sqlite3.connect(str(self.local_path), check_same_thread=False)
        _ensure_schema(conn)
        conn.execute("INSERT OR IGNORE INTO store_meta (key, value) VALUES ('writer_id', ?)", (self.writer_id,))
        conn.execute(
            "INSERT OR IGNORE INTO store_meta (key, value) VALUES ('created_at', ?)",
            (datetime.now(UTC).isoformat(),),
        )
        conn.commit()
        with self._lock:
            self._conn = conn
            self.state = StoreState.CONFIRMED
        return True

    # -- local flush -----------------------------------------------------------

    def flush_local(self, lock_timeout_s: float | None = None) -> bool:
        """Fold the in-memory counters into the local file. False if they could not
        be written (lock timeout or SQLite error); the counts go back to the buffer."""
        if self.state == StoreState.UNCONFIRMED:
            return True  # counts wait in memory for a confirmed baseline
        buffer = usage_buffer()
        drained = buffer.drain(timeout_s=lock_timeout_s)
        if drained is None:
            return False
        visits = self._drain_visits()
        if not drained and not visits:
            return True
        if not self._lock.acquire(timeout=-1 if lock_timeout_s is None else lock_timeout_s):
            buffer.restore(drained)
            self._restore_visits(visits)
            return False
        try:
            if drained:
                self._write_counts(drained)
            if visits:
                self._write_visits(visits)
            if visits or any(key[2] != R2Source.ANALYTICS_STORE.value for key in drained):
                self._dirty_gen += 1
            return True
        except Exception:
            buffer.restore(drained)
            self._restore_visits(visits)
            logger.exception("[ANALYTICS_STORE] local flush failed; counts kept in memory for the next flush")
            return False
        finally:
            self._lock.release()

    def _restore_visits(self, visits: dict[VisitKey, int]) -> None:
        if not visits:
            return
        with self._visit_lock:
            for key, n in visits.items():
                self._visit_buffer[key] = self._visit_buffer.get(key, 0) + n

    def _write_counts(self, drained: dict[UsageKey, int]) -> None:
        cutoff = (datetime.now(UTC).date() - timedelta(days=RETENTION_DAYS)).isoformat()
        with self._conn:
            self._conn.executemany(
                "INSERT INTO r2_ops_daily (day, env, source, op_class, op, count) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (day, env, source, op) DO UPDATE SET count = count + excluded.count",
                [(*key, n) for key, n in drained.items()],
            )
            self._conn.execute("DELETE FROM r2_ops_daily WHERE day < ?", (cutoff,))

    def _write_visits(self, drained: dict[VisitKey, int]) -> None:
        cutoff = (datetime.now(UTC).date() - timedelta(days=RETENTION_DAYS)).isoformat()
        with self._conn:
            self._conn.executemany(
                "INSERT INTO visit_daily (day, source, page_class, count) VALUES (?, ?, ?, ?) "
                "ON CONFLICT (day, source, page_class) DO UPDATE SET count = count + excluded.count",
                [(*key, n) for key, n in drained.items()],
            )
            self._conn.execute("DELETE FROM visit_daily WHERE day < ?", (cutoff,))

    # -- CAS upload ------------------------------------------------------------

    @r2_source_scope(R2Source.ANALYTICS_STORE)
    def upload_if_dirty(self, lock_timeout_s: float | None = None) -> UploadResult:
        if self.state == StoreState.FROZEN:
            return UploadResult.FROZEN
        if self.state == StoreState.UNCONFIRMED:
            return UploadResult.NOT_CONFIRMED
        from ..storage import R2_BUCKET, get_r2_sync_client

        client = get_r2_sync_client()
        if client is None:
            return UploadResult.CLEAN  # R2 disabled: the local file is the store
        if not self._lock.acquire(timeout=-1 if lock_timeout_s is None else lock_timeout_s):
            return UploadResult.LOCK_TIMEOUT
        try:
            if self._dirty_gen <= self._uploaded_gen:
                return UploadResult.CLEAN
            snapshot = self._conn.serialize()
            snap_gen = self._dirty_gen
            try:
                head = client.head_object(Bucket=R2_BUCKET, Key=self.key)
                found_etag = head["ETag"]
                found_writer = (head.get("Metadata") or {}).get("analytics-writer", "?")
            except Exception as e:
                if not _is_not_found(e):
                    logger.warning(f"[ANALYTICS_STORE] HEAD failed for {self.key}: {e}; retry next upload tick")
                    return UploadResult.FAILED
                found_etag, found_writer = None, None
            if found_etag != self._expected_etag:
                self.state = StoreState.FROZEN
                logger.critical(
                    f"[ANALYTICS_STORE_CONFLICT] key={self.key} expected_etag={self._expected_etag} "
                    f"found_etag={found_etag} found_writer={found_writer} "
                    f"this_writer={self.writer_id}/{os.getpid()} -- upload refused, shard frozen "
                    f"(counts since the last good upload are lost on restart)"
                )
                return UploadResult.CONFLICT
            try:
                resp = client.put_object(
                    Bucket=R2_BUCKET,
                    Key=self.key,
                    Body=snapshot,
                    Metadata={
                        "analytics-writer": f"{self.writer_id}/{os.getpid()}",
                        "analytics-written-at": datetime.now(UTC).isoformat(),
                        "analytics-schema": str(max(_SCHEMA_STEPS)),
                    },
                )
            except Exception as e:
                logger.error(f"[ANALYTICS_STORE] PUT failed for {self.key}: {e}; retry next upload tick")
                return UploadResult.FAILED
            self._expected_etag = resp["ETag"]
            self._uploaded_gen = snap_gen
            return UploadResult.UPLOADED
        finally:
            self._lock.release()

    # -- shutdown ----------------------------------------------------------------

    def final_flush(self, timeout_s: float) -> None:
        """Flush + upload once at shutdown. The SIGTERM handler runs on the main thread
        and may have interrupted a frame holding one of these (non-reentrant) locks, so
        every acquire is timed: on timeout, log and give up rather than hang."""
        if self._final_flush_done:
            return
        self._final_flush_done = True
        if self.state == StoreState.UNCONFIRMED:
            logger.error("[ANALYTICS_STORE] final flush: baseline never confirmed; in-memory counts are lost")
            return
        if not self.flush_local(lock_timeout_s=timeout_s):
            logger.error(
                f"[ANALYTICS_STORE] final flush skipped: could not write counts within {timeout_s}s "
                f"(up to {UPLOAD_INTERVAL_SECONDS // 60} min of counts lost)"
            )
            return
        result = self.upload_if_dirty(lock_timeout_s=timeout_s)
        logger.info(f"[ANALYTICS_STORE] final flush upload: {result.value}")

    # -- journey rollup (T14030) ------------------------------------------------

    def write_journey_rollup(self, meta: dict, rows: dict[str, list[tuple]]) -> None:
        """Replace this shard's rollup with one run (full rebuild): the previous run's
        rows go in the same transaction. Marks the shard dirty so it uploads."""
        if self._conn is None:
            raise RuntimeError(f"analytics store {self.key} has no confirmed baseline")
        with self._lock:
            with self._conn:
                for table in (*JOURNEY_ROLLUP_TABLES, "rollup_meta"):
                    self._conn.execute(f"DELETE FROM {table}")
                self._conn.execute(
                    f"INSERT INTO rollup_meta ({', '.join(_ROLLUP_META_COLUMNS)}) VALUES (?, ?, ?, ?, ?)",
                    tuple(meta[c] for c in _ROLLUP_META_COLUMNS),
                )
                for table, cols in JOURNEY_ROLLUP_TABLES.items():
                    self._conn.executemany(
                        f"INSERT INTO {table} (run_id, {', '.join(cols)}) "
                        f"VALUES ({', '.join('?' for _ in range(len(cols) + 1))})",
                        [(meta["run_id"], *r) for r in rows[table]],
                    )
            self._dirty_gen += 1

    def write_action_rollup(self, meta: dict, rows: dict[str, list[tuple]]) -> None:
        """T7400: replace this shard's action-weekly/engagement-monthly rollup with one
        full-rebuild run, same shape as write_journey_rollup."""
        if self._conn is None:
            raise RuntimeError(f"analytics store {self.key} has no confirmed baseline")
        with self._lock:
            with self._conn:
                for table in (*ACTION_ROLLUP_TABLES, "action_rollup_meta"):
                    self._conn.execute(f"DELETE FROM {table}")
                self._conn.execute(
                    f"INSERT INTO action_rollup_meta ({', '.join(_ACTION_ROLLUP_META_COLUMNS)}) "
                    f"VALUES (?, ?, ?, ?, ?)",
                    tuple(meta[c] for c in _ACTION_ROLLUP_META_COLUMNS),
                )
                for table, cols in ACTION_ROLLUP_TABLES.items():
                    self._conn.executemany(
                        f"INSERT INTO {table} (run_id, {', '.join(cols)}) "
                        f"VALUES ({', '.join('?' for _ in range(len(cols) + 1))})",
                        [(meta["run_id"], *r) for r in rows[table]],
                    )
            self._dirty_gen += 1

    def snapshot(self) -> bytes | None:
        """This shard's current bytes (None before a confirmed baseline)."""
        with self._lock:
            return None if self._conn is None else self._conn.serialize()

    # -- reads -------------------------------------------------------------------

    def local_counts(self) -> dict[UsageKey, int]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT day, env, source, op_class, op, count FROM r2_ops_daily"
            ).fetchall()
        return {tuple(row[:5]): row[5] for row in rows}

    def local_visit_counts(self) -> dict[VisitKey, int]:
        """This shard's visit_daily rows (counter-like: callers SUM across shards,
        never "newest run" -- see the T7410 schema-step comment)."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT day, source, page_class, count FROM visit_daily"
            ).fetchall()
        return {tuple(row[:3]): row[3] for row in rows}


# -- visit totals (T14960) ---------------------------------------------------------

VISIT_TOTALS_CACHE_TTL_SECONDS = 300
_visit_totals_lock = threading.Lock()
_visit_totals_cache: tuple[float, dict[VisitKey, int], bool] | None = None


def _read_shard_visit_rows(body: bytes) -> list[tuple[str, str, str, int]]:
    conn = sqlite3.connect(":memory:")
    try:
        conn.deserialize(body)
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'visit_daily'"
        ).fetchone()
        if not has_table:
            return []
        return conn.execute(
            "SELECT day, source, page_class, SUM(count) FROM visit_daily GROUP BY day, source, page_class"
        ).fetchall()
    finally:
        conn.close()


def clear_visit_totals_cache() -> None:
    global _visit_totals_cache
    with _visit_totals_lock:
        _visit_totals_cache = None


def load_visit_totals() -> tuple[dict[VisitKey, int], bool]:
    """Every writer's visit_daily summed by (day, source, page_class), THIS process's env
    only (counter-like, T7410 -- never "newest run" like the journey rollup). This
    process's own shard is read from the live store (fresher than its last upload, same
    as newest_journey_rollup); every other shard is listed + GET from R2. Cached in-process
    for VISIT_TOTALS_CACHE_TTL_SECONDS; a partial read (a shard LIST/GET failed) is never
    cached, so the next read retries it. Returns (totals, partial)."""
    global _visit_totals_cache
    from ..storage import APP_ENV, R2_BUCKET, get_r2_sync_client

    with _visit_totals_lock:
        if _visit_totals_cache is not None and time.monotonic() - _visit_totals_cache[0] < VISIT_TOTALS_CACHE_TTL_SECONDS:
            return _visit_totals_cache[1], _visit_totals_cache[2]
        totals: dict[VisitKey, int] = {}
        store = current_store()
        own_key = store.key if store is not None else None
        if store is not None:
            for key, n in store.local_visit_counts().items():
                totals[key] = totals.get(key, 0) + n
        partial = False
        client = get_r2_sync_client()
        if client is not None:
            prefix = f"{APP_ENV}/analytics/shards/"
            try:
                listed = [
                    obj["Key"]
                    for page in client.get_paginator("list_objects_v2").paginate(Bucket=R2_BUCKET, Prefix=prefix)
                    for obj in page.get("Contents", [])
                    if obj["Key"].endswith("/analytics.sqlite") and obj["Key"] != own_key
                ]
            except Exception as e:
                logger.error(f"[ANALYTICS_STORE] visit totals LIST {prefix} failed: {e}")
                listed, partial = [], True
            for key in listed:
                try:
                    body = client.get_object(Bucket=R2_BUCKET, Key=key)["Body"].read()
                except Exception as e:
                    logger.error(f"[ANALYTICS_STORE] visit totals shard {key} unreadable: {e}")
                    partial = True
                    continue
                for day, source, page_class, count in _read_shard_visit_rows(body):
                    k = (day, source, page_class)
                    totals[k] = totals.get(k, 0) + count
        if not partial:
            _visit_totals_cache = (time.monotonic(), totals, partial)
        return totals, partial


def newest_journey_rollup(shards: list[sqlite3.Connection]) -> dict | None:
    """The run with the newest computed_at across shards, read from the shard holding
    it and only for that run_id: {"meta": {...}, table: [row, ...]}. None if no shard
    holds a run (fresh store, or shards from before schema step 2)."""
    newest: tuple[str, sqlite3.Connection, tuple] | None = None
    for conn in shards:
        has_meta = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rollup_meta'"
        ).fetchone()
        if not has_meta:
            continue
        row = conn.execute(
            f"SELECT {', '.join(_ROLLUP_META_COLUMNS)} FROM rollup_meta ORDER BY computed_at DESC LIMIT 1"
        ).fetchone()
        if row and (newest is None or row[1] > newest[0]):
            newest = (row[1], conn, row)
    if newest is None:
        return None
    _, conn, meta_row = newest
    result: dict = {"meta": dict(zip(_ROLLUP_META_COLUMNS, meta_row))}
    for table, cols in JOURNEY_ROLLUP_TABLES.items():
        result[table] = [
            tuple(r) for r in conn.execute(
                f"SELECT {', '.join(cols)} FROM {table} WHERE run_id = ? ORDER BY {', '.join(cols)}",
                (meta_row[0],),
            )
        ]
    return result


def newest_action_rollup(shards: list[sqlite3.Connection]) -> dict | None:
    """T7400: the run with the newest computed_at across shards (same selection rule as
    newest_journey_rollup -- full rebuild per run, never summed). None if no shard holds
    a run (fresh store, or shards from before schema step 4)."""
    newest: tuple[str, sqlite3.Connection, tuple] | None = None
    for conn in shards:
        has_meta = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'action_rollup_meta'"
        ).fetchone()
        if not has_meta:
            continue
        row = conn.execute(
            f"SELECT {', '.join(_ACTION_ROLLUP_META_COLUMNS)} FROM action_rollup_meta "
            f"ORDER BY computed_at DESC LIMIT 1"
        ).fetchone()
        if row and (newest is None or row[1] > newest[0]):
            newest = (row[1], conn, row)
    if newest is None:
        return None
    _, conn, meta_row = newest
    result: dict = {"meta": dict(zip(_ACTION_ROLLUP_META_COLUMNS, meta_row))}
    for table, cols in ACTION_ROLLUP_TABLES.items():
        result[table] = [
            tuple(r) for r in conn.execute(
                f"SELECT {', '.join(cols)} FROM {table} WHERE run_id = ? ORDER BY {', '.join(cols)}",
                (meta_row[0],),
            )
        ]
    return result


# -- process lifecycle --------------------------------------------------------------

_store: AnalyticsStore | None = None
_store_task: asyncio.Task | None = None


def current_store() -> AnalyticsStore | None:
    """This process's store (None before start_analytics_store_loop)."""
    return _store


async def _run_store_loop(store: AnalyticsStore):
    backoff = FLUSH_INTERVAL_SECONDS
    while not await asyncio.to_thread(store.confirm_baseline):
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, BASELINE_RETRY_MAX_SECONDS)
    last_upload = time.monotonic()
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
        await asyncio.to_thread(store.flush_local)
        if time.monotonic() - last_upload < UPLOAD_INTERVAL_SECONDS:
            continue
        last_upload = time.monotonic()
        result = await asyncio.to_thread(store.upload_if_dirty)
        if result == UploadResult.FROZEN:
            logger.critical(f"[ANALYTICS_STORE_CONFLICT] reminder: shard {store.key} is frozen, not uploading")


async def start_analytics_store_loop():
    """Start the flush/upload loop. Called at startup."""
    global _store, _store_task
    from ..storage import APP_ENV

    writer = writer_id()
    _store = AnalyticsStore(analytics_local_path(), shard_key(APP_ENV, writer), writer, APP_ENV)
    _store_task = asyncio.create_task(_run_store_loop(_store))
    logger.info(f"[ANALYTICS_STORE] loop started (shard {_store.key})")


async def stop_analytics_store_loop():
    """Cancel the loop and do the final flush. Called at (dev/lifespan) shutdown."""
    global _store_task
    if _store_task:
        _store_task.cancel()
        try:
            await _store_task
        except asyncio.CancelledError:
            pass
        _store_task = None
    await asyncio.to_thread(final_flush_blocking)


def final_flush_blocking(timeout_s: float = SHUTDOWN_FLUSH_TIMEOUT_SECONDS) -> None:
    """Shutdown flush for the SIGTERM path (main._graceful_shutdown). Idempotent."""
    if _store is not None:
        _store.final_flush(timeout_s)
