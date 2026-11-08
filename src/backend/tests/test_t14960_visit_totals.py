"""T14960: load_visit_totals -- sum this env's visit_daily across every writer's shard.

Counter-like (T7410): own shard read live from the confirmed store (fresher than its last
upload, same rule as newest_journey_rollup); every other shard listed + GET from R2 and
summed. Real boto3 client + real hooks; only the HTTP send is faked (r2_fake_transport).

Run with: pytest tests/test_t14960_visit_totals.py -v
"""

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from r2_fake_transport import FakeR2Transport

from app import r2_usage, storage
from app.services import analytics_store as store_mod
from app.services.analytics_store import AnalyticsStore

OWN_KEY = f"{storage.APP_ENV}/analytics/shards/t14960-own/analytics.sqlite"
OTHER_KEY = f"{storage.APP_ENV}/analytics/shards/t14960-other/analytics.sqlite"


@pytest.fixture
def fake_r2():
    fake = FakeR2Transport()
    r2_usage.usage_buffer().drain()
    with fake.patched_storage_clients():
        yield fake


@pytest.fixture
def own_store(tmp_path):
    s = AnalyticsStore(
        local_path=tmp_path / "analytics_data" / "analytics.sqlite",
        key=OWN_KEY, writer_id="t14960-own", env=storage.APP_ENV,
    )
    store_mod._store = s
    store_mod.clear_visit_totals_cache()
    yield s
    store_mod._store = None
    store_mod.clear_visit_totals_cache()


def _other_shard_bytes(rows: list[tuple]) -> bytes:
    conn = sqlite3.connect(":memory:")
    from app.services.analytics_store import _ensure_schema
    _ensure_schema(conn)
    conn.executemany(
        "INSERT INTO visit_daily (day, source, page_class, count) VALUES (?, ?, ?, ?)", rows)
    conn.commit()
    return conn.serialize()


def test_sums_own_live_store_and_a_foreign_shard(fake_r2, own_store):
    assert own_store.confirm_baseline() is True
    own_store.record_visit("direct", "landing")
    own_store.record_visit("direct", "landing")
    own_store.flush_local()

    fake_r2.put_foreign(OTHER_KEY, _other_shard_bytes([
        ("2026-11-08", "direct", "landing", 5),
        ("2026-11-08", "seo", "app", 3),
    ]))

    totals, partial = store_mod.load_visit_totals()
    assert partial is False
    # Own count (2, from record_visit) plus the foreign shard's 5 -- only when they land
    # on the same day (record_visit stamps "today", the foreign shard a fixed test date).
    own_day = next(iter(own_store.local_visit_counts()))[0]
    assert totals[(own_day, "direct", "landing")] == 2 + (5 if own_day == "2026-11-08" else 0)
    assert totals.get(("2026-11-08", "seo", "app"), 0) == 3


def test_never_double_counts_the_own_shard_from_r2(fake_r2, own_store):
    assert own_store.confirm_baseline() is True
    own_store.record_visit("direct", "landing")
    own_store.flush_local()
    assert own_store.upload_if_dirty() == store_mod.UploadResult.UPLOADED
    # own_store's uploaded object now also sits at OWN_KEY in fake_r2 -- a naive "list every
    # shard under the prefix" reader would double count it.
    totals, _partial = store_mod.load_visit_totals()
    own_day = next(iter(own_store.local_visit_counts()))[0]
    assert totals[(own_day, "direct", "landing")] == 1


def test_cache_is_reused_within_the_ttl(fake_r2, own_store):
    assert own_store.confirm_baseline() is True
    totals1, _ = store_mod.load_visit_totals()
    fake_r2.put_foreign(OTHER_KEY, _other_shard_bytes([("2026-11-08", "direct", "landing", 9)]))
    totals2, _ = store_mod.load_visit_totals()
    assert totals1 == totals2  # cached: the new foreign shard is not seen yet
    store_mod.clear_visit_totals_cache()
    totals3, _ = store_mod.load_visit_totals()
    assert totals3.get(("2026-11-08", "direct", "landing")) == 9


def test_unreadable_shard_marks_partial_and_is_not_cached(fake_r2, own_store):
    assert own_store.confirm_baseline() is True
    fake_r2.put_foreign(OTHER_KEY, _other_shard_bytes([("2026-11-08", "direct", "landing", 9)]))
    fake_r2.fail_ops["GetObject"] = 500
    _totals, partial = store_mod.load_visit_totals()
    assert partial is True
    del fake_r2.fail_ops["GetObject"]
    totals2, partial2 = store_mod.load_visit_totals()  # not cached: this read retries
    assert partial2 is False
    assert totals2.get(("2026-11-08", "direct", "landing")) == 9
