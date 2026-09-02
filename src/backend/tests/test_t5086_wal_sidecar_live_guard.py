"""
T5086 — `clear_stale_wal_sidecars` must never unlink a LIVE connection's WAL.

Bug: the migration seam's `wal_busy` retry path (`run_profile_seam` /
`run_user_seam`) called `clear_stale_wal_sidecars`, which blind-`unlink()`s the
`-wal`/`-shm` sidecars. On Windows (dev/CI) unlinking an open file fails, so the
retry correctly falls back to `wal_busy` -> `MigrationBlocked`. On Linux (prod)
POSIX `unlink()` of an OPEN file SUCCEEDS silently, destroying a live
connection's WAL and inviting cross-DB page mixing.

Fix: a seam-specific sibling `clear_wal_sidecars_if_unheld` probes for a live
holder (`locking_mode=EXCLUSIVE` + `BEGIN IMMEDIATE`) and REFUSES (nothing
unlinked) when one exists, so the seam surfaces `wal_busy` -> `MigrationBlocked`.

These tests assert the DISCRIMINATOR's behavior (return value + whether the
live sidecar survives), NOT OS-specific unlink outcomes, so they pass
identically on Windows (dev) and Linux (CI/prod).
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.db_refresh import clear_wal_sidecars_if_unheld


def _wal(db_path: Path) -> Path:
    return db_path.with_name(db_path.name + "-wal")


def _shm(db_path: Path) -> Path:
    return db_path.with_name(db_path.name + "-shm")


def _make_wal_db(db_path: Path) -> sqlite3.Connection:
    """Create a WAL-mode DB and return an OPEN connection holding it (a live
    -wal sidecar exists for as long as the returned connection stays open)."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE g (id INTEGER PRIMARY KEY, n TEXT)")
    conn.execute("INSERT INTO g (n) VALUES ('seed')")
    conn.commit()
    return conn


