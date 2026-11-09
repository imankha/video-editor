"""T7400: action-weekly cohort rollup + monthly engagement distributions.

- a user counts into (cohort_week, sport, action, week_index) for every week they have
  >=1 user_action_log row of that action -- including gaps (active week 0 and week 6,
  not in between);
- sport comes from the row's context["sport"], else "unrecorded" (no silent fallback to
  the no_sport sentinel used elsewhere);
- the sweep walks users through the user.sqlite JIT seam; a below-head or unreadable DB,
  or a user with no acquired_at, is counted in users_failed (not silently dropped);
- rerun is a full rebuild -- identical population produces an identical rollup.

Run with: pytest tests/test_analytics_rollup.py -v
"""
import json
from datetime import date
from unittest.mock import patch

import pytest

from app import storage
from app.services.analytics_store import AnalyticsStore, newest_action_rollup

pytestmark = pytest.mark.filterwarnings("ignore")


def _row(action, at, sport=None):
    context = json.dumps({"sport": sport}) if sport else None
    return {"action": action, "context": context, "created_at": at}


def _agg(rows, cohort_week="2026-09-28"):
    from app.services.analytics_rollup import aggregate_user
    return aggregate_user(rows, cohort_week)


# -- pure per-user aggregation --------------------------------------------------------

def test_weekly_active_counts_gap_weeks_not_the_weeks_between():
    # Cohort Monday 2026-09-28. Active in week 0 (same week) and week 6
    # (2026-11-09), silent in between.
    agg = _agg([
        _row("clip_created", "2026-09-29T10:00:00Z", sport="basketball"),
        _row("export_completed", "2026-11-09T10:00:00Z", sport="basketball"),
    ])
    assert agg["weekly"] == {
        ("2026-09-28", "basketball", "clip_created", 0),
        ("2026-09-28", "basketball", "export_completed", 6),
    }


def test_row_without_sport_tag_buckets_as_unrecorded():
    agg = _agg([_row("clip_created", "2026-09-29T10:00:00Z")])
    assert agg["weekly"] == {("2026-09-28", "unrecorded", "clip_created", 0)}


def test_unknown_action_is_excluded_from_the_closed_flow_events_universe():
    agg = _agg([_row("not_a_real_action", "2026-09-29T10:00:00Z")])
    assert agg["weekly"] == set()
    assert agg["monthly"] == {}


def test_monthly_counts_per_action_for_percentile_summary():
    agg = _agg([
        _row("export_completed", "2026-09-29T10:00:00Z"),
        _row("export_completed", "2026-09-30T10:00:00Z"),
        _row("clip_created", "2026-09-29T10:00:00Z"),
    ])
    assert agg["monthly"] == {("2026-09", "export_completed"): 2, ("2026-09", "clip_created"): 1}


def test_fold_counts_distinct_users_and_summarizes_monthly_distribution():
    from app.services.analytics_rollup import fold_rollups
    one = _agg([_row("clip_created", "2026-09-29T10:00:00Z", sport="basketball")])
    two = _agg([_row("clip_created", "2026-09-29T10:00:00Z", sport="basketball"),
                _row("export_completed", "2026-09-29T10:00:00Z")])
    rows = fold_rollups([one, two])
    assert rows["rollup_action_weekly"] == [
        ("2026-09-28", "basketball", "clip_created", 0, 2),
        ("2026-09-28", "unrecorded", "export_completed", 0, 1),
    ]
    assert rows["rollup_engagement_monthly"] == [
        ("2026-09", "clip_created", 2, 1.0, 1.0, 1.0),
        ("2026-09", "export_completed", 1, 1.0, 1.0, 1.0),
    ]


# -- T14950: per-sport monthly totals -------------------------------------------------

def test_aggregate_user_buckets_by_sport_per_month():
    agg = _agg([
        _row("clip_created", "2026-09-29T10:00:00Z", sport="basketball"),
        _row("clip_created", "2026-09-30T10:00:00Z", sport="basketball"),
        _row("export_completed", "2026-09-29T10:00:00Z"),
        _row("export_completed", "2026-09-29T10:00:00Z", sport="no_sport"),
    ])
    assert agg["by_sport"] == {
        ("2026-09", "basketball", "clip_created"): 2,
        ("2026-09", "unrecorded", "export_completed"): 1,
        ("2026-09", "no_sport", "export_completed"): 1,
    }


