"""
T8190 — the JIT migration seam self-deadlocks when a migration's own `up()`
writes through the app's normal connection helper (`get_db_connection`).

Mechanism (confirmed live on staging 2026-08-31, see the task file):
  1. `ensure_database()` calls `migrations.run_profile_seam(user, profile)`.
  2. `run_profile_seam` takes the per-(user, profile) `threading.Lock` and runs
     pending migrations.
  3. `v047_backfill_game_storage_refs.up(conn)` calls `insert_game_storage_ref`,
     which does `with get_db_connection() as conn:` for its SQLite half.
  4. `get_db_connection()` calls `ensure_database()` AGAIN -> back into
     `run_profile_seam` for the SAME (user, profile) -> `lock.acquire()` on a
     lock this thread already holds -> deadlock, no timeout, process wedges
     (even unrelated endpoints stop responding once the thread pool exhausts).

This file reproduces the deadlock WITHOUT any network/R2/staging dependency:
a below-head temp profile DB (real FakeR2, matching T5083/T5085's pattern) plus
the REAL v047 migration. Every test that could hang on unfixed code runs the
seam call on a background thread and asserts it finishes within a bounded
join() timeout -- so a regression FAILS FAST instead of hanging CI forever.
"""

import re
import sqlite3
import threading
from pathlib import Path
from unittest.mock import patch

import pytest

from app.migrations import MigrationBlocked
from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER
from tests.test_t4050_durable_sync import FakeR2, _r2_patched
from tests.test_t5083_jit_seam import _profile_r2_key, _seed_r2

PROFILE_HEAD = PROFILE_DB_RUNNER.latest_version
V047_VERSION = 47

USER = "u_t8190"
PROFILE = "8190prof"

# Generous enough that a healthy seam (real SQLite I/O, a handful of PRAGMA/
# INSERT statements) never gets close, tight enough that a genuine deadlock
# fails the test in seconds, not minutes.
SEAM_TIMEOUT_S = 10


def _ctx(user_id=USER, profile_id=PROFILE):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)


@pytest.fixture(autouse=True)
def _reset_registries(monkeypatch):
    """Same isolation as test_t5083_jit_seam.py / test_t5085_non_login_writers.py."""
    import app.database as db_module
    import app.migrations as migrations_module
    import app.services.user_db as user_db_module
    monkeypatch.setattr(db_module, "_initialized_users", set())
    monkeypatch.setattr(db_module, "_user_db_versions", {})
    monkeypatch.setattr(user_db_module, "_initialized_user_dbs", set())
    monkeypatch.setattr(db_module, "_user_sqlite_versions", {})
    monkeypatch.setattr(migrations_module, "_seam_verified", set())
    monkeypatch.setattr(migrations_module, "_migration_locks", {})
    yield


def _build_below_head_profile_with_game_storage(tmp_path: Path) -> bytes:
    """A profile.sqlite one version behind head, with a `games` table (the
    seam's schema baseline) and a `game_storage` table holding ONE row --
    v047's own guard (`if not rows: return`) short-circuits on an empty
    table, which is exactly why light test/dev accounts never tripped this."""
    p = tmp_path / "seed.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT, blake3_hash TEXT)")
    conn.execute(
        "INSERT INTO games (name, blake3_hash) VALUES ('g0', ?)",
        ("a" * 64,),
    )
    conn.execute(
        "CREATE TABLE game_storage (blake3_hash TEXT PRIMARY KEY, game_size_bytes INTEGER, "
        "storage_expires_at TEXT)"
    )
    conn.execute(
        "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, ?, ?)",
        ("a" * 64, 1000, "2099-01-01"),
    )
    conn.execute(f"PRAGMA user_version = {V047_VERSION - 1}")
    conn.commit()
    conn.close()
    data = p.read_bytes()
    p.unlink()
    return data


def _run_seam_bounded(fn, timeout_s: float = SEAM_TIMEOUT_S):
    """Run `fn` on a background thread; return (finished, error). A genuinely
    deadlocked seam leaves the thread alive forever -- join() with a timeout
    is the only way to observe that without hanging the test process itself.

    Sets the (user, profile) ContextVars INSIDE the thread -- contextvars are
    per-thread by default, so a context set on the calling thread would not
    be visible to `fn` running here (ensure_database reads it via
    get_current_user_id/get_current_profile_id)."""
    result = {}

    def _target():
        try:
            _ctx()
            fn()
            result["ok"] = True
        except BaseException as e:  # must capture MigrationBlocked (an Exception) too
            result["error"] = e

    thread = threading.Thread(target=_target, daemon=True)
    thread.start()
    thread.join(timeout=timeout_s)
    return (not thread.is_alive()), result.get("error")


# ---------------------------------------------------------------------------
# 1. The core deadlock: a real v047 run through the real seam must COMPLETE,
#    not hang, when reached via ensure_database() (the exact login/request path).
# ---------------------------------------------------------------------------

