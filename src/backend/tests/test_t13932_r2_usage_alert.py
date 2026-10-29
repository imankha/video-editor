"""T13932: hourly production alert when an R2 source or the billing cycle crosses its
Class A threshold.

Real Postgres (pg_conn) for the advisory lock, real analytics.sqlite shards and the
real alert marker served by the fake R2 transport behind a real boto3 client. Two
sequential passes stand in for two machines: each starts with an empty merged-usage
cache, so the only thing shared between them is R2 (shards + marker) and Postgres.

Run with: pytest tests/test_t13932_r2_usage_alert.py -v
"""

import asyncio
import json
import logging
import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import psycopg2
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from r2_fake_transport import FakeR2Transport

from app.services import r2_usage_alert, r2_usage_report
from app.services.analytics_store import _ensure_schema, shard_key

MARKER_KEY = "production/analytics/r2_usage_alerts.json"
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)  # cycle Oct 18 - Nov 17, 7.5 days elapsed


def _shard_bytes(rows: list[tuple]) -> bytes:
    """rows: (day, env, source, op_class, op, count)"""
    conn = sqlite3.connect(":memory:")
    _ensure_schema(conn)
    conn.executemany("INSERT INTO r2_ops_daily VALUES (?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    return conn.serialize()


def _day(now: datetime, days_ago: int) -> str:
    return (now.date() - timedelta(days=days_ago)).isoformat()


@pytest.fixture
def alert_env(pg_conn, monkeypatch):
    """One admin recipient, fake R2, a fixed clock. Yields (fake, dsn)."""
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM admin_users")
        cur.execute("INSERT INTO admin_users (email) VALUES ('test-admin@test.local')")
    monkeypatch.setattr(r2_usage_alert, "_utcnow", lambda: NOW)
    fake = FakeR2Transport()
    r2_usage_report.clear_cache()
    with fake.patched_storage_clients():
        yield fake, pg_conn
    r2_usage_report.clear_cache()


def _run_pass(send_mock):
    """One machine's pass: a fresh process cache, the email send spied on."""
    r2_usage_report.clear_cache()
    with patch.object(r2_usage_alert, "send_admin_update_email", send_mock):
        return asyncio.run(r2_usage_alert.run_r2_usage_alert_pass())


def _alert_criticals(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records
            if r.levelno == logging.CRITICAL and "R2 USAGE ALERT" in r.getMessage()]


def _marker(fake) -> dict:
    return json.loads(fake.objects[MARKER_KEY]["body"])["sent"]


def test_source_over_threshold_alerts_once_across_two_passes(alert_env, caplog):
    fake, _ = alert_env
    today = _day(NOW, 0)
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        (today, "production", "sweep", "A", "ListObjectsV2", 15_000),
    ]))
    fake.put_foreign(shard_key("production", "m2"), _shard_bytes([
        (today, "production", "sweep", "A", "ListObjectsV2", 5_000),  # 20,000 merged
        (today, "production", "GET /api/games", "A", "ListObjectsV2", 300),
    ]))

    send1 = AsyncMock(return_value=True)
    with caplog.at_level(logging.CRITICAL, logger="app.services.r2_usage_alert"):
        first = _run_pass(send1)
    assert first["status"] == "alerted"
    assert first["keys"] == [f"{today}|source_daily|production|sweep"]
    assert send1.await_count == 1
    assert send1.await_args.args[0] == "test-admin@test.local"
    assert len(_alert_criticals(caplog)) == 1
    assert "production|sweep" in _alert_criticals(caplog)[0]
    assert set(_marker(fake)) == {f"{today}|source_daily|production|sweep"}

    # Machine 2, an hour later: same data, marker already holds the key.
    caplog.clear()
    send2 = AsyncMock(return_value=True)
    with caplog.at_level(logging.CRITICAL, logger="app.services.r2_usage_alert"):
        second = _run_pass(send2)
    assert second["status"] == "skipped_already_sent"
    assert send2.await_count == 0
    assert _alert_criticals(caplog) == []


def test_concurrent_pass_skips_when_lock_held(alert_env, caplog):
    fake, dsn = alert_env
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        (_day(NOW, 0), "production", "sweep", "A", "ListObjectsV2", 50_000),
    ]))
    holder = psycopg2.connect(dsn)
    try:
        hc = holder.cursor()
        hc.execute("SELECT pg_try_advisory_lock(%s)", (r2_usage_alert.R2_USAGE_ALERT_LOCK_ID,))
        assert hc.fetchone()[0] is True
        holder.commit()

        send = AsyncMock(return_value=True)
        with caplog.at_level(logging.CRITICAL, logger="app.services.r2_usage_alert"):
            result = _run_pass(send)
        assert result["status"] == "skipped_locked"
        assert send.await_count == 0
        assert _alert_criticals(caplog) == []
        assert MARKER_KEY not in fake.objects
        assert "ListObjectsV2" not in fake.ops()  # the usage is not even read
    finally:
        hc.execute("SELECT pg_advisory_unlock(%s)", (r2_usage_alert.R2_USAGE_ALERT_LOCK_ID,))
        holder.commit()
        holder.close()

    # Lock free again: the pass runs and releases it explicitly.
    assert _run_pass(AsyncMock(return_value=True))["status"] == "alerted"
    probe = psycopg2.connect(dsn)
    try:
        pc = probe.cursor()
        pc.execute("SELECT pg_try_advisory_lock(%s)", (r2_usage_alert.R2_USAGE_ALERT_LOCK_ID,))
        assert pc.fetchone()[0] is True
        pc.execute("SELECT pg_advisory_unlock(%s)", (r2_usage_alert.R2_USAGE_ALERT_LOCK_ID,))
    finally:
        probe.close()


