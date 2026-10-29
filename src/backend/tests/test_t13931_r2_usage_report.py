"""T13931: GET /api/admin/r2-usage merges every writer's analytics shard.

Shards are real analytics.sqlite bytes (analytics_store's own schema) served by the
fake R2 transport behind a real boto3 client, so the LIST/GET/deserialize/merge path
runs exactly as in production.

Run with: pytest tests/test_t13931_r2_usage_report.py -v
"""

import sqlite3
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from r2_fake_transport import FakeR2Transport

from app.main import app
from app.services import r2_usage_report
from app.services.analytics_store import _ensure_schema, shard_key

ROUTE = "PUT /api/clips/raw/{clip_id}"


def _day(days_ago: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=days_ago)).isoformat()


def _shard_bytes(rows: list[tuple]) -> bytes:
    """rows: (day, env, source, op_class, op, count)"""
    conn = sqlite3.connect(":memory:")
    _ensure_schema(conn)
    conn.executemany("INSERT INTO r2_ops_daily VALUES (?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    return conn.serialize()


@pytest.fixture
def admin_users(pg_conn):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    create_user("regular-user", email="other@test.local")
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )


@pytest.fixture
def fake_r2():
    fake = FakeR2Transport()
    r2_usage_report.clear_cache()
    with fake.patched_storage_clients():
        yield fake
    r2_usage_report.clear_cache()


def _seed_three_shards(fake):
    today, old = _day(0), _day(31)
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        (today, "production", ROUTE, "A", "PutObject", 5),
        (today, "production", ROUTE, "B", "GetObject", 3),
        (old, "production", "sweep", "A", "ListObjectsV2", 1000),
    ]))
    fake.put_foreign(shard_key("production", "m2"), _shard_bytes([
        (today, "production", ROUTE, "A", "PutObject", 7),
        (today, "production", "untagged", "A", "PutObject", 2),
        (today, "production", "untagged", "free", "DeleteObject", 9),
    ]))
    fake.put_foreign(shard_key("staging", "s1"), _shard_bytes([
        (today, "staging", ROUTE, "A", "PutObject", 4),
    ]))


def _get(user: str):
    return TestClient(app).get("/api/admin/r2-usage", headers={"X-User-ID": user})


def test_admin_r2_usage_merges_shards_across_writers_and_envs(admin_users, fake_r2):
    _seed_three_shards(fake_r2)
    resp = _get("admin-user")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    daily = {(r["day"], r["env"], r["source"]): r for r in body["daily"]}
    today = _day(0)
    # Two prod writers summed per (day, env, source); staging stays its own row.
    assert daily[(today, "production", ROUTE)] == {
        "day": today, "env": "production", "source": ROUTE,
        "class_a": 12, "class_b": 3, "free": 0, "unclassified": 0,
    }
    assert daily[(today, "staging", ROUTE)]["class_a"] == 4
    assert daily[(today, "production", "untagged")]["free"] == 9
    # The 31-day-old row is outside the 30-day window.
    assert not any(r["day"] == _day(31) for r in body["daily"])

    assert [(r["env"], r["source"], r["class_a"]) for r in body["today_top"]] == [
        ("production", ROUTE, 12), ("staging", ROUTE, 4), ("production", "untagged", 2),
    ]
    cycle = body["cycle"]
    assert cycle["class_a"] == 18  # all envs: the bucket and free tier are shared
    assert cycle["class_b"] == 3
    assert cycle["free_tier_class_a"] == 1_000_000
    assert cycle["projected_class_a"] >= cycle["class_a"]
    assert "server and Modal boto3 calls" in body["coverage"]
    assert body["partial"] is False
    assert sorted((s["env"], s["writer"], s["schema"]) for s in body["shards"]) == [
        ("production", "m1", 1), ("production", "m2", 1), ("staging", "s1", 1),
    ]


def test_non_admin_gets_403(admin_users, fake_r2):
    _seed_three_shards(fake_r2)
    assert _get("regular-user").status_code == 403
    assert not any(op == "ListObjectsV2" for op in fake_r2.ops())


def test_unreadable_shard_marks_result_partial_never_silent(admin_users, fake_r2):
    _seed_three_shards(fake_r2)
    fake_r2.put_foreign(shard_key("production", "broken"), b"not a sqlite database")
    body = _get("admin-user").json()

    assert body["partial"] is True
    broken = [s for s in body["shards"] if s["writer"] == "broken"]
    assert broken and broken[0]["error"] == "unreadable"
    # The readable shards still merge.
    assert body["cycle"]["class_a"] == 18


def test_unchanged_shards_are_not_downloaded_again(admin_users, fake_r2):
    _seed_three_shards(fake_r2)
    _get("admin-user")
    r2_usage_report.clear_cache(keep_shards=True)  # TTL expired, per-shard ETag cache kept
    fake_r2.requests.clear()
    fake_r2.put_foreign(shard_key("staging", "s1"), _shard_bytes([
        (_day(0), "staging", ROUTE, "A", "PutObject", 6),
    ]))
    body = _get("admin-user").json()

    gets = [key for op, key in fake_r2.requests if op == "GetObject"]
    assert gets == [shard_key("staging", "s1")]
    assert body["cycle"]["class_a"] == 20


@pytest.mark.parametrize("today,start,end", [
    (date(2026, 10, 29), date(2026, 10, 18), date(2026, 11, 17)),
    (date(2026, 10, 18), date(2026, 10, 18), date(2026, 11, 17)),
    (date(2026, 10, 17), date(2026, 9, 18), date(2026, 10, 17)),
    (date(2026, 1, 5), date(2025, 12, 18), date(2026, 1, 17)),
])
def test_billing_cycle_anchored_on_day_18(today, start, end):
    assert r2_usage_report.billing_cycle(today) == (start, end)