def test_migration_reentering_seam_via_get_db_connection_does_not_hang(tmp_path):
    """RED on pre-T8190 code: v047's insert_game_storage_ref call re-enters
    run_profile_seam for the SAME (user, profile) while this thread already
    holds that key's lock -> deadlock, thread never finishes, test times out
    at SEAM_TIMEOUT_S instead of the process hanging forever in prod."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        _ctx()
        key = _profile_r2_key(USER, PROFILE)
        data = _build_below_head_profile_with_game_storage(tmp_path)
        _seed_r2(fake, key, data, sync_version=5)

        from app.database import ensure_database

        with patch("app.services.orphan_raw_clips.list_raw_clip_objects", return_value=[]):
            finished, error = _run_seam_bounded(ensure_database)

    assert finished, (
        f"ensure_database() did not return within {SEAM_TIMEOUT_S}s -- the JIT seam "
        "deadlocked on its own re-entrant lock (T8190: a migration's get_db_connection "
        "call re-entered run_profile_seam for the profile already being migrated)"
    )
    assert error is None, f"ensure_database() raised unexpectedly: {error!r}"


def test_migration_reentering_seam_reaches_head_with_correct_version(tmp_path):
    """Same shape, but proves the POSITIVE outcome too: not just 'didn't hang',
    but the profile actually lands at head (v047 AND v048 both applied)."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        _ctx()
        key = _profile_r2_key(USER, PROFILE)
        data = _build_below_head_profile_with_game_storage(tmp_path)
        _seed_r2(fake, key, data, sync_version=5)

        from app.database import ensure_database, get_database_path

        with patch("app.services.orphan_raw_clips.list_raw_clip_objects", return_value=[]):
            finished, error = _run_seam_bounded(ensure_database)
        assert finished, f"seam did not complete within {SEAM_TIMEOUT_S}s"
        assert error is None, f"unexpected error: {error!r}"

        conn = sqlite3.connect(str(get_database_path()))
        try:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
        finally:
            conn.close()

    assert version == PROFILE_HEAD, (
        f"expected profile at head ({PROFILE_HEAD}) after the seam, got {version}"
    )


# ---------------------------------------------------------------------------
# 2. Genuine cross-thread contention (a different request migrating the SAME
#    profile concurrently) must fail LOUD (MigrationBlocked -> 503) within a
#    bound, never hang the requester indefinitely.
# ---------------------------------------------------------------------------

def test_genuine_cross_thread_contention_raises_migration_blocked_not_hang(tmp_path, monkeypatch):
    """A DIFFERENT thread holding the same (user, profile) lock (simulating a
    concurrent request migrating this profile) must cause a timed-out waiter
    to raise MigrationBlocked, never hang forever. This is a real scenario
    (two requests for the same just-deployed user racing to migrate), distinct
    from the same-thread re-entrancy bug above."""
    import app.migrations as migrations_module

    # Patch the production lock-acquire timeout down so this test proves the
    # mechanism in ~1s instead of waiting out the real 30s ceiling.
    contention_timeout = 1
    monkeypatch.setattr(migrations_module, "SEAM_LOCK_TIMEOUT_S", contention_timeout)
    bounded_wait = contention_timeout + SEAM_TIMEOUT_S

    lock = migrations_module._get_migration_lock(USER, PROFILE)
    holder_ready = threading.Event()
    release_holder = threading.Event()

    def _hold_lock():
        with lock:
            holder_ready.set()
            release_holder.wait(timeout=bounded_wait + 5)

    holder_thread = threading.Thread(target=_hold_lock, daemon=True)
    holder_thread.start()
    assert holder_ready.wait(timeout=5), "lock-holder thread never started"

    fake = FakeR2()
    try:
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
             _r2_patched(fake):
            _ctx()
            key = _profile_r2_key(USER, PROFILE)
            data = _build_below_head_profile_with_game_storage(tmp_path)
            _seed_r2(fake, key, data, sync_version=5)

            from app.database import ensure_database

            finished, error = _run_seam_bounded(ensure_database, timeout_s=bounded_wait)
    finally:
        release_holder.set()
        holder_thread.join(timeout=5)

    assert finished, (
        f"ensure_database() did not return within {bounded_wait}s under genuine "
        "cross-thread lock contention -- it must raise MigrationBlocked on a timed-out "
        "acquire, never hang the requester"
    )
    assert isinstance(error, MigrationBlocked), (
        f"expected MigrationBlocked on lock-acquire timeout, got {error!r}"
    )


# ---------------------------------------------------------------------------
# 3. Static guard: no migration's `up()` may reach a connection helper that
#    re-enters the seam. Fails loudly if a FUTURE migration reintroduces this.
# ---------------------------------------------------------------------------

_SEAM_REENTRANT_SYMBOLS = (
    "get_db_connection",
    "get_user_db_connection",
    "insert_game_storage_ref",
)


def _migration_source_files():
    import app.migrations.profile_db as profile_pkg
    import app.migrations.user_db as user_pkg
    for pkg in (profile_pkg, user_pkg):
        pkg_dir = Path(pkg.__file__).parent
        yield from sorted(pkg_dir.glob("v*.py"))


def test_no_migration_reenters_the_seam_via_connection_helpers():
    """A migration's `up(conn)` already HAS a connection for the DB being
    migrated -- it must use `conn` directly (or a Postgres-only helper) for
    ANY writes, never the request-path openers that re-run ensure_database/
    ensure_user_database and re-enter the (now-held) seam lock. This is the
    structural guard against a NEW v049+ reintroducing T8190.

    Matches actual CALL SYNTAX only (`\\bsymbol\\(`, no space before the
    paren -- this codebase's ruff style never puts one in real code) via
    regex word boundaries -- not comment/docstring prose mentioning the
    banned name (this file's own migrations explain the T8190 landmine in
    comments, some with a parenthetical right after the name), and not the
    safe `insert_game_storage_ref_pg_only` variant (the trailing `_` after
    `ref` fails the `\\b` boundary, so it can never match the bare-name regex)."""
    offenders = []
    for path in _migration_source_files():
        source = path.read_text(encoding="utf-8")
        for symbol in _SEAM_REENTRANT_SYMBOLS:
            if re.search(rf"\b{re.escape(symbol)}\(", source):
                offenders.append(f"{path.name}: calls `{symbol}(...)`")

    assert not offenders, (
        "migration(s) reach a connection helper that re-enters the JIT seam "
        "(T8190 self-deadlock) -- use the `conn` parameter already passed to "
        "up(conn), or a Postgres-only helper, instead:\n  " + "\n  ".join(offenders)
    )