def test_fold_by_sport_counts_events_and_distinct_users_with_overlap():
    from app.services.analytics_rollup import fold_rollups
    # u1 acted in both basketball and no_sport this month -- counts under BOTH, and
    # distinct_users for each sport is per-sport, not deduped across sports.
    u1 = _agg([
        _row("clip_created", "2026-09-29T10:00:00Z", sport="basketball"),
        _row("clip_created", "2026-09-30T10:00:00Z", sport="no_sport"),
    ])
    u2 = _agg([_row("clip_created", "2026-09-29T10:00:00Z", sport="basketball")])
    u3 = _agg([_row("clip_created", "2026-09-29T10:00:00Z")])  # untagged -> unrecorded

    rows = fold_rollups([u1, u2, u3])
    assert rows["rollup_action_by_sport"] == [
        ("2026-09", "basketball", "clip_created", 2, 2),
        ("2026-09", "no_sport", "clip_created", 1, 1),
        ("2026-09", "unrecorded", "clip_created", 1, 1),
    ]


# -- store: schema step 4 + newest-run reader -----------------------------------------

def test_schema_step_4_tables_exist(tmp_path):
    store = AnalyticsStore(tmp_path / "an" / "analytics.sqlite", "k", "w", "dev")
    with patch("app.storage.get_r2_sync_client", return_value=None):
        store.confirm_baseline()
    with store._lock:
        tables = {r[0] for r in store._conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"action_rollup_meta", "rollup_action_weekly", "rollup_engagement_monthly",
            "rollup_action_by_sport"} <= tables


def test_rebuild_replaces_the_shards_previous_run(tmp_path):
    store = AnalyticsStore(tmp_path / "an" / "analytics.sqlite", "k", "w", "dev")
    with patch("app.storage.get_r2_sync_client", return_value=None):
        store.confirm_baseline()

    def _meta(run_id):
        return {"run_id": run_id, "computed_at": "2026-11-09T00:00:00+00:00",
                "users_swept": 1, "users_failed": 0, "log_rows_reduced": 1}

    store.write_action_rollup(_meta("run-1"), {
        "rollup_action_weekly": [("2026-09-28", "basketball", "clip_created", 0, 5)],
        "rollup_engagement_monthly": [],
        "rollup_action_by_sport": [("2026-09", "basketball", "clip_created", 5, 5)],
    })
    store.write_action_rollup(_meta("run-2"), {
        "rollup_action_weekly": [("2026-09-28", "basketball", "clip_created", 0, 3)],
        "rollup_engagement_monthly": [],
        "rollup_action_by_sport": [("2026-09", "basketball", "clip_created", 3, 3)],
    })
    with store._lock:
        got = newest_action_rollup([store._conn])
    assert got["meta"]["run_id"] == "run-2"
    assert got["rollup_action_weekly"] == [("2026-09-28", "basketball", "clip_created", 0, 3)]
    assert got["rollup_action_by_sport"] == [("2026-09", "basketball", "clip_created", 3, 3)]


# -- sweep through the JIT seam --------------------------------------------------------

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


def _users(*entries):
    """entries: (user_id, acquired_at date | None)."""
    return [{"user_id": uid, "acquired_at": acquired} for uid, acquired in entries]


def test_sweep_walks_users_counts_failed_and_missing_acquired_at(user_dbs, tmp_path):
    from app.migrations import MigrateResult, MigrationBlocked
    from app.services import analytics_rollup as rollup

    for uid in ("u-ok1", "u-ok2", "u-blocked", "u-behind", "u-broken"):
        _log(uid, [_row("clip_created", "2026-09-29T10:00:00Z", sport="basketball")])
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
        summary = rollup.sweep(
            _users(("u-ok1", date(2026, 9, 28)), ("u-blocked", date(2026, 9, 28)),
                   ("u-behind", date(2026, 9, 28)), ("u-broken", date(2026, 9, 28)),
                   ("u-ok2", date(2026, 9, 28)), ("u-no-segment", None)),
            store,
        )

    assert summary["users_swept"] == 2
    assert summary["users_failed"] == 4  # blocked + behind + broken + no acquired_at
    assert summary["run_id"]
    with store._lock:
        got = newest_action_rollup([store._conn])
    assert got["meta"]["run_id"] == summary["run_id"]
    assert got["rollup_action_weekly"] == [("2026-09-28", "basketball", "clip_created", 0, 2)]


