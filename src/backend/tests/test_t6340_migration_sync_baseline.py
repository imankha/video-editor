"""
T6340 — the migration runner must establish a confirmed sync baseline for the
canonical R2 profile.sqlite it force-downloads and swaps into place, or NO
profile_db migration can ever reach R2.

The bug (pinned by test 1, RED on pre-fix code): `_migrate_profile_db` downloads
the canonical R2 copy and `shutil.move`s it over the local file, bypassing
`ensure_database`. The R2 object carries NO `db_version` row (the SYNC version
lives in R2 object metadata `x-amz-meta-db-version`, not inside the SQLite file),
so the swapped-in file has no baseline; `get_local_db_version` returns None and
storage.py's CAS guard (BLOCKING-2) refuses the post-migration upload
unconditionally (R2 always has content). T6160 then discards the migrated local
file on next access. Result: v030/v031 stuck at head on staging and prod.

These tests drive the REAL storage.py CAS + version logic against an in-memory
R2 (`FakeR2` / `_r2_patched` reused from test_t4050_durable_sync), so the sync
version metadata, the CAS "unconfirmed baseline" refusal, and the upload/verify
round trip all exercise production code. Only PROFILE_DB_RUNNER.run (the schema
migration SQL itself — NOT where the bug lives) is stubbed to advance
PRAGMA user_version, exactly as test_migration_runner.py (T4830) does.

Test matrix (task kickoff §Tests):
  1. The bug, pinned — swap + re-heal → status ok, R2 at head, sync version N+1.
  2. Content preserved — the migrated R2 object still holds the seeded rows.
  3. CAS still refuses a genuinely stale (non-None baseline) writer → sync_failed
     with the REAL r2_version, not null.
  4. R2VersionResult.ERROR / NOT_FOUND on the version path → no bogus baseline,
     no upload; the enum never leaks into a version field.
  5. Mid-download version move (the window the atomic get_object closes) → the
     recorded baseline is the DOWNLOADED bytes' version, so a concurrent R2 move
     is safely REFUSED (never an older-bytes force-push at a bumped version).
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch

from app.migrations import _migrate_profile_db, _migrate_user
from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER

# Reuse the in-memory R2 harness — the REAL storage.py logic runs against it.
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

HEAD = PROFILE_DB_RUNNER.latest_version


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _r2_profile_key(user_id: str, profile_id: str) -> str:
    from app.storage import APP_ENV
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite"


def _build_profile_bytes(tmp_path: Path, *, user_version: int, games: int = 3,
                         db_version_row: int | None = None, tag: str = "seed") -> bytes:
    """Build a REAL profile.sqlite blob with `games` rows at PRAGMA user_version.

    db_version_row=None (the R2/re-heal case) => NO db_version row in the bytes,
    which is exactly what makes get_local_db_version return None after a swap.
    """
    p = tmp_path / f"{tag}_{user_version}_{games}.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("CREATE TABLE working_clips (id INTEGER PRIMARY KEY, project_id INTEGER)")
    for i in range(games):
        conn.execute("INSERT INTO games (name) VALUES (?)", (f"g{i}",))
    if db_version_row is not None:
        conn.execute(
            "CREATE TABLE db_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)"
        )
        conn.execute("INSERT INTO db_version (id, version) VALUES (1, ?)", (db_version_row,))
    conn.execute(f"PRAGMA user_version = {user_version}")
    conn.commit()
    conn.close()
    data = p.read_bytes()
    p.unlink()
    return data


def _seed_r2_profile(fake: FakeR2, user_id: str, profile_id: str, data: bytes,
                     sync_version: int) -> str:
    key = _r2_profile_key(user_id, profile_id)
    fake._store(key, data, ExtraArgs={"Metadata": {"db-version": str(sync_version)}})
    return key


def _write_local_profile(db_path: Path, *, user_version: int) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute(f"PRAGMA user_version = {user_version}")
    conn.commit()
    conn.close()


def _r2_bytes_user_version(fake: FakeR2, key: str, tmp_path: Path) -> int:
    data = fake._objects[key]["data"]
    p = tmp_path / "readback.sqlite"
    p.write_bytes(data)
    v = sqlite3.connect(str(p)).execute("PRAGMA user_version").fetchone()[0]
    p.unlink()
    return v


def _r2_sync_version(fake: FakeR2, key: str) -> str | None:
    return fake._objects[key]["metadata"].get("db-version")


def _r2_games_count(fake: FakeR2, key: str, tmp_path: Path) -> int:
    data = fake._objects[key]["data"]
    p = tmp_path / "readback_games.sqlite"
    p.write_bytes(data)
    c = sqlite3.connect(str(p)).execute("SELECT COUNT(*) FROM games").fetchone()[0]
    p.unlink()
    return c


def _runner_advances_to_head(conn, db_type):
    """Stub for PROFILE_DB_RUNNER.run: advance PRAGMA user_version to HEAD only if
    behind (idempotent — returns [] when already at head, so a second run is a
    genuine no-op, exactly like the real runner)."""
    cur = conn.execute("PRAGMA user_version").fetchone()[0]
    if cur >= HEAD:
        return []
    conn.execute(f"PRAGMA user_version = {HEAD}")
    conn.commit()

    class _FakeMigration:
        version = HEAD
        description = "t6340-fake-advance"

    return [_FakeMigration()]


def _clear_baseline(user_id: str, profile_id: str) -> None:
    from app.database import set_local_db_version
    set_local_db_version(user_id, profile_id, None)


def _profile_env(tmp_path):
    """Context managers: USER_DATA_BASE at tmp_path, R2 routed at the fake, and the
    schema-migration step stubbed to advance user_version."""
    return (
        patch("app.database.USER_DATA_BASE", tmp_path),
        patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_to_head),
    )


# ---------------------------------------------------------------------------
# 1. THE BUG, PINNED — must be RED before the fix
# ---------------------------------------------------------------------------

def test_swapped_profile_reaches_head_in_r2_after_reheal(tmp_path):
    """R2 profile at sync version N, PRAGMA user_version below head, NO db_version
    row in the bytes (a T6160 re-heal wiped the local baseline). After
    _migrate_profile_db the R2 object must reach head AND advance to sync N+1."""
    user_id, profile_id, N = "t6340u1", "aaaa1111", 7
    fake = FakeR2()
    data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=3)
    key = _seed_r2_profile(fake, user_id, profile_id, data, sync_version=N)
    _clear_baseline(user_id, profile_id)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        result = _migrate_profile_db(user_id, profile_id)

    assert result.status == "ok", f"expected ok, got {result.status} (r2_version={result.r2_version})"
    assert _r2_bytes_user_version(fake, key, tmp_path) == HEAD, "R2 PRAGMA user_version did not reach head"
    assert _r2_sync_version(fake, key) == str(N + 1), \
        f"R2 sync version must advance to {N + 1}, got {_r2_sync_version(fake, key)}"


# ---------------------------------------------------------------------------
# 2. CONTENT PRESERVED — the migration did not ship an empty DB
# ---------------------------------------------------------------------------

def test_migrated_r2_object_preserves_seeded_rows(tmp_path):
    user_id, profile_id, N, games = "t6340u2", "bbbb2222", 4, 5
    fake = FakeR2()
    data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=games)
    key = _seed_r2_profile(fake, user_id, profile_id, data, sync_version=N)
    _clear_baseline(user_id, profile_id)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        result = _migrate_profile_db(user_id, profile_id)

    assert result.status == "ok"
    assert _r2_games_count(fake, key, tmp_path) == games, "seeded rows lost — migration shipped an emptier DB"


# ---------------------------------------------------------------------------
# 3. CAS STILL REFUSES A GENUINELY STALE WRITER (non-None baseline) — guard armed
# ---------------------------------------------------------------------------

def test_stale_local_ahead_branch_still_refused_with_real_r2_version(tmp_path):
    """Local schema is AHEAD of R2 (so the runner takes the sync-up branch), but
    the local SYNC baseline is behind R2 by a REAL (non-None) version. CAS must
    still refuse — and the error row must carry the REAL r2_version, not null."""
    user_id, profile_id = "t6340u3", "cccc3333"
    loaded, r2_sync = 2696, 2697
    fake = FakeR2()
    # R2 is BEHIND on schema (head-1) but AHEAD on sync (2697).
    r2_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=2)
    _seed_r2_profile(fake, user_id, profile_id, r2_data, sync_version=r2_sync)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        from app.database import set_local_db_version
        db_path = tmp_path / user_id / "profiles" / profile_id / "profile.sqlite"
        _write_local_profile(db_path, user_version=HEAD)  # schema AHEAD of R2
        set_local_db_version(user_id, profile_id, loaded)  # confirmed, but stale sync baseline
        result = _migrate_profile_db(user_id, profile_id)

    assert result.status == "sync_failed", f"stale writer must be refused, got {result.status}"
    assert result.r2_version == r2_sync, \
        f"error row must carry the real r2_version {r2_sync}, got {result.r2_version}"


# ---------------------------------------------------------------------------
# 4. R2VersionResult.ERROR / NOT_FOUND — no bogus baseline, no upload, no leak
# ---------------------------------------------------------------------------

def test_missing_r2_object_is_missing_not_a_bogus_baseline(tmp_path):
    """NOT_FOUND: registered profile has no R2 object → status 'missing', nothing
    uploaded, no baseline fabricated."""
    user_id, profile_id = "t6340u4a", "dddd4444"
    fake = FakeR2()  # empty — the profile object does not exist
    _clear_baseline(user_id, profile_id)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        from app.database import get_local_db_version
        result = _migrate_profile_db(user_id, profile_id)
        assert result.status == "missing", f"got {result.status}"
        assert get_local_db_version(user_id, profile_id) is None, "fabricated a baseline for a missing object"
    assert fake.profile_uploads() == [], "uploaded despite a missing R2 object"


def test_transient_download_error_is_download_failed_no_upload(tmp_path):
    """ERROR: a transient R2 failure on the download → status 'download_failed',
    nothing uploaded, no baseline fabricated."""
    user_id, profile_id = "t6340u4b", "eeee5555"
    fake = FakeR2()
    _seed_r2_profile(fake, user_id, profile_id,
                     _build_profile_bytes(tmp_path, user_version=HEAD - 1), sync_version=9)
    _clear_baseline(user_id, profile_id)

    from botocore.exceptions import ClientError

    def _boom(Bucket=None, Key=None):
        raise ClientError({"Error": {"Code": "500", "Message": "transient"}}, "GetObject")

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake), \
         patch.object(fake, "get_object", side_effect=_boom), \
         patch.object(fake, "download_file", side_effect=_boom):
        from app.database import get_local_db_version
        result = _migrate_profile_db(user_id, profile_id)
        assert result.status == "download_failed", f"got {result.status}"
        assert get_local_db_version(user_id, profile_id) is None, "fabricated a baseline on a download error"
    assert fake.profile_uploads() == [], "uploaded despite a download error"


def test_r2_version_or_none_coerces_enum_never_leaks(tmp_path):
    """The error-row version helper must coerce R2VersionResult.{ERROR,NOT_FOUND}
    to None (never leak the enum as a version) and pass a real int through."""
    from app.migrations import _r2_version_or_none
    from app.storage import R2VersionResult

    with patch("app.storage.get_db_version_from_r2", return_value=R2VersionResult.ERROR):
        assert _r2_version_or_none("u", "p") is None
    with patch("app.storage.get_db_version_from_r2", return_value=R2VersionResult.NOT_FOUND):
        assert _r2_version_or_none("u", "p") is None
    with patch("app.storage.get_db_version_from_r2", return_value=2698):
        assert _r2_version_or_none("u", "p") == 2698


# ---------------------------------------------------------------------------
# 5. MID-DOWNLOAD VERSION MOVE — the window the atomic get_object closes
# ---------------------------------------------------------------------------

class _PinnedVersionR2(FakeR2):
    """get_object returns the body with a PINNED (older) db-version while
    head_object reflects the CURRENT (newer) stored metadata — models R2 moving
    forward AFTER our atomic get_object already fetched the older bytes. If the
    runner recorded its baseline from a SEPARATE post-download HEAD it would read
    the newer version and force-push the OLD bytes at a bumped version (a clobber);
    the atomic path records the PINNED version, so CAS refuses instead."""

    def __init__(self, pinned_version: int):
        super().__init__()
        self._pinned = str(pinned_version)

    def get_object(self, Bucket=None, Key=None):
        resp = super().get_object(Bucket=Bucket, Key=Key)
        if Key.endswith("profile.sqlite"):
            resp["Metadata"] = {"db-version": self._pinned}
        return resp


def test_mid_download_move_refuses_never_clobbers(tmp_path):
    user_id, profile_id = "t6340u5", "ffff6666"
    pinned, moved = 30, 35  # bytes are v30; R2 head has already moved to v35
    fake = _PinnedVersionR2(pinned_version=pinned)
    data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=2)
    key = _seed_r2_profile(fake, user_id, profile_id, data, sync_version=moved)
    _clear_baseline(user_id, profile_id)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        result = _migrate_profile_db(user_id, profile_id)

    assert result.status == "sync_failed", f"a moved-ahead R2 must be refused, got {result.status}"
    assert result.r2_version == moved, f"error row must report the moved R2 version {moved}, got {result.r2_version}"
    # No clobber: R2 still holds the ORIGINAL bytes at the ORIGINAL (moved) version.
    assert _r2_sync_version(fake, key) == str(moved), "R2 sync version changed — a stale upload slipped through"
    assert _r2_bytes_user_version(fake, key, tmp_path) == HEAD - 1, \
        "R2 bytes changed — older bytes were force-pushed over newer R2 data (clobber)"
    assert fake.profile_uploads() == [], "an upload occurred despite the mid-download move"


# ---------------------------------------------------------------------------
# QA — full _migrate_user path against a realistic multi-profile user, twice
# ---------------------------------------------------------------------------

def test_qa_migrate_user_multi_profile_converges_and_is_idempotent(tmp_path):
    """Drive _migrate_user end-to-end: one profile at head, one several versions
    behind with real content, one orphan R2 profile not in the registry. Every
    registered profile's R2 object must reach head (migrated, not sync_failed);
    a second run in the same process must be a no-op (idempotent, no churn)."""
    user_id = "t6340qa"
    at_head, behind, orphan = "1111aaaa", "2222bbbb", "9999cccc"
    fake = FakeR2()

    _seed_r2_profile(fake, user_id, at_head,
                     _build_profile_bytes(tmp_path, user_version=HEAD, games=6, tag="head"),
                     sync_version=10)
    behind_key = _seed_r2_profile(
        fake, user_id, behind,
        _build_profile_bytes(tmp_path, user_version=HEAD - 2, games=4, tag="behind"),
        sync_version=20)
    _seed_r2_profile(fake, user_id, orphan,
                     _build_profile_bytes(tmp_path, user_version=HEAD, games=1, tag="orphan"),
                     sync_version=1)
    for pid in (at_head, behind, orphan):
        _clear_baseline(user_id, pid)

    registered = [
        {"id": at_head, "name": "Head", "color": None, "sport": None, "is_default": 1, "created_at": "2026-01-01"},
        {"id": behind, "name": "Behind", "color": None, "sport": None, "is_default": 0, "created_at": "2026-01-01"},
    ]

    from app.migrations import _read_r2_profile_user_version

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake), \
         patch("app.migrations._migrate_user_db", return_value=[]), \
         patch("app.services.user_db.get_profiles", return_value=registered), \
         patch("app.migrations._get_profile_ids", return_value=[at_head, behind, orphan]):

        first = _migrate_user(user_id)

        assert first["errors"] == [], f"unexpected errors: {first['errors']}"
        assert first["any_applied"] is True, "the behind profile should have applied a migration"
        assert orphan in first["orphans"], "orphan not reported"
        assert _read_r2_profile_user_version(user_id, at_head) == HEAD, "at-head profile not at head in R2"
        assert _read_r2_profile_user_version(user_id, behind) == HEAD, "behind profile did not reach head in R2"

        head_sync_after_1 = _r2_sync_version(fake, _r2_profile_key(user_id, at_head))
        behind_sync_after_1 = _r2_sync_version(fake, behind_key)
        assert behind_sync_after_1 == "21", f"behind profile sync must advance 20->21, got {behind_sync_after_1}"

        # Second run in the SAME process: idempotent, no churn.
        second = _migrate_user(user_id)
        assert second["errors"] == [], f"second run errors: {second['errors']}"
        assert second["any_applied"] is False, "second run applied migrations — not idempotent"
        assert _r2_sync_version(fake, _r2_profile_key(user_id, at_head)) == head_sync_after_1, "at-head churned"
        assert _r2_sync_version(fake, behind_key) == behind_sync_after_1, "behind profile churned on re-run"
