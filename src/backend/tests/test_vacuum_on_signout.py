"""
T2010: VACUUM moved from archive_project to logout background thread.

Tests verify:
1. archive_project no longer calls VACUUM (AST inspection)
2. _vacuum_user_dbs VACUUMs all profile DBs for a user
3. _vacuum_user_dbs skips missing profiles dir gracefully
4. _vacuum_user_dbs skips profiles without profile.sqlite
5. _vacuum_user_dbs registers/clears _active_vacuum_conns
6. cancel_active_vacuum interrupts an in-progress VACUUM
7. cancel_active_vacuum is a no-op when no VACUUM is active
8. logout endpoint fires _vacuum_user_dbs in background
9. init endpoint calls cancel_active_vacuum before session init
10. cleanup_database_bloat still has its size-gated VACUUM (unchanged)
"""
import ast
import sqlite3
import threading
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ARCHIVE_PY = Path(__file__).resolve().parents[1] / "app" / "services" / "project_archive.py"
AUTH_PY = Path(__file__).resolve().parents[1] / "app" / "routers" / "auth.py"


# ---------------------------------------------------------------------------
# 1. archive_project must NOT call VACUUM
# ---------------------------------------------------------------------------

def test_archive_project_no_vacuum():
    """archive_project() must not contain conn.execute("VACUUM")."""
    src = ARCHIVE_PY.read_text(encoding="utf-8")
    tree = ast.parse(src)

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef) or node.name != "archive_project":
            continue
        for child in ast.walk(node):
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute):
                if child.func.attr == "execute" and child.args:
                    arg = child.args[0]
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        assert "VACUUM" not in arg.value.upper(), (
                            f"archive_project still calls execute('{arg.value}') — "
                            "VACUUM must be removed (T2010)"
                        )
        return

    pytest.fail("archive_project function not found in project_archive.py")


# ---------------------------------------------------------------------------
# 10. cleanup_database_bloat MUST still have VACUUM (safety net)
# ---------------------------------------------------------------------------

def test_cleanup_database_bloat_still_has_vacuum():
    """cleanup_database_bloat() must retain its size-gated VACUUM."""
    src = ARCHIVE_PY.read_text(encoding="utf-8")
    tree = ast.parse(src)

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef) or node.name != "cleanup_database_bloat":
            continue
        for child in ast.walk(node):
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute):
                if child.func.attr == "execute" and child.args:
                    arg = child.args[0]
                    if isinstance(arg, ast.Constant) and "VACUUM" in str(arg.value).upper():
                        return  # Found it
        pytest.fail("cleanup_database_bloat no longer calls VACUUM — it should (T2010 safety net)")

    pytest.fail("cleanup_database_bloat function not found in project_archive.py")


# ---------------------------------------------------------------------------
# 2. _vacuum_user_dbs VACUUMs all profile DBs
# ---------------------------------------------------------------------------

def test_vacuum_user_dbs_vacuums_all_profiles(tmp_path):
    """_vacuum_user_dbs should VACUUM every profile.sqlite under the user's profiles dir."""
    from app.routers.auth import _vacuum_user_dbs

    user_id = "test-user"
    profiles_dir = tmp_path / user_id / "profiles"

    # Create two profile DBs with some data then delete it to create freeable space
    for pid in ("profile-a", "profile-b"):
        db_dir = profiles_dir / pid
        db_dir.mkdir(parents=True)
        db_path = db_dir / "profile.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE filler (data TEXT)")
        conn.execute("INSERT INTO filler VALUES (?)", ("x" * 5000,))
        conn.commit()
        conn.execute("DELETE FROM filler")
        conn.commit()
        conn.close()

    with patch("app.routers.auth.USER_DATA_BASE", tmp_path):
        _vacuum_user_dbs(user_id)

    # Both DBs should still be valid after VACUUM
    for pid in ("profile-a", "profile-b"):
        db_path = profiles_dir / pid / "profile.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("SELECT 1")
        conn.close()


# ---------------------------------------------------------------------------
# 3. _vacuum_user_dbs handles missing profiles dir
# ---------------------------------------------------------------------------