def test_sweep_refuses_an_unconfirmed_store(user_dbs, tmp_path):
    from app.services import analytics_rollup as rollup
    store = AnalyticsStore(tmp_path / "an" / "analytics.sqlite", "k", "w", "dev")
    with pytest.raises(rollup.ActionRollupStoreUnavailable):
        rollup.sweep(_users(("u1", date(2026, 9, 28))), store)


def test_rerun_over_the_same_population_is_idempotent(user_dbs, tmp_path):
    from app.services import analytics_rollup as rollup

    _log("u-ok", [_row("clip_created", "2026-09-29T10:00:00Z", sport="basketball")])
    store = AnalyticsStore(tmp_path / "an" / "analytics.sqlite", "dev/analytics/shards/w/analytics.sqlite", "w", "dev")
    with patch("app.storage.get_r2_sync_client", return_value=None):
        store.confirm_baseline()

    with patch("app.storage.get_r2_sync_client", return_value=None):
        rollup.sweep(_users(("u-ok", date(2026, 9, 28))), store)
        second = rollup.sweep(_users(("u-ok", date(2026, 9, 28))), store)

    assert second["users_swept"] == 1 and second["users_failed"] == 0
    with store._lock:
        got = newest_action_rollup([store._conn])
    assert got["rollup_action_weekly"] == [("2026-09-28", "basketball", "clip_created", 0, 1)]


# -- HTTP: admin trigger + status ------------------------------------------------------

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


def test_admin_trigger_reports_summary_and_status_reflects_it(rollup_client):
    from app.analytics import create_user_segment
    from app.services.auth_db import create_user

    create_user("user-1", email="user-1@test.com")
    create_user_segment("user-1", "organic", None, "otp")
    _log("user-1", [_row("clip_created", "2026-09-29T10:00:00Z", sport="basketball")])

    with patch("app.services.analytics_rollup.rollup_population",
               return_value=_users(("user-1", date(2026, 9, 28)))):
        resp = rollup_client.post("/api/admin/analytics/rollup", headers={"X-User-ID": "admin-user"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["users_swept"] == 1 and body["users_failed"] == 0
    assert body["computed_at"]
    assert body["run_id"]

    status = rollup_client.get("/api/admin/analytics/rollup", headers={"X-User-ID": "admin-user"}).json()
    assert status["run_id"] == body["run_id"]
    assert status["computed_at"] == body["computed_at"]


def test_by_sport_endpoint_reads_the_rollup_with_no_per_user_access(rollup_client):
    from app.analytics import create_user_segment
    from app.services.auth_db import create_user

    create_user("user-1", email="user-1@test.com")
    create_user_segment("user-1", "organic", None, "otp")
    _log("user-1", [
        _row("clip_created", "2026-09-29T10:00:00Z", sport="basketball"),
        _row("export_completed", "2026-09-29T10:00:00Z"),  # untagged -> unrecorded
    ])

    with patch("app.services.analytics_rollup.rollup_population",
               return_value=_users(("user-1", date(2026, 9, 28)))):
        rollup_client.post("/api/admin/analytics/rollup", headers={"X-User-ID": "admin-user"})

    resp = rollup_client.get("/api/admin/analytics/by-sport", headers={"X-User-ID": "admin-user"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["partial"] is False
    assert body["rows"] == [
        {"month": "2026-09", "sport": "basketball", "action": "clip_created",
         "events": 1, "distinct_users": 1},
        {"month": "2026-09", "sport": "unrecorded", "action": "export_completed",
         "events": 1, "distinct_users": 1},
    ]


def test_by_sport_endpoint_before_any_rollup_run_returns_empty_rows(rollup_client):
    resp = rollup_client.get("/api/admin/analytics/by-sport", headers={"X-User-ID": "admin-user"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["rows"] == []
