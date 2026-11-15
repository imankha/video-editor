"""T11185: the quest system is gone from the server.

Three acceptance criteria, each proven through a production seam so the same
test is red on the pre-change revision and green after:

  * C1 -- every /api/quests/* endpoint returns 404 and no quest symbol remains in
    app/ (outside the frozen migration files and the frozen ledger/analytics
    strings the task keeps).
  * C2 -- a user.sqlite at v004 still migrates to head, with or without the
    `completed_quests` table (v005/v006 are guarded), and head drops the quest
    table + the panel-collapsed setting; a profile DB loses `achievements`.
  * C3 -- session init runs no quest backfill query (the per-login Postgres
    read of the `quest_reward` ledger by reference_id).
"""

import sqlite3
import subprocess
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# C1: endpoints 404, no quest symbols
# ---------------------------------------------------------------------------

QUEST_ENDPOINTS = [
    ("get", "/api/quests/definitions"),
    ("get", "/api/quests/progress"),
    ("post", "/api/quests/achievements/opened_framing_editor"),
    ("post", "/api/quests/quest_1/claim-reward"),
    ("put", "/api/quests/panel-collapsed"),
    ("get", "/api/quests/achievements"),
]


@pytest.mark.parametrize("method,path", QUEST_ENDPOINTS)
def test_quest_endpoints_return_404(method, path, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        client = TestClient(app, raise_server_exceptions=False)
        assert not [r.path for r in app.routes if getattr(r, "path", "").startswith("/api/quests")]
        resp = getattr(client, method)(path, headers={"X-User-ID": "t11185-user"})
    assert resp.status_code == 404


# Symbols of the deleted quest system. Migrations (frozen history, plus the new
# drop migrations) are excluded; the frozen ledger strings (`quest_reward`,
# `quest_upfront`, `questbank`) and FLOW_EVENTS labels are not in this list.
QUEST_SYMBOLS = [
    "quest_config",
    "routers.quests",
    "quests_router",
    "QUEST_DEFINITIONS",
    "_check_all_steps",
    "completed_quests",
    "mark_quest_completed",
    "get_completed_quest_ids",
    "get_completed_and_claimed_quest_ids",
    "backfill_completed_quests",
    "quest_panel_collapsed",
    "quests_progress",
    "TUTORIAL_VIDEOS_ENABLED",
    "/api/quests",
]


def test_no_quest_symbols_in_app():
    pattern = "|".join(s.replace(".", r"\.") for s in QUEST_SYMBOLS)
    out = subprocess.run(
        ["git", "grep", "-nE", pattern, "--", "app", ":(exclude)app/migrations"],
        cwd=BACKEND, capture_output=True, text=True,
    )
    assert out.returncode in (0, 1), out.stderr
    assert out.stdout == "", f"quest symbols remain:\n{out.stdout}"
    assert not (BACKEND / "app" / "routers" / "quests.py").exists()
    assert not (BACKEND / "app" / "quest_config.py").exists()


# ---------------------------------------------------------------------------
# C2: a v004 user.sqlite migrates to head
# ---------------------------------------------------------------------------

def _v004_user_db(path: Path, with_quest_table: bool) -> sqlite3.Connection:
    from app.services.user_db import _USER_DB_SCHEMA

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_USER_DB_SCHEMA)
    if with_quest_table:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS completed_quests ("
            "quest_id TEXT PRIMARY KEY, completed_at TEXT DEFAULT (datetime('now')))"
        )
        conn.execute("INSERT INTO completed_quests (quest_id) VALUES ('quest_2')")
    else:
        conn.execute("DROP TABLE IF EXISTS completed_quests")
    conn.execute(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('quest_panel_collapsed', '1')"
    )
    conn.execute("PRAGMA user_version = 4")
    conn.commit()
    return conn


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


@pytest.mark.parametrize("with_quest_table", [True, False])
def test_v004_user_db_migrates_to_head(tmp_path, with_quest_table):
    from app.migrations.user_db import RUNNER

    conn = _v004_user_db(tmp_path / "user.sqlite", with_quest_table)
    RUNNER.run(conn, "sqlite")

    assert conn.execute("PRAGMA user_version").fetchone()[0] == RUNNER.latest_version
    assert "completed_quests" not in _tables(conn)
    assert conn.execute(
        "SELECT 1 FROM user_settings WHERE key = 'quest_panel_collapsed'"
    ).fetchone() is None
    conn.close()


def test_fresh_user_db_schema_has_no_quest_table(tmp_path):
    from app.services.user_db import _USER_DB_SCHEMA

    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    conn.executescript(_USER_DB_SCHEMA)
    assert "completed_quests" not in _tables(conn)
    conn.close()


def test_profile_db_migration_drops_achievements(tmp_path):
    from app.migrations.profile_db import RUNNER

    conn = sqlite3.connect(tmp_path / "profile.sqlite")
    conn.execute(
        "CREATE TABLE achievements (key TEXT PRIMARY KEY, achieved_at TEXT DEFAULT (datetime('now')))"
    )
    conn.execute(f"PRAGMA user_version = {RUNNER.latest_version - 1}")
    pending = [m for m in RUNNER.migrations if m.version == RUNNER.latest_version]
    assert pending, "no head profile_db migration"
    pending[0].up(conn)
    assert "achievements" not in _tables(conn)
    # Idempotent: a second run on a DB without the table is a no-op.
    pending[0].up(conn)
    conn.close()


# ---------------------------------------------------------------------------
# C3: session init runs no quest backfill
# ---------------------------------------------------------------------------

@pytest.fixture
def hermetic(tmp_path, monkeypatch, pg_conn):
    base = tmp_path / "user_data"
    base.mkdir()
    monkeypatch.setattr("app.database.USER_DATA_BASE", base)
    monkeypatch.setattr("app.services.user_db.USER_DATA_BASE", base)
    monkeypatch.setattr("app.routers.auth.USER_DATA_BASE", base)
    monkeypatch.setattr("app.database.R2_ENABLED", False)
    monkeypatch.setattr("app.storage.R2_ENABLED", False)
    monkeypatch.setattr("app.routers.auth.R2_ENABLED", False)
    monkeypatch.setattr("app.services.user_db._initialized_user_dbs", set())
    monkeypatch.setattr("app.database._initialized_users", set())
    monkeypatch.setattr("app.database._user_sqlite_versions", {})
    monkeypatch.setattr("app.database._user_db_versions", {})
    yield base


def test_session_init_runs_no_quest_backfill(hermetic, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.services.user_db.backfill_completed_quests",
        lambda user_id: calls.append(user_id) or 0,
        raising=False,
    )
    from app.session_init import _init_cache, user_session_init
    from app.user_context import set_current_user_id

    uid = f"t11185_{uuid.uuid4().hex[:8]}"
    set_current_user_id(uid)
    _init_cache.pop(uid, None)
    user_session_init(uid)

    assert calls == []
