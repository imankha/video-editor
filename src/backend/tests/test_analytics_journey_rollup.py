"""T14030: exit-screen / dwell / retry-burst / transition rollup into analytics.sqlite.

- per-user aggregation attributes each signal to the user's furthest ladder stage AT
  THE TIME of the row (from the same per-user log), counts users not events (except
  transitions, which also carry the repeat count);
- the reader takes the newest run across writer shards and never sums shards;
- a shard holds one run per rebuild; a stray older run never leaks into the read;
- the sweep walks users in-process through the user.sqlite JIT seam: below-head DBs are
  skipped and counted, never read raw; unreadable ones are counted as failed;
- every rollup table is counts keyed by stage: no user or event column.

Run with: pytest tests/test_analytics_journey_rollup.py -v
"""
import json
import sqlite3
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from app import storage
from app.analytics import JOURNEY_LADDER
from app.services.analytics_store import AnalyticsStore, _ensure_schema


def newest_journey_rollup(conns):
    from app.services.analytics_store import newest_journey_rollup as read
    return read(conns)


def _row(action, at, context=None):
    return {"action": action, "context": json.dumps(context) if context else None, "created_at": at}


def _exit(at, last, dwell):
    return _row("session_exit", at, {"last_screen": last, "dwell": dwell, "trail": [last]})


def _agg(rows, cohort="2026-10"):
    from app.services.analytics_journey_rollup import aggregate_user
    return aggregate_user(rows, JOURNEY_LADDER, cohort)


# -- pure per-user aggregation -----------------------------------------------------------

def test_exit_and_dwell_attributed_to_furthest_stage_at_exit_time():
    agg = _agg([
        _row("session_started", "2026-10-01T10:00:00.000000Z"),
        _exit("2026-10-01T10:05:00.000000Z", "project-manager", {"project-manager": 40}),
        _row("add_game_opened", "2026-10-02T10:00:00.000000Z"),
        _exit("2026-10-02T10:10:00.000000Z", "annotate", {"annotate": 400, "project-manager": 5}),
        _exit("2026-10-03T10:10:00.000000Z", "project-manager", {"project-manager": 20}),
    ])
    # The latest exit while at a stage is that user's last screen for the stage.
    assert agg["exit_screen"] == {("started", "project-manager"), ("add_footage", "project-manager")}
    # Dwell is summed per (stage, screen) across the stage's exits, then bucketed.
    assert agg["stage_dwell"] == {
        ("started", "project-manager", "s10_60"),
        ("add_footage", "annotate", "m5_30"),
        ("add_footage", "project-manager", "s10_60"),
    }


def test_retry_burst_attributed_to_stage_at_burst_start():
    agg = _agg([
        _row("session_started", "2026-10-01T10:00:00Z"),
        _row("add_game_opened", "2026-10-01T10:01:00Z"),
        *[_row("game_created", f"2026-10-01T10:02:0{i}Z") for i in range(3)],
        _row("clip_created", "2026-10-01T11:00:00Z"),
        *[_row("clip_save_attempted", f"2026-10-01T11:0{i}:00Z") for i in range(3)],  # 3 min apart: no burst
    ])
    assert agg["retry_burst"] == {("add_footage", "game_created")}


def test_transitions_follow_full_event_order_with_repeats():
    agg = _agg([
        _row("session_started", "2026-10-01T10:00:00Z"),
        _row("clip_created", "2026-10-01T10:01:00Z"),
        _row("export_completed", "2026-10-01T10:02:00Z"),
        _row("session_started", "2026-10-02T10:00:00Z"),
        _row("export_completed", "2026-10-02T10:02:00Z"),
        _row("session_started", "2026-10-03T10:00:00Z"),
        _row("session_started", "2026-10-03T12:00:00Z"),  # same stage again: no transition
        _row("export_completed", "2026-10-03T12:02:00Z"),
    ], cohort="2026-09")
    assert agg["transition"] == {
        ("signed_up", "started", "2026-09"): 1,
        ("started", "clipped", "2026-09"): 1,
        ("clipped", "exported", "2026-09"): 1,
        ("exported", "started", "2026-09"): 2,
        ("started", "exported", "2026-09"): 2,
    }


