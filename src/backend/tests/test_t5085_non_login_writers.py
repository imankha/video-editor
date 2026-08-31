"""
T5085 — non-login writers migrate-before-touch.

T5083 put the JIT seam INSIDE `ensure_database()`/`ensure_user_database()`, so
every non-login path that opens a DB WITHOUT going through those two functions
bypassed migration entirely. This file pins the fixes for the two real gaps
the audit + expert design pass found (not just "a gap exists" — the exact
mechanism each bug would have shipped as):

1. `materialization.ensure_profile_db_local` / `_open_profile_db` (the raw
   openers underlying share resolution, admin cross-user reads, cross-profile
   reel moves, credit-reservation recovery) never migrated at all — fixed by
   routing both through the extracted `migrations.run_profile_seam`.
2. `user_db.ensure_user_database_fresh` ran the seam, then did its OWN
   restore-if-newer swap AFTER it — a rolling-deploy peer machine's
   sync-newer/schema-older bytes could silently reintroduce a below-head file
   with `_seam_verified` already set, permanently defeating the seam for that
   user in that process. Fixed by re-running the seam after any actual swap.

Plus two narrower regressions pinning the "one blocked profile must not aport
an entire admin/background pass" fix (previously unguarded `ensure_database()`
calls in bulk loops) and the "never silently swallow a dropped analytics
write" fix (EPIC decision 6 — no silent fallback).

See docs/plans/tasks/jit-migration/T5085-non-login-writers-migrate-before-touch.md
and .claude/knowledge/persistence-sync.md § T5085 for the full audit + policy.
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER
from app.migrations.user_db import RUNNER as USER_DB_RUNNER
from tests.test_t4050_durable_sync import FakeR2, _r2_patched
from tests.test_t5083_jit_seam import _profile_r2_key, _seed_r2, _user_r2_key

PROFILE_HEAD = PROFILE_DB_RUNNER.latest_version
USER_HEAD = USER_DB_RUNNER.latest_version

USER = "u_t5085"
PROFILE = "5085prof"


def _ctx(user_id=USER, profile_id=PROFILE):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)


@pytest.fixture(autouse=True)
def _reset_registries(monkeypatch):
    """Same isolation as test_t5083_jit_seam.py's fixture — see that file's
    comment for why `_seam_verified` must be reset via the module attribute."""
    import app.database as db_module
    import app.migrations as migrations_module
    import app.services.user_db as user_db_module
    monkeypatch.setattr(db_module, "_initialized_users", set())
    monkeypatch.setattr(db_module, "_user_db_versions", {})
    monkeypatch.setattr(user_db_module, "_initialized_user_dbs", set())
    monkeypatch.setattr(db_module, "_user_sqlite_versions", {})
    monkeypatch.setattr(migrations_module, "_seam_verified", set())
    yield


def _read_user_version(db_path: Path) -> int:
    conn = sqlite3.connect(str(db_path))
    try:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 1. B2 fix — a non-login opener (open_profile_db_readonly) migrates a
#    below-head profile to head, using the REAL (unmocked) migration runner.
# ---------------------------------------------------------------------------

def test_readonly_path_migrates_below_head_profile_to_head(tmp_path):
    """A below-head profile reached ONLY via `open_profile_db_readonly`
    (never through `ensure_database`) — the exact shape of admin clip-phase
    inventory, admin stuck-uploads, and public share/collection/intro
    resolution — must still land at head. Before T5085,
    `materialization.ensure_profile_db_local` restored the file but never
    called the migration runner, so this exact call would have silently
    handed back a below-head connection."""
    fake = FakeR2()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database, get_database_path
        ensure_database()  # real base schema at head, for a byte template

        db_path = get_database_path()
        conn = sqlite3.connect(str(db_path))
        conn.execute(f"PRAGMA user_version = {PROFILE_HEAD - 1}")
        conn.commit()
        conn.close()

        data = db_path.read_bytes()
        db_path.unlink()  # force a genuine R2 restore, not a local no-op
        key = _profile_r2_key(USER, PROFILE)
        _seed_r2(fake, key, data, sync_version=5)

        import app.database as db_module
        db_module._initialized_users.discard(USER)
        db_module._user_db_versions.pop((USER, PROFILE), None)

        from app.services.materialization import open_profile_db_readonly
        with patch("app.services.orphan_raw_clips.list_raw_clip_objects", return_value=[]):
            conn = open_profile_db_readonly(USER, PROFILE)  # NEVER calls ensure_database
        assert conn is not None
        final_version = conn.execute("PRAGMA user_version").fetchone()[0]
        conn.close()

    assert final_version == PROFILE_HEAD, (
        "open_profile_db_readonly -> ensure_profile_db_local must migrate a "
        f"below-head profile to head via the real seam, got {final_version}"
    )


# ---------------------------------------------------------------------------
# 2. B4 fix — ensure_user_database_fresh's own post-seam swap must not
#    silently reintroduce a below-head file.
# ---------------------------------------------------------------------------

def test_ensure_user_database_fresh_remigrates_after_post_seam_swap(tmp_path):
    """Simulates the EPIC decision 8 rolling-deploy-skew shape: this process
    already migrated + verified the user (seam ran, `_seam_verified` set),
    then a peer machine still on OLD code writes sync-newer bytes at a LOWER
    schema version. `ensure_user_database_fresh`'s own restore-if-newer swap
    downloads those bytes AFTER the seam already ran -- before the T5085 fix,
    `_seam_verified` stayed set and the swapped-in below-head file was never
    re-migrated, so every subsequent write on this machine would hit it
    directly. The fix re-runs the seam after any actual swap."""
    fake = FakeR2()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        _ctx()
        from app.services.user_db import _get_user_db_path, ensure_user_database
        ensure_user_database(USER)  # real base schema at head

        db_path = _get_user_db_path(USER)
        conn = sqlite3.connect(str(db_path))
        conn.execute(f"PRAGMA user_version = {USER_HEAD - 1}")
        conn.commit()
        conn.close()

        # Seed R2 with genuinely below-head bytes at a SYNC-NEWER version --
        # the rolling-deploy shape: a peer machine on old code wrote this.
        data = db_path.read_bytes()
        key = _user_r2_key(USER)
        _seed_r2(fake, key, data, sync_version=6)  # > whatever the initial restore recorded

        from app.services.user_db import ensure_user_database_fresh
        ensure_user_database_fresh(USER)  # must detect + swap + RE-migrate

        final_version = _read_user_version(db_path)

    assert final_version == USER_HEAD, (
        "ensure_user_database_fresh must re-migrate after its own post-seam "
        f"swap, got {final_version} (a below-head file would be served/written "
        "directly by every subsequent get_user_db_connection call on this machine)"
    )


# ---------------------------------------------------------------------------
# 3. Blast-radius fix — a MigrationBlocked profile in a bulk admin/background
#    loop must not abort the whole pass.
# ---------------------------------------------------------------------------

def test_sweep_do_sweep_skips_blocked_profile_continues(tmp_path):
    """`sweep_scheduler.do_sweep`'s `ensure_database()` call was unguarded --
    pre-T5083 this could never raise. Now that it's the JIT seam, one blocked
    profile must be skipped (not abort the sweep for every remaining user)."""
    from app.migrations import MigrationBlocked

    def fake_ensure_database():
        from app.profile_context import get_current_profile_id
        if get_current_profile_id() == "blocked":
            raise MigrationBlocked(USER, "blocked", "not_at_head")
        # "good" profile: no-op, nothing to assert on besides "did not raise"

    with patch("app.services.sweep_scheduler.ensure_database", side_effect=fake_ensure_database), \
         patch("app.services.auth_db.get_all_users_for_admin",
               return_value=[{"user_id": USER}]), \
         patch("app.migrations._get_profile_ids", return_value=["blocked", "good"]), \
         patch("app.services.sweep_scheduler.get_expired_refs_for_profile", return_value=[]):
        from app.services.sweep_scheduler import do_sweep
        do_sweep()  # must NOT raise -- the blocked profile is skipped, not fatal


# ---------------------------------------------------------------------------
# 4. Silent-fallback fix — analytics writes must not silently swallow a
#    blocked migration (EPIC decision 6).
# ---------------------------------------------------------------------------

def test_record_milestone_logs_critical_on_migration_blocked(caplog):
    """record_milestone's user.sqlite write is wrapped in a broad
    `except Exception: logger.warning(...)` that would have silently
    swallowed a MigrationBlocked pre-T5085 -- the row silently not written,
    with only a generic warning indistinguishable from any other sync hiccup.
    Now it must log a distinct CRITICAL marker naming the reason."""
    import logging

    from app.migrations import MigrationBlocked

    with patch("app.services.user_db.get_user_db_connection",
               side_effect=MigrationBlocked(USER, None, "not_at_head")), \
         patch("app.analytics.get_pg") as mock_pg:
        # The Postgres half of record_milestone must succeed for the function
        # to reach the user.sqlite write at all -- give it a harmless no-op cursor.
        mock_conn = mock_pg.return_value.__enter__.return_value
        mock_conn.cursor.return_value.fetchone.return_value = None

        from app import analytics
        with caplog.at_level(logging.CRITICAL, logger="app.analytics"):
            analytics.record_milestone(USER, "export_completed")  # must NOT raise

    assert any(
        "ANALYTICS_WRITE_DROPPED" in r.message and "not_at_head" in r.message
        for r in caplog.records
    ), "a MigrationBlocked user.sqlite write must log a distinct CRITICAL marker, not a generic warning"


# ---------------------------------------------------------------------------
# 5. WAL-concurrency fix (CI escalation) — a live connection on an AT-HEAD
#    profile must not spuriously block; a live connection on a genuinely
#    below-head profile still must.
# ---------------------------------------------------------------------------

def test_open_profile_db_with_live_connection_at_head_does_not_raise(tmp_path):
    """`_open_profile_db` -- the raw opener behind share materialization and
    cross-profile reel moves -- calls the seam before connecting. An
    unrelated LIVE connection on the exact same at-head profile (e.g. the
    owner actively writing while an admin inventory read opens the same file)
    must not be treated as `wal_busy`: nothing needs to migrate, so there is
    nothing to block on. Before the CI-escalation fix, the seam primitive's
    own `wal_sidecars_present` check fired before it ever looked at
    PRAGMA user_version, and this call would have raised MigrationBlocked
    for a completely healthy at-head profile."""
    fake = FakeR2()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database, get_database_path
        ensure_database()  # real base schema, already at head
        db_path = get_database_path()

        live_conn = sqlite3.connect(str(db_path), timeout=30)
        live_conn.execute("PRAGMA journal_mode=WAL")
        live_conn.execute("INSERT INTO games (name) VALUES ('live')")
        live_conn.commit()

        import app.database as db_module
        db_module._initialized_users.discard(USER)  # force a fresh seam entry

        try:
            from app.services.materialization import _open_profile_db
            conn = _open_profile_db(USER, PROFILE)  # must NOT raise
            assert conn is not None
            conn.close()
        finally:
            live_conn.close()


def test_open_profile_db_with_live_connection_below_head_still_blocks(tmp_path):
    """Sibling of the test above: a live connection on a GENUINELY below-head
    profile must still refuse (MigrationBlocked, reason=wal_busy) -- the
    WAL-concurrency fix only skips blocking when there is provably nothing to
    migrate, it must never let a real below-head DB through.

    Patches `clear_stale_wal_sidecars` to a no-op so this test's mechanism is
    platform-independent: on Windows the real unlink fails loud against a
    genuinely open file (making the retry's second `wal_busy` incidental to
    the platform, not the fix), while on Linux/prod the real unlink can
    succeed against an open file (T5086) and let the retry proceed into the
    real runner, making the outcome non-deterministic. Asserting
    `reason == "wal_busy"` after a no-op clear pins the actual invariant this
    test exists for on both platforms."""
    fake = FakeR2()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.db_refresh.clear_stale_wal_sidecars"), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database, get_database_path
        from app.migrations import MigrationBlocked
        ensure_database()
        db_path = get_database_path()

        conn = sqlite3.connect(str(db_path))
        conn.execute(f"PRAGMA user_version = {PROFILE_HEAD - 1}")
        conn.commit()
        conn.close()

        live_conn = sqlite3.connect(str(db_path), timeout=30)
        live_conn.execute("PRAGMA journal_mode=WAL")
        live_conn.execute("INSERT INTO games (name) VALUES ('live')")
        live_conn.commit()

        import app.database as db_module
        db_module._initialized_users.discard(USER)

        try:
            from app.services.materialization import _open_profile_db
            with pytest.raises(MigrationBlocked) as exc_info:
                _open_profile_db(USER, PROFILE)
            assert exc_info.value.reason == "wal_busy"
        finally:
            live_conn.close()