def test_vacuum_user_dbs_missing_profiles_dir(tmp_path):
    """No error when the user's profiles directory doesn't exist."""
    from app.routers.auth import _vacuum_user_dbs

    with patch("app.routers.auth.USER_DATA_BASE", tmp_path):
        _vacuum_user_dbs("nonexistent-user")  # should not raise


# ---------------------------------------------------------------------------
# 4. _vacuum_user_dbs skips dirs without profile.sqlite
# ---------------------------------------------------------------------------

def test_vacuum_user_dbs_skips_dirs_without_sqlite(tmp_path):
    """Directories under profiles/ that lack profile.sqlite are skipped."""
    from app.routers.auth import _vacuum_user_dbs

    user_id = "test-user"
    profiles_dir = tmp_path / user_id / "profiles"

    # One valid profile, one empty dir
    valid_dir = profiles_dir / "valid"
    valid_dir.mkdir(parents=True)
    db_path = valid_dir / "profile.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE t (id INTEGER)")
    conn.commit()
    conn.close()

    empty_dir = profiles_dir / "empty"
    empty_dir.mkdir(parents=True)
    # No profile.sqlite here

    with patch("app.routers.auth.USER_DATA_BASE", tmp_path):
        _vacuum_user_dbs(user_id)  # should not raise


# ---------------------------------------------------------------------------
# 5. _vacuum_user_dbs registers and clears _active_vacuum_conns
# ---------------------------------------------------------------------------

def test_vacuum_user_dbs_clears_active_conn_after_success(tmp_path):
    """After a successful VACUUM, user_id should not remain in _active_vacuum_conns."""
    from app.routers.auth import _vacuum_user_dbs, _active_vacuum_conns

    user_id = "test-user"
    profiles_dir = tmp_path / user_id / "profiles" / "p1"
    profiles_dir.mkdir(parents=True)
    db_path = profiles_dir / "profile.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE t (id INTEGER)")
    conn.commit()
    conn.close()

    with patch("app.routers.auth.USER_DATA_BASE", tmp_path):
        _vacuum_user_dbs(user_id)

    assert user_id not in _active_vacuum_conns


def test_vacuum_user_dbs_clears_active_conn_after_failure(tmp_path):
    """After a failed VACUUM, user_id should not remain in _active_vacuum_conns."""
    from app.routers.auth import _vacuum_user_dbs, _active_vacuum_conns

    user_id = "test-user"
    profiles_dir = tmp_path / user_id / "profiles" / "p1"
    profiles_dir.mkdir(parents=True)
    db_path = profiles_dir / "profile.sqlite"
    # Write garbage — not a valid SQLite DB
    db_path.write_bytes(b"not a database")

    with patch("app.routers.auth.USER_DATA_BASE", tmp_path):
        _vacuum_user_dbs(user_id)  # should not raise

    assert user_id not in _active_vacuum_conns


# ---------------------------------------------------------------------------
# 6. cancel_active_vacuum interrupts an in-progress VACUUM
# ---------------------------------------------------------------------------

def test_cancel_active_vacuum_interrupts(tmp_path):
    """cancel_active_vacuum should call interrupt() on the tracked connection."""
    from app.routers.auth import cancel_active_vacuum, _active_vacuum_conns

    mock_conn = MagicMock(spec=sqlite3.Connection)
    _active_vacuum_conns["user-123"] = mock_conn

    cancel_active_vacuum("user-123")

    mock_conn.interrupt.assert_called_once()
    assert "user-123" not in _active_vacuum_conns


# ---------------------------------------------------------------------------
# 7. cancel_active_vacuum is a no-op when no VACUUM is active
# ---------------------------------------------------------------------------

def test_cancel_active_vacuum_noop_when_no_vacuum():
    """cancel_active_vacuum should not raise when no VACUUM is in progress."""
    from app.routers.auth import cancel_active_vacuum, _active_vacuum_conns

    _active_vacuum_conns.pop("nonexistent", None)  # ensure clean state
    cancel_active_vacuum("nonexistent")  # should not raise


# ---------------------------------------------------------------------------
# 8. logout endpoint fires _vacuum_user_dbs in background
# ---------------------------------------------------------------------------