def test_next_day_realerts_sustained_source(alert_env):
    fake, _ = alert_env
    yesterday, today = _day(NOW, 1), _day(NOW, 0)
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        (yesterday, "production", "sweep", "A", "ListObjectsV2", 25_000),
    ]))
    first = _run_pass(AsyncMock(return_value=True))
    assert first["status"] == "alerted"
    assert first["keys"] == [f"{yesterday}|source_daily|production|sweep"]

    # The source keeps going the next UTC day.
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        (yesterday, "production", "sweep", "A", "ListObjectsV2", 25_000),
        (today, "production", "sweep", "A", "ListObjectsV2", 21_000),
    ]))
    send = AsyncMock(return_value=True)
    second = _run_pass(send)
    assert second["status"] == "alerted"
    assert second["keys"] == [f"{today}|source_daily|production|sweep"]
    assert send.await_count == 1
    assert set(_marker(fake)) == {
        f"{yesterday}|source_daily|production|sweep",
        f"{today}|source_daily|production|sweep",
    }


def test_below_threshold_silent(alert_env, caplog):
    fake, _ = alert_env
    today = _day(NOW, 0)
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        (today, "production", "sweep", "A", "ListObjectsV2", 19_999),
        (today, "staging", "sweep", "A", "ListObjectsV2", 19_999),  # per (env, source)
        (today, "production", "GET /api/games", "B", "GetObject", 500_000),  # Class B never counts
    ]))
    send = AsyncMock(return_value=True)
    with caplog.at_level(logging.CRITICAL, logger="app.services.r2_usage_alert"):
        result = _run_pass(send)
    assert result["status"] == "silent"
    assert send.await_count == 0
    assert _alert_criticals(caplog) == []
    # Nothing crossed: the marker is never read or written.
    assert not any(key == MARKER_KEY for _, key in fake.requests)


def test_cycle_projection_alerts_once_per_cycle(alert_env, monkeypatch):
    fake, _ = alert_env
    # 300k Class A spread over the cycle's first days, each source-day under 20k, so only
    # the cycle rule can fire: 300k < 50% of 1M, but 300k / 7.5 days * 31 days = 1.24M.
    rows = [
        (f"2026-10-{d}", env, f"GET /api/r{i}", "A", "PutObject", 15_000)
        for d in (18, 19, 20, 21, 22) for env in ("production", "staging") for i in (1, 2, 3)
    ]
    assert sum(r[5] for r in rows) == 450_000
    rows = rows[:20]  # 300,000
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes(rows))

    send = AsyncMock(return_value=True)
    first = _run_pass(send)
    assert first["status"] == "alerted"
    assert first["keys"] == ["2026-10-18|cycle_projection"]
    assert send.await_count == 1

    # Three hours later, still projecting over: no second cycle alert.
    monkeypatch.setattr(r2_usage_alert, "_utcnow", lambda: NOW + timedelta(hours=3))
    assert _run_pass(AsyncMock(return_value=True))["status"] == "skipped_already_sent"


def test_cycle_projection_needs_two_elapsed_days(alert_env, monkeypatch):
    fake, _ = alert_env
    # 1.25 days in, 100k projects to 2.5M, but a projection that early is noise.
    monkeypatch.setattr(r2_usage_alert, "_utcnow", lambda: datetime(2026, 10, 19, 6, 0, tzinfo=UTC))
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        ("2026-10-18", env, f"GET /api/r{i}", "A", "PutObject", 12_500)
        for env in ("production", "staging") for i in range(4)
    ]))
    assert _run_pass(AsyncMock(return_value=True))["status"] == "silent"


def test_cycle_half_of_free_tier_alerts(alert_env):
    fake, _ = alert_env
    fake.put_foreign(shard_key("production", "m1"), _shard_bytes([
        (f"2026-10-{d}", "production", f"GET /api/r{i}", "A", "PutObject", 19_000)
        for d in (18, 19, 20, 21, 22) for i in range(6)  # 570k: >= 50%, projects 2.36M
    ]))
    result = _run_pass(AsyncMock(return_value=True))
    assert result["status"] == "alerted"
    assert result["keys"] == ["2026-10-18|cycle_half", "2026-10-18|cycle_projection"]


def test_loop_starts_only_in_production(monkeypatch):
    from app import storage
    monkeypatch.setattr(storage, "APP_ENV", "staging")
    asyncio.run(r2_usage_alert.start_r2_usage_alert_loop())
    assert r2_usage_alert._alert_task is None
