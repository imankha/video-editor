"""T15280: analytics_store's PRAGMA user_version schema ladder.

T13930/T14030 already built analytics_store.py (per-writer shards, R2 CAS upload,
_ensure_schema with additive schema steps) and test_t13930_analytics_store.py already
covers open/create + env-prefixed-key persistence + etag-conflict refusal (T15280:C1).
This file adds the one acceptance criterion that had no direct test anywhere:
a DB already stamped at an older PRAGMA user_version reaches the current version too,
not just a brand new file (T15280:C2).

T15390: fetch_other_shard_blobs -- the shared shard fetcher (LIST + cached/concurrent
GET) moved here from analytics_journey_rollup's load_newest_rollup so by-sport,
action-rollup and journey reads all share one cache and one bounded concurrent pool.

Run with: pytest tests/test_analytics_store.py -v
"""

import io
import sqlite3
import time

from app.services.analytics_store import (
    _SCHEMA_STEPS,
    _ensure_schema,
    _shard_blobs,
    clear_shard_blob_cache,
    fetch_other_shard_blobs,
)

CURRENT_VERSION = max(_SCHEMA_STEPS)


def test_fresh_file_reaches_current_version():
    conn = sqlite3.connect(":memory:")
    _ensure_schema(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == CURRENT_VERSION
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "r2_ops_daily" in tables
    assert "rollup_meta" in tables  # step 2 table present on a fresh file too


def test_version_1_file_reaches_current_version():
    # Simulate a shard written before step 2 shipped: only step-1 tables, user_version=1.
    conn = sqlite3.connect(":memory:")
    for statement in _SCHEMA_STEPS[1]:
        conn.execute(statement)
    conn.execute("PRAGMA user_version = 1")
    conn.commit()

    _ensure_schema(conn)

    assert conn.execute("PRAGMA user_version").fetchone()[0] == CURRENT_VERSION
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "rollup_meta" in tables, "step 2 must run on top of an existing version-1 file"
    # Pre-existing step-1 data survives the ladder (additive, never destructive).
    conn.execute("INSERT INTO store_meta (key, value) VALUES ('writer_id', 'pre-existing')")
    conn.commit()
    _ensure_schema(conn)  # idempotent: re-running on an already-current file is a no-op
    assert conn.execute("SELECT value FROM store_meta WHERE key = 'writer_id'").fetchone()[0] == "pre-existing"


# -- T15390: fetch_other_shard_blobs ----------------------------------------------

class _FakeBucket:
    """list_objects_v2 + get_object over {key: (etag, blob)}; records LIST/GET calls
    and can inject per-GET latency to exercise the concurrent pool."""

    def __init__(self, objs, latency_s=0.0, fail_list=False, fail_keys=()):
        self.objs, self.gets, self.lists = objs, [], 0
        self.latency_s, self.fail_list, self.fail_keys = latency_s, fail_list, set(fail_keys)

    def get_paginator(self, _name):
        bucket = self

        class _Pages:
            def paginate(self, Bucket, Prefix):
                bucket.lists += 1
                if bucket.fail_list:
                    raise RuntimeError("simulated LIST failure")
                return [{"Contents": [{"Key": k, "ETag": e} for k, (e, _) in bucket.objs.items()]}]
        return _Pages()

    def get_object(self, Bucket, Key):
        self.gets.append(Key)
        if Key in self.fail_keys:
            raise RuntimeError(f"simulated GET failure for {Key}")
        if self.latency_s:
            time.sleep(self.latency_s)
        return {"Body": io.BytesIO(self.objs[Key][1])}


def test_fetch_other_shard_blobs_second_read_lists_only_no_gets():
    clear_shard_blob_cache()
    objs = {"env/analytics/shards/w1/analytics.sqlite": ('"e1"', b"blob1"),
            "env/analytics/shards/w2/analytics.sqlite": ('"e2"', b"blob2")}
    bucket = _FakeBucket(objs)

    first_blobs, first_partial = fetch_other_shard_blobs(bucket, "env/analytics/shards/", None)
    assert sorted(first_blobs) == [b"blob1", b"blob2"] and not first_partial
    assert sorted(bucket.gets) == list(objs.keys())

    bucket.gets.clear()
    second_blobs, second_partial = fetch_other_shard_blobs(bucket, "env/analytics/shards/", None)
    assert sorted(second_blobs) == [b"blob1", b"blob2"] and not second_partial
    assert bucket.gets == []  # etags unchanged: no GET at all
    assert bucket.lists == 2


def test_fetch_other_shard_blobs_refetches_changed_etag_and_drops_delisted():
    clear_shard_blob_cache()
    k1, k2 = "env/analytics/shards/w1/analytics.sqlite", "env/analytics/shards/w2/analytics.sqlite"
    objs = {k1: ('"e1"', b"blob1"), k2: ('"e2"', b"blob2")}
    bucket = _FakeBucket(objs)
    fetch_other_shard_blobs(bucket, "env/analytics/shards/", None)
    assert k1 in _shard_blobs and k2 in _shard_blobs

    # w1 uploaded a new run (etag changed); w2 is retired (no longer listed).
    bucket.objs = {k1: ('"e1-new"', b"blob1-new")}
    bucket.gets.clear()
    blobs, partial = fetch_other_shard_blobs(bucket, "env/analytics/shards/", None)
    assert blobs == [b"blob1-new"] and not partial
    assert bucket.gets == [k1]  # only the changed shard re-downloaded
    assert k2 not in _shard_blobs  # delisted shard dropped from the cache


def test_fetch_other_shard_blobs_excludes_own_key():
    clear_shard_blob_cache()
    own, other = "env/analytics/shards/own/analytics.sqlite", "env/analytics/shards/other/analytics.sqlite"
    bucket = _FakeBucket({own: ('"e0"', b"own"), other: ('"e1"', b"other")})
    blobs, partial = fetch_other_shard_blobs(bucket, "env/analytics/shards/", own)
    assert blobs == [b"other"] and not partial
    assert own not in bucket.gets


def test_fetch_other_shard_blobs_failed_list_is_partial_and_keeps_cache():
    clear_shard_blob_cache()
    k1 = "env/analytics/shards/w1/analytics.sqlite"
    good_bucket = _FakeBucket({k1: ('"e1"', b"blob1")})
    fetch_other_shard_blobs(good_bucket, "env/analytics/shards/", None)
    assert k1 in _shard_blobs

    failing_bucket = _FakeBucket({}, fail_list=True)
    blobs, partial = fetch_other_shard_blobs(failing_bucket, "env/analytics/shards/", None)
    assert blobs == [] and partial
    assert k1 in _shard_blobs  # a failed LIST never prunes the cache


def test_fetch_other_shard_blobs_failed_get_is_partial_and_keeps_other_shard():
    clear_shard_blob_cache()
    k1, k2 = "env/analytics/shards/w1/analytics.sqlite", "env/analytics/shards/w2/analytics.sqlite"
    bucket = _FakeBucket({k1: ('"e1"', b"blob1"), k2: ('"e2"', b"blob2")}, fail_keys=(k2,))
    blobs, partial = fetch_other_shard_blobs(bucket, "env/analytics/shards/", None)
    assert blobs == [b"blob1"] and partial
    assert k1 in _shard_blobs and k2 not in _shard_blobs


def test_fetch_other_shard_blobs_fetches_cold_misses_concurrently():
    clear_shard_blob_cache()
    objs = {f"env/analytics/shards/w{i}/analytics.sqlite": (f'"e{i}"', f"blob{i}".encode())
            for i in range(25)}
    bucket = _FakeBucket(objs, latency_s=0.3)

    start = time.monotonic()
    blobs, partial = fetch_other_shard_blobs(bucket, "env/analytics/shards/", None)
    elapsed = time.monotonic() - start

    assert len(blobs) == 25 and not partial
    assert elapsed < 2.0, f"cold fetch of 25 shards at 300ms took {elapsed:.2f}s (expected concurrent < 2s)"