def _fabricate_stale_sidecars(db_path: Path) -> None:
    """Leave genuinely STALE -wal/-shm next to a closed WAL DB (mimics a crash
    that left sidecars with nothing holding the file), OS-independently: build
    real sidecar bytes, then clean-close (which removes them) and write the
    bytes back so no connection holds the file."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_autocheckpoint=0")
    conn.execute("CREATE TABLE g (id INTEGER PRIMARY KEY, n TEXT)")
    conn.execute("INSERT INTO g (n) VALUES ('seed')")
    conn.commit()
    wal_bytes = _wal(db_path).read_bytes()
    shm_bytes = _shm(db_path).read_bytes() if _shm(db_path).exists() else None
    conn.close()  # clean close removes the sidecars
    _wal(db_path).write_bytes(wal_bytes)
    if shm_bytes is not None:
        _shm(db_path).write_bytes(shm_bytes)


# ---------------------------------------------------------------------------
# Discriminator unit tests (branch a: live -> refuse; branch b: stale -> clear)
# ---------------------------------------------------------------------------

def test_refuses_and_preserves_wal_when_a_live_connection_holds_the_file(tmp_path):
    """Acceptance criterion 1: a live connection's sidecars are NEVER unlinked.
    Asserts the discriminator's contract (refuse + sidecar survives), so it is
    valid on Linux (where a blind unlink WOULD have succeeded) and Windows."""
    db = tmp_path / "profile.sqlite"
    live = _make_wal_db(db)
    try:
        assert _wal(db).exists(), "setup: expected a live -wal sidecar"

        result = clear_wal_sidecars_if_unheld(db)

        assert result is False, "must REFUSE while a live connection holds the file"
        assert _wal(db).exists(), (
            "a live connection's -wal must NOT be unlinked (the T5086 hazard)"
        )
    finally:
        live.close()


def test_clears_genuinely_stale_sidecars_when_no_connection_holds_the_file(tmp_path):
    """Acceptance criterion 2 (no regression): stale sidecars with no live
    holder still clear, and the function reports success so the seam retries."""
    db = tmp_path / "profile.sqlite"
    _fabricate_stale_sidecars(db)
    assert _wal(db).exists(), "setup: expected fabricated stale -wal"

    result = clear_wal_sidecars_if_unheld(db)

    assert result is True, "must proceed when no live connection holds the file"
    assert not _wal(db).exists() and not _shm(db).exists(), (
        "genuinely stale sidecars must be cleared (parity with old behavior)"
    )


def test_fail_loud_and_refuse_on_unexpected_probe_error(tmp_path):
    """Fail-loud: if the probe hits an unexpected error (here a corrupt file
    that is not a database) it REFUSES rather than silently unlinking."""
    db = tmp_path / "profile.sqlite"
    db.write_bytes(b"this is not a sqlite database " * 64)

    assert clear_wal_sidecars_if_unheld(db) is False


def test_probe_never_leaks_the_exclusive_lock(tmp_path):
    """The probe connection must always close — a leaked EXCLUSIVE holder would
    itself block every later retry. After both branches, a fresh connection can
    still take BEGIN IMMEDIATE."""
    # After a successful (stale) clear:
    db = tmp_path / "a.sqlite"
    _fabricate_stale_sidecars(db)
    assert clear_wal_sidecars_if_unheld(db) is True
    after = sqlite3.connect(str(db), timeout=0.5)
    try:
        after.execute("PRAGMA locking_mode=EXCLUSIVE")
        after.execute("BEGIN IMMEDIATE")  # would raise if the probe leaked a lock
        after.execute("COMMIT")
    finally:
        after.close()

    # After a refusal, the ORIGINAL live connection is still the only holder
    # (the probe did not wedge itself in as a second EXCLUSIVE owner): once it
    # closes, the file is immediately acquirable.
    db2 = tmp_path / "b.sqlite"
    live = _make_wal_db(db2)
    assert clear_wal_sidecars_if_unheld(db2) is False
    live.close()
    after2 = sqlite3.connect(str(db2), timeout=0.5)
    try:
        after2.execute("BEGIN IMMEDIATE")
        after2.execute("COMMIT")
    finally:
        after2.close()


# ---------------------------------------------------------------------------
# Seam call-site integration (run_profile_seam / run_user_seam wal_busy retry)
# ---------------------------------------------------------------------------

# Reuse the T5083 seam-test fixtures/helpers (FakeR2 wiring, _reset_registries,
# runner stubs, byte builders) so these exercise the REAL seam functions.
from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER  # noqa: E402
from app.migrations.user_db import RUNNER as USER_DB_RUNNER  # noqa: E402
from tests.test_t4050_durable_sync import FakeR2, _r2_patched  # noqa: E402
from tests.test_t5083_jit_seam import (  # noqa: E402
    PROFILE_HEAD,
    USER_HEAD,
    _build_profile_bytes,
    _build_user_bytes,
    _ctx,
    _profile_r2_key,
    _reset_registries,  # noqa: F401  (autouse fixture)
    _runner_advances_profile_to_head,
    _runner_advances_user_to_head,
    _seed_r2,
    _user_r2_key,
)

USER = "u_t5086"
PROFILE = "5086prof"


def test_profile_seam_wal_busy_live_connection_blocks_without_unlinking(tmp_path):
    """Call-site proof: with a genuinely live connection open on a below-head
    profile.sqlite, `run_profile_seam` must raise MigrationBlocked(wal_busy),
    NOT mark the pair verified, and NOT unlink the live -wal."""
    import app.migrations as migrations_module
    from app.migrations import MigrationBlocked, run_profile_seam

    fake = FakeR2()
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=5), sync_version=5)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx(USER, PROFILE)
        db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_path.write_bytes(_build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=5, tag="pre"))

        live = sqlite3.connect(str(db_path))
        try:
            live.execute("PRAGMA journal_mode=WAL")
            live.execute("INSERT INTO games (name) VALUES ('live')")
            live.commit()
            assert _wal(db_path).exists(), "setup: expected a live -wal sidecar"

            with pytest.raises(MigrationBlocked) as exc:
                run_profile_seam(USER, PROFILE)

            assert exc.value.reason == "wal_busy"
            assert (USER, PROFILE) not in migrations_module._seam_verified, \
                "a wal_busy block must never mark the profile verified-at-head"
            assert _wal(db_path).exists(), \
                "the live connection's -wal must survive the blocked retry (T5086)"
        finally:
            live.close()


def test_user_seam_wal_busy_live_connection_blocks_without_unlinking(tmp_path):
    """user.sqlite sibling of the profile call-site proof."""
    import app.migrations as migrations_module
    from app.migrations import USER_DB_SCOPE, MigrationBlocked, run_user_seam

    fake = FakeR2()
    key = _user_r2_key(USER)
    _seed_r2(fake, key, _build_user_bytes(tmp_path, user_version=USER_HEAD - 1), sync_version=5)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch.object(USER_DB_RUNNER, "run", side_effect=_runner_advances_user_to_head), \
         _r2_patched(fake):
        _ctx(USER, PROFILE)
        from app.services.user_db import _get_user_db_path
        db_path = _get_user_db_path(USER)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_path.write_bytes(_build_user_bytes(tmp_path, user_version=USER_HEAD - 1, tag="upre"))

        live = sqlite3.connect(str(db_path))
        try:
            live.execute("PRAGMA journal_mode=WAL")
            live.execute("INSERT INTO marker (who) VALUES ('live')")
            live.commit()
            assert _wal(db_path).exists(), "setup: expected a live -wal sidecar"

            with pytest.raises(MigrationBlocked) as exc:
                run_user_seam(USER)

            assert exc.value.reason == "wal_busy"
            assert (USER, USER_DB_SCOPE) not in migrations_module._seam_verified
            assert _wal(db_path).exists(), \
                "the live connection's -wal must survive the blocked retry (T5086)"
        finally:
            live.close()


def test_profile_seam_stale_sidecars_still_migrate_no_regression(tmp_path):
    """Regression guard: when the sidecars are genuinely STALE (no live holder)
    the seam clears them and the retry migrates to head — the fix must not
    block the case the old blind unlink handled correctly."""
    import app.migrations as migrations_module
    from app.migrations import run_profile_seam

    fake = FakeR2()
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=5), sync_version=5)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx(USER, PROFILE)
        db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_path.write_bytes(_build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=5, tag="pre"))
        _fabricate_stale_sidecars(db_path)
        assert _wal(db_path).exists(), "setup: expected fabricated stale -wal"

        run_profile_seam(USER, PROFILE)  # must NOT raise

        # Reaching verified proves the retry cleared the stale sidecars and ran
        # the migration (a live-held file would have stayed wal_busy -> block).
        # Note: a FRESH -wal from the migration's own post-clear commits may
        # exist here and is fine — only the STALE one had to be removed.
        assert (USER, PROFILE) in migrations_module._seam_verified, \
            "a stale-sidecar profile must migrate to head and be marked verified"