def test_unknown_screens_and_unreadable_context_are_ignored():
    agg = _agg([
        _row("session_exit", "2026-10-01T10:00:00Z", {"last_screen": None, "dwell": {}, "trail": []}),
        {"action": "session_exit", "context": "{not json", "created_at": "2026-10-01T10:01:00Z"},
    ])
    assert agg["exit_screen"] == set()
    assert agg["stage_dwell"] == set()


def test_fold_counts_users_and_sums_transition_repeats():
    from app.services.analytics_journey_rollup import fold_rollups
    one = _agg([_row("session_started", "2026-10-01T10:00:00Z"),
                _exit("2026-10-01T10:01:00Z", "annotate", {"annotate": 5})])
    two = _agg([_row("session_started", "2026-10-01T10:00:00Z"),
                _exit("2026-10-01T10:01:00Z", "annotate", {"annotate": 7}),
                _exit("2026-10-02T10:01:00Z", "annotate", {"annotate": 2})])
    rows = fold_rollups([one, two])
    assert rows["rollup_exit_screen"] == [("started", "annotate", 2)]
    assert rows["rollup_stage_dwell"] == [("started", "annotate", "lt_10s", 2)]
    assert rows["rollup_transition"] == [("signed_up", "started", "2026-10", 2, 2)]


# -- store: schema step 2 + newest-run reader -----------------------------------------------

def _meta(run_id, computed_at, walked=1):
    return {"run_id": run_id, "computed_at": computed_at, "users_walked": walked,
            "users_failed": 0, "below_head_skipped": 0}


def _shard(tmp_path, name, run_id, computed_at, exit_users):
    store = AnalyticsStore(tmp_path / name / "analytics.sqlite", f"dev/analytics/shards/{name}/analytics.sqlite",
                           name, "dev")
    with patch("app.storage.get_r2_sync_client", return_value=None):
        assert store.confirm_baseline()
    store.write_journey_rollup(_meta(run_id, computed_at), {
        "rollup_exit_screen": [("started", "annotate", exit_users)],
        "rollup_stage_dwell": [], "rollup_retry_burst": [], "rollup_transition": [],
    })
    return store


def _conn(store):
    conn = sqlite3.connect(":memory:")
    conn.deserialize(store.snapshot())
    return conn


def test_two_shards_reader_returns_only_the_newest_run(tmp_path):
    old = _shard(tmp_path, "w1", "run-old", "2026-10-30T10:00:00+00:00", exit_users=5)
    new = _shard(tmp_path, "w2", "run-new", "2026-10-31T10:00:00+00:00", exit_users=7)
    for order in ([old, new], [new, old]):
        got = newest_journey_rollup([_conn(s) for s in order])
        assert got["meta"]["run_id"] == "run-new"
        assert got["rollup_exit_screen"] == [("started", "annotate", 7)]  # not 12


def test_rebuild_replaces_the_shards_previous_run(tmp_path):
    store = _shard(tmp_path, "w1", "run-1", "2026-10-30T10:00:00+00:00", exit_users=5)
    store.write_journey_rollup(_meta("run-2", "2026-10-31T10:00:00+00:00"), {
        "rollup_exit_screen": [("started", "framing", 3)],
        "rollup_stage_dwell": [], "rollup_retry_burst": [], "rollup_transition": [],
    })
    conn = _conn(store)
    assert conn.execute("SELECT DISTINCT run_id FROM rollup_exit_screen").fetchall() == [("run-2",)]
    assert conn.execute("SELECT run_id FROM rollup_meta").fetchall() == [("run-2",)]