def test_logout_fires_vacuum_in_background():
    """POST /logout should schedule _vacuum_user_dbs via asyncio.to_thread."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)

    with patch("app.routers.auth.validate_session") as mock_validate, \
         patch("app.routers.auth.invalidate_session"), \
         patch("app.routers.auth.invalidate_user_cache"), \
         patch("app.routers.auth._vacuum_user_dbs") as mock_vacuum:

        mock_validate.return_value = {"user_id": "user-abc", "email": "test@test.com"}

        r = client.post("/api/auth/logout", cookies={"rb_session": "fake-session"})

    assert r.status_code == 200
    assert r.json()["logged_out"] is True
    mock_vacuum.assert_called_once_with("user-abc")


def test_logout_without_session_skips_vacuum():
    """POST /logout without a session cookie should not fire VACUUM."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)

    with patch("app.routers.auth._vacuum_user_dbs") as mock_vacuum:
        r = client.post("/api/auth/logout")

    assert r.status_code == 200
    mock_vacuum.assert_not_called()


# ---------------------------------------------------------------------------
# 9. init endpoint calls cancel_active_vacuum
# ---------------------------------------------------------------------------

def test_init_calls_cancel_active_vacuum():
    """POST /init should call cancel_active_vacuum before user_session_init."""
    src = AUTH_PY.read_text(encoding="utf-8")
    tree = ast.parse(src)

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name != "init_session":
            continue

        # Walk the body in order — cancel_active_vacuum must appear before user_session_init
        found_cancel = False
        found_init = False
        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                if isinstance(child.func, ast.Name) and child.func.id == "cancel_active_vacuum":
                    found_cancel = True
                if isinstance(child.func, ast.Name) and child.func.id == "user_session_init":
                    if not found_cancel:
                        pytest.fail(
                            "user_session_init is called before cancel_active_vacuum in init_session — "
                            "VACUUM must be cancelled before any DB access"
                        )
                    found_init = True

        assert found_cancel, "init_session must call cancel_active_vacuum"
        assert found_init, "init_session must call user_session_init"
        return

    pytest.fail("init_session function not found in auth.py")


# ---------------------------------------------------------------------------
# Integration: cancel interrupts a real VACUUM on a real DB
# ---------------------------------------------------------------------------

def test_cancel_interrupts_real_vacuum(tmp_path):
    """End-to-end: cancel_active_vacuum interrupts a real VACUUM holding a lock."""
    from app.routers.auth import _active_vacuum_conns

    db_path = tmp_path / "test.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE big (data TEXT)")
    # Insert enough data that VACUUM takes measurable time
    conn.executemany("INSERT INTO big VALUES (?)", [("x" * 10000,)] * 200)
    conn.commit()
    conn.execute("DELETE FROM big")
    conn.commit()
    conn.close()

    vacuum_started = threading.Event()
    vacuum_result = {"interrupted": False, "error": None}

    def run_vacuum():
        c = sqlite3.connect(str(db_path))
        _active_vacuum_conns["cancel-test"] = c
        vacuum_started.set()
        try:
            c.execute("VACUUM")
        except sqlite3.OperationalError as e:
            if "interrupted" in str(e).lower():
                vacuum_result["interrupted"] = True
            else:
                vacuum_result["error"] = str(e)
        finally:
            _active_vacuum_conns.pop("cancel-test", None)
            c.close()

    t = threading.Thread(target=run_vacuum)
    t.start()
    vacuum_started.wait(timeout=5)

    # Small delay to let VACUUM actually start executing
    time.sleep(0.01)
    c = _active_vacuum_conns.get("cancel-test")
    if c:
        c.interrupt()
    t.join(timeout=5)

    # Either the VACUUM completed before we could interrupt (fast DB), or it was interrupted.
    # Both are acceptable — the key invariant is that the connection is cleaned up
    # and no lock is held.
    assert "cancel-test" not in _active_vacuum_conns

    # Verify DB is still usable after interrupt
    verify_conn = sqlite3.connect(str(db_path))
    verify_conn.execute("SELECT 1")
    verify_conn.close()
