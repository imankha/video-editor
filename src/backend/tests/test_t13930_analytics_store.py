"""T13930: analytics.sqlite per-writer shard store.

- the upload is CAS (HEAD-etag compare, then PUT): a conflict refuses, logs CRITICAL,
  freezes the shard, and never overwrites the foreign copy;
- the store's own R2 ops are counted under `analytics_store` but never make the shard
  dirty on their own (an idle machine stops uploading: bounded self-cost);
- the shutdown flush never hangs on a lock the interrupted thread may hold.

Real boto3 client + real hooks; only the HTTP send is faked (tests/r2_fake_transport.py).

Run with: pytest tests/test_t13930_analytics_store.py -v
"""

import logging
import sqlite3
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from r2_fake_transport import FakeR2Transport

from app import r2_usage, storage
from app.services.analytics_store import AnalyticsStore, StoreState, UploadResult

KEY = f"{storage.APP_ENV}/analytics/shards/t13930-w1/analytics.sqlite"
ROUTE = "PUT /api/clips/raw/{clip_id}"


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def _shard_rows(body: bytes) -> dict[tuple, int]:
    conn = sqlite3.connect(":memory:")
    conn.deserialize(body)
    rows = conn.execute("SELECT day, env, source, op_class, op, count FROM r2_ops_daily").fetchall()
    return {tuple(r[:5]): r[5] for r in rows}


@pytest.fixture
def fake_r2():
    fake = FakeR2Transport()
    r2_usage.usage_buffer().drain()  # start every test from an empty global buffer
    with fake.patched_storage_clients():
        yield fake


@pytest.fixture
def store(tmp_path):
    return AnalyticsStore(
        local_path=tmp_path / "analytics_data" / "analytics.sqlite",
        key=KEY,
        writer_id="t13930-w1",
        env=storage.APP_ENV,
    )


def _app_activity(n: int = 1):
    for _ in range(n):
        r2_usage.record_r2_call("PutObject", ROUTE, storage.APP_ENV)


def test_first_upload_creates_shard_and_round_trips_counts(fake_r2, store, tmp_path):
    assert store.confirm_baseline() is True
    assert store.state == StoreState.CONFIRMED
    _app_activity(3)
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.UPLOADED

    rows = _shard_rows(fake_r2.objects[KEY]["body"])
    assert rows[(_today(), storage.APP_ENV, ROUTE, "A", "PutObject")] == 3
    assert fake_r2.objects[KEY]["metadata"]["analytics-writer"].startswith("t13930-w1")

    # A restarted process re-adopts its R2 shard and keeps counting on top of it.
    restarted = AnalyticsStore(
        local_path=tmp_path / "restart" / "analytics.sqlite", key=KEY,
        writer_id="t13930-w1", env=storage.APP_ENV,
    )
    assert restarted.confirm_baseline() is True
    _app_activity(2)
    restarted.flush_local()
    assert restarted.local_counts()[(_today(), storage.APP_ENV, ROUTE, "A", "PutObject")] == 5
    assert restarted.upload_if_dirty() == UploadResult.UPLOADED


def test_upload_refuses_on_etag_conflict_and_logs_critical(fake_r2, store, caplog):
    assert store.confirm_baseline() is True
    _app_activity()
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.UPLOADED

    # Some other writer moves the shard behind our back.
    fake_r2.put_foreign(KEY, b"foreign-bytes", {"analytics-writer": "intruder/42"})
    _app_activity()
    store.flush_local()
    puts_before = fake_r2.ops().count("PutObject")

    with caplog.at_level(logging.CRITICAL, logger="app.services.analytics_store"):
        assert store.upload_if_dirty() == UploadResult.CONFLICT

    assert fake_r2.ops().count("PutObject") == puts_before, "a conflicting upload must never PUT"
    assert fake_r2.objects[KEY]["body"] == b"foreign-bytes"
    critical = [r for r in caplog.records if r.levelno == logging.CRITICAL]
    assert any("[ANALYTICS_STORE_CONFLICT]" in r.getMessage() and "intruder/42" in r.getMessage()
               for r in critical), [r.getMessage() for r in critical]
    assert store.state == StoreState.FROZEN

    # Frozen: no merge, no blind retry -- zero R2 requests -- but local counts are kept.
    requests_before = len(fake_r2.requests)
    _app_activity()
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.FROZEN
    assert len(fake_r2.requests) == requests_before
    assert store.local_counts()[(_today(), storage.APP_ENV, ROUTE, "A", "PutObject")] == 3


def test_unconfirmed_baseline_refuses_existing_object(fake_r2, store):
    # Startup GET errors: the baseline is unknown, so nothing is written or uploaded.
    fake_r2.put_foreign(KEY, b"existing", {"analytics-writer": "earlier/1"})
    fake_r2.fail_ops = {"GetObject": 500}
    assert store.confirm_baseline() is False
    assert store.state == StoreState.UNCONFIRMED
    _app_activity()
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.NOT_CONFIRMED
    assert "PutObject" not in fake_r2.ops()
    # The counts were not dropped: they wait in memory for a confirmed baseline.
    assert r2_usage.usage_buffer().peek()[(_today(), storage.APP_ENV, ROUTE, "A", "PutObject")] == 1


def test_fresh_baseline_refuses_object_created_after_confirm(fake_r2, store):
    assert store.confirm_baseline() is True  # 404: fresh shard, expected etag None
    fake_r2.put_foreign(KEY, b"appeared", {"analytics-writer": "other/7"})
    _app_activity()
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.CONFLICT
    assert fake_r2.objects[KEY]["body"] == b"appeared"


def test_idle_store_does_not_reupload_its_own_ops(fake_r2, store):
    assert store.confirm_baseline() is True
    _app_activity()
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.UPLOADED

    # Only the store's own HEAD+PUT are in the buffer now.
    store.flush_local()
    requests_before = len(fake_r2.requests)
    assert store.upload_if_dirty() == UploadResult.CLEAN
    assert len(fake_r2.requests) == requests_before


def test_store_ops_visible_under_analytics_store(fake_r2, store):
    assert store.confirm_baseline() is True
    _app_activity()
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.UPLOADED
    _app_activity()  # genuine activity makes the next upload carry the first upload's self-ops
    store.flush_local()
    assert store.upload_if_dirty() == UploadResult.UPLOADED

    rows = _shard_rows(fake_r2.objects[KEY]["body"])
    day, env = _today(), storage.APP_ENV
    assert rows[(day, env, "analytics_store", "A", "PutObject")] >= 1
    assert rows[(day, env, "analytics_store", "B", "HeadObject")] >= 1
    assert rows[(day, env, "analytics_store", "B", "GetObject")] == 1  # the baseline GET


def test_shutdown_flush_times_out_on_held_lock(fake_r2, store, caplog):
    """The SIGTERM handler can interrupt a thread holding the store lock; the final
    flush must give up loudly instead of deadlocking the shutdown."""
    assert store.confirm_baseline() is True
    _app_activity()
    store._lock.acquire()
    try:
        with caplog.at_level(logging.ERROR, logger="app.services.analytics_store"):
            worker = threading.Thread(target=store.final_flush, kwargs={"timeout_s": 0.1})
            worker.start()
            worker.join(timeout=3)
        assert not worker.is_alive(), "final_flush hung on a held lock"
    finally:
        store._lock.release()
    assert any(r.levelno == logging.ERROR and "final flush" in r.getMessage() for r in caplog.records)