def test_reader_isolates_runs_within_one_shard():
    conn = sqlite3.connect(":memory:")
    _ensure_schema(conn)
    conn.executemany("INSERT INTO rollup_meta VALUES (?, ?, 1, 0, 0)",
                     [("a", "2026-10-30T00:00:00+00:00"), ("b", "2026-10-31T00:00:00+00:00")])
    conn.executemany("INSERT INTO rollup_exit_screen VALUES (?, 'started', 'annotate', ?)", [("a", 4), ("b", 1)])
    got = newest_journey_rollup([conn])
    assert got["meta"]["run_id"] == "b"
    assert got["rollup_exit_screen"] == [("started", "annotate", 1)]


def test_no_rollup_yet_and_pre_step_2_shard_read_as_none():
    old_shard = sqlite3.connect(":memory:")
    old_shard.execute("CREATE TABLE r2_ops_daily (day TEXT)")
    assert newest_journey_rollup([]) is None
    assert newest_journey_rollup([old_shard]) is None


def test_rollup_tables_hold_no_user_or_event_columns():
    from app.services.analytics_store import JOURNEY_ROLLUP_TABLES
    conn = sqlite3.connect(":memory:")
    _ensure_schema(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
    for table in (*JOURNEY_ROLLUP_TABLES, "rollup_meta"):
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        assert cols, table
        assert not cols & {"user_id", "email", "created_at", "context", "action_id"}, table
    for table in JOURNEY_ROLLUP_TABLES:
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
        assert cols[0] == "run_id" and "users" in cols, table


# -- sweep through the JIT seam -----------------------------------------------------------

@pytest.fixture()
def user_dbs(tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch.object(storage, "R2_ENABLED", False):
        yield tmp_path


def _log(user_id, rows):
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(user_id) as conn:
        for r in rows:
            conn.execute("INSERT INTO user_action_log (action, context, created_at) VALUES (?, ?, ?)",
                         (r["action"], r["context"], r["created_at"]))
        conn.commit()


def _users(*ids):
    return [{"user_id": u, "created_at": datetime(2026, 10, 1, tzinfo=UTC)} for u in ids]


def test_sweep_walks_users_counts_below_head_and_failed(user_dbs, tmp_path):
    from app.migrations import MigrateResult, MigrationBlocked
    from app.services import analytics_journey_rollup as rollup

    for uid in ("u-ok1", "u-ok2", "u-blocked", "u-behind", "u-broken"):
        _log(uid, [_row("session_started", "2026-10-01T10:00:00Z"),
                   _exit("2026-10-01T10:01:00Z", "annotate", {"annotate": 30})])
    store = AnalyticsStore(tmp_path / "an" / "analytics.sqlite", "dev/analytics/shards/w/analytics.sqlite", "w", "dev")
    with patch("app.storage.get_r2_sync_client", return_value=None):
        store.confirm_baseline()

    from app.services import user_db
    real_ensure = user_db.ensure_user_database
    real_migrate = __import__("app.migrations", fromlist=["x"]).migrate_local_user_db_at_seam

    def ensure(uid):
        if uid == "u-blocked":
            raise MigrationBlocked(uid, None, "lock_timeout")
        if uid == "u-broken":
            raise OSError("disk gone")
        return real_ensure(uid)

    def migrate(uid):
        return MigrateResult(status="not_at_head") if uid == "u-behind" else real_migrate(uid)

    with patch("app.services.user_db.ensure_user_database", side_effect=ensure), \
         patch("app.migrations.migrate_local_user_db_at_seam", side_effect=migrate), \
         patch("app.storage.get_r2_sync_client", return_value=None):
        summary = rollup.sweep(_users("u-ok1", "u-blocked", "u-behind", "u-broken", "u-ok2"), store)

    assert summary["users_walked"] == 2
    assert summary["below_head_skipped"] == 2
    assert summary["users_failed"] == 1
    assert summary["run_id"]
    got = newest_journey_rollup([_conn(store)])
    assert got["meta"]["run_id"] == summary["run_id"]
    assert got["meta"]["below_head_skipped"] == 2
    assert got["rollup_exit_screen"] == [("started", "annotate", 2)]


def test_sweep_refuses_an_unconfirmed_store(user_dbs, tmp_path):
    from app.services import analytics_journey_rollup as rollup
    store = AnalyticsStore(tmp_path / "an" / "analytics.sqlite", "k", "w", "dev")
    with pytest.raises(rollup.RollupStoreUnavailable):
        rollup.sweep(_users("u1"), store)


# -- the inspector's "Where they left" section ---------------------------------------------

def test_journey_left_for_a_stage():
    from app.services.analytics_journey_rollup import journey_left
    rollup = {
        "meta": _meta("r", "2026-10-31T10:00:00+00:00", walked=40),
        "rollup_exit_screen": [("started", "project-manager", 14), ("started", "annotate", 6),
                               ("clipped", "framing", 9)],
        "rollup_stage_dwell": [("started", "annotate", "m1_5", 4), ("started", "annotate", "lt_10s", 2)],
        "rollup_retry_burst": [("started", "game_created", 3)],
        "rollup_transition": [("started", "clipped", "2026-09", 5, 6), ("started", "clipped", "2026-10", 2, 2),
                              ("clipped", "started", "2026-10", 1, 1)],
    }
    left = journey_left(rollup, "started")
    assert left["computed_at"] == "2026-10-31T10:00:00+00:00"
    assert left["users_walked"] == 40
    assert left["exit_users"] == 20
    assert left["exit_screens"][0] == {"screen": "project-manager", "users": 14,
                                       "share": {"pct": 70.0, "k": 14, "n": 20}}
    assert left["dwell"] == [{"screen": "annotate", "users": 6,
                              "buckets": {"lt_10s": 2, "s10_60": 0, "m1_5": 4, "m5_30": 0, "gt_30m": 0}}]
    assert left["retry_bursts"] == [{"action": "game_created", "users": 3}]
    assert left["transitions_out"] == [{"to_stage": "clipped", "users": 7, "transitions": 8}]
    assert journey_left(None, "started") == {"computed_at": None}


# -- HTTP: admin trigger + step endpoint `left` ---------------------------------------------

@pytest.fixture()
def rollup_client(pg_conn, user_dbs, tmp_path):
    from fastapi.testclient import TestClient

    from app.services import analytics_store
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    create_user("admin-user", email="test-admin@test.local")
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    store = AnalyticsStore(tmp_path / "an" / "analytics.sqlite", "dev/analytics/shards/w/analytics.sqlite", "w", "dev")
    with patch("app.storage.get_r2_sync_client", return_value=None):
        store.confirm_baseline()
    with patch.object(analytics_store, "_store", store), \
         patch("app.storage.get_r2_sync_client", return_value=None):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def test_admin_trigger_runs_sweep_and_step_shows_left(rollup_client):
    from app.analytics import create_user_segment, record_milestone
    from app.services.auth_db import create_user

    create_user("user-1", email="user-1@test.com")
    create_user_segment("user-1", "organic", None, "otp")
    record_milestone("user-1", "session_started")
    # Dated after record_milestone's session_started (now), so the exit is at "started".
    _log("user-1", [_exit("2099-01-01T00:00:00.000000Z", "annotate", {"annotate": 90})])

    with patch("app.services.analytics_journey_rollup.rollup_population",
               return_value=_users("user-1")):
        resp = rollup_client.post("/api/admin/analytics/journey/rollup", headers={"X-User-ID": "admin-user"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["users_walked"] == 1 and body["below_head_skipped"] == 0 and body["users_failed"] == 0
    assert body["run_id"]

    step = rollup_client.get("/api/admin/analytics/journey/step/started?exclude_test=false",
                             headers={"X-User-ID": "admin-user"}).json()
    assert step["left"]["run_id"] == body["run_id"]
    assert step["left"]["exit_screens"] == [{"screen": "annotate", "users": 1,
                                             "share": {"pct": None, "k": 1, "n": 1}}]


def test_admin_trigger_requires_admin(rollup_client):
    from app.services.auth_db import create_user
    create_user("regular-user", email="regular-user@test.com")
    resp = rollup_client.post("/api/admin/analytics/journey/rollup", headers={"X-User-ID": "regular-user"})
    assert resp.status_code == 403
