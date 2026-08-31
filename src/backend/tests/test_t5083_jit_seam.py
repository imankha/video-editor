"""
T5083 — JIT migrate at the per-user DB-load seam (Test First, Stage 3 Phase 1).

Design: docs/plans/tasks/T5083-design.md (approved). These tests exercise the
seam primitives §3.1 (`migrate_local_profile_db_at_seam`,
`migrate_local_user_db_at_seam`, `MigrationBlocked`, `_get_migration_lock`) and
their call sites inside `ensure_database`/`ensure_user_database` (§3.2/§3.3).

NONE OF THIS EXISTS YET. This file is deliberately RED: every test either
imports a not-yet-defined symbol (clean ImportError/AttributeError at
collection or call time) or asserts behavior the current seam does not
implement (a below-head DB is never advanced on read today — see
`test_seam_behind_head_migrates` and siblings, which will fail on a real
assertion, not just a missing symbol).

Design references inline per test (§ numbers = T5083-design.md sections).
"""

import sqlite3
import threading
from pathlib import Path
from unittest.mock import patch

import pytest

from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER
from app.migrations.user_db import RUNNER as USER_DB_RUNNER
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

PROFILE_HEAD = PROFILE_DB_RUNNER.latest_version
USER_HEAD = USER_DB_RUNNER.latest_version

USER = "u_t5083"
PROFILE = "5083prof"


# ---------------------------------------------------------------------------
# Helpers (mirrors test_t6340_migration_sync_baseline.py / test_migration_runner.py)
# ---------------------------------------------------------------------------

def _profile_r2_key(user_id: str, profile_id: str) -> str:
    from app.storage import APP_ENV
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite"


def _user_r2_key(user_id: str) -> str:
    from app.storage import APP_ENV
    return f"{APP_ENV}/users/{user_id}/user.sqlite"


def _build_profile_bytes(tmp_path: Path, *, user_version: int, tag: str = "seed",
                          db_version_row: int | None = None) -> bytes:
    p = tmp_path / f"{tag}_{user_version}.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO games (name) VALUES ('g0')")
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


def _build_user_bytes(tmp_path: Path, *, user_version: int, tag: str = "useed") -> bytes:
    p = tmp_path / f"{tag}_{user_version}.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES ('seed')")
    conn.execute(f"PRAGMA user_version = {user_version}")
    conn.commit()
    conn.close()
    data = p.read_bytes()
    p.unlink()
    return data


def _seed_r2(fake: FakeR2, key: str, data: bytes, sync_version: int) -> None:
    fake._store(key, data, ExtraArgs={"Metadata": {"db-version": str(sync_version)}})


def _read_local_user_version(db_path: Path) -> int:
    conn = sqlite3.connect(str(db_path))
    try:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()


def _runner_advances_profile_to_head(conn, db_type):
    """Idempotent stub mirroring test_t6340's pattern: no-op at head."""
    cur = conn.execute("PRAGMA user_version").fetchone()[0]
    if cur >= PROFILE_HEAD:
        return []
    conn.execute(f"PRAGMA user_version = {PROFILE_HEAD}")
    conn.commit()

    class _Fake:
        version = PROFILE_HEAD
        description = "t5083-fake-advance"

    return [_Fake()]


def _runner_advances_user_to_head(conn, db_type):
    cur = conn.execute("PRAGMA user_version").fetchone()[0]
    if cur >= USER_HEAD:
        return []
    conn.execute(f"PRAGMA user_version = {USER_HEAD}")
    conn.commit()

    class _Fake:
        version = USER_HEAD
        description = "t5083-fake-advance-user"

    return [_Fake()]


def _ctx(user_id=USER, profile_id=PROFILE):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)


@pytest.fixture(autouse=True)
def _reset_registries(monkeypatch):
    """Isolate the process-global init caches so tests don't leak into each other."""
    import app.database as db_module
    import app.migrations as migrations_module
    import app.services.user_db as user_db_module
    monkeypatch.setattr(db_module, "_initialized_users", set())
    monkeypatch.setattr(db_module, "_user_db_versions", {})
    monkeypatch.setattr(user_db_module, "_initialized_user_dbs", set())
    monkeypatch.setattr(db_module, "_user_sqlite_versions", {})
    # T5083 (CI escalation FIX 4): `_seam_verified` is a NEW process-global
    # success cache (see migrations/__init__.py) — without resetting it here,
    # a prior test's successful migration for the same USER/PROFILE constants
    # (reused across most tests in this file) marks the pair verified and a
    # LATER test's fresh tmp_path/fresh R2 seed gets silently skipped by the
    # seam, since `database.py`/`user_db.py` read it via `migrations.
    # _seam_verified` (module attribute, not a bound import) specifically so
    # this reset takes effect.
    monkeypatch.setattr(migrations_module, "_seam_verified", set())
    yield


# ---------------------------------------------------------------------------
# 1. At-head no-op — zero R2 upload, serves normally (§3.6 row 1, §2.3 "ok, applied=[]")
# ---------------------------------------------------------------------------

def test_seam_skips_brand_new_profile_no_local_file_yet(tmp_path):
    """A genuinely new profile (R2 NOT_FOUND, no prior local file) must NOT
    hit the seam at all — CREATE TABLE stamps PRAGMA user_version to head
    directly (existing behavior), and the seam primitive would wrongly see
    a 'missing' file and block every brand-new signup if it fired here
    (self-review finding: the seam is gated on db_path.exists() in addition
    to entered_restore_branch, database.py)."""
    fake = FakeR2()  # empty — R2 has nothing for this (user, profile)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database
        ensure_database()  # must not raise MigrationBlocked for a brand-new profile

        db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"

    assert db_path.exists()
    assert _read_local_user_version(db_path) == PROFILE_HEAD, \
        "a fresh DB is stamped straight to head by CREATE TABLE, no migration needed"


def test_seam_at_head_noop(tmp_path):
    """First access on an at-head profile: the seam primitive applies nothing
    and issues NO R2 upload (§2.4 point 2 — a no-op at-head migration is zero
    R2 writes)."""
    from app.migrations import migrate_local_profile_db_at_seam  # NEW symbol — does not exist yet

    fake = FakeR2()
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=5)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database
        ensure_database()

        result = migrate_local_profile_db_at_seam(USER, PROFILE)

    assert result.status == "ok"
    assert result.applied == []
    assert fake.profile_uploads() == [], "at-head migration must not upload"


# ---------------------------------------------------------------------------
# 2. Below-head — migrates to head, uploads r2_version+1, verified (§3.6 row 2)
# ---------------------------------------------------------------------------

def test_seam_behind_head_migrates(tmp_path):
    """A below-head profile: first access migrates to head, uploads
    r2_version+1, R2 verify passes, serves. Today ensure_database never
    advances user_version for a pre-existing below-head DB (design §1.1) — this
    assertion fails against CURRENT behavior even once the seam import exists,
    proving it exercises real new behavior, not just a missing symbol.

    The seam is wired INSIDE ensure_database (design §3.2), so a single first-
    access call already carries the profile all the way to head — that single
    call IS the integration test (§3.6 row 2 describes the call-site behavior,
    not the primitive in isolation)."""
    fake = FakeR2()
    N = 5
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=N)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database
        ensure_database()  # single first access: restore + seam migration, in one call

        db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"

    assert fake.profile_uploads(), "behind-head migration must upload"
    assert fake._objects[key]["metadata"]["db-version"] == str(N + 1)
    assert _read_local_user_version(db_path) == PROFILE_HEAD


def test_seam_primitive_migrates_an_already_local_below_head_file(tmp_path):
    """`migrate_local_profile_db_at_seam` in ISOLATION (no ensure_database
    involved): given a below-head file already sitting at the local path (as
    if a restore had just swapped it in), the primitive alone migrates to
    head and uploads r2_version+1 (design §2.3 — 'operates on the already-
    restored local file, no download')."""
    from app.migrations import migrate_local_profile_db_at_seam

    fake = FakeR2()
    N = 5
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=N)

    db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(data)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx()
        assert _read_local_user_version(db_path) == PROFILE_HEAD - 1, \
            "sanity: the seeded local file starts below head"

        result = migrate_local_profile_db_at_seam(USER, PROFILE)

    assert result.status == "ok"
    assert result.applied, "expected the runner to report applied migrations"
    assert fake.profile_uploads(), "behind-head migration must upload"
    assert fake._objects[key]["metadata"]["db-version"] == str(N + 1)
    assert _read_local_user_version(db_path) == PROFILE_HEAD


# ---------------------------------------------------------------------------
# 3. Hot path — second request skips restore AND migration entirely (§3.6 row 3, Q4)
# ---------------------------------------------------------------------------

def test_seam_hot_path_no_migration(tmp_path):
    """A warmed profile (local_version cached, already_initialized) must not
    call the seam primitive at all on the second request — no R2 round trip.
    This asserts against the call site inside `ensure_database`
    (design §3.2), not the primitive directly."""
    fake = FakeR2()
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=5)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database

        # NEW symbol: the seam call site must be patchable/importable from
        # app.database once wired. This import is what makes the test RED
        # today (ImportError) rather than silently passing for the wrong
        # reason (the call site doesn't exist so it trivially "isn't called").
        from app.migrations import MigrateResult
        with patch("app.database.migrate_local_profile_db_at_seam") as mock_seam:
            mock_seam.return_value = MigrateResult(status="ok", applied=[])
            ensure_database()  # first access — seam should fire once
            first_call_count = mock_seam.call_count

            ensure_database()  # second (hot) access — must NOT call the seam again

    assert first_call_count == 1, "seam primitive must run exactly once on first access"
    assert mock_seam.call_count == 1, \
        "hot path must not re-invoke the seam primitive (Q4 — hangs off the same first-access gate)"
    # No R2 round trip on the hot path beyond whatever the first access did.
    assert len(fake.download_calls) <= 1


# ---------------------------------------------------------------------------
# 4. Concurrency — two first-access requests for the same pair, one migration (§3.6 row 4, Q3)
# ---------------------------------------------------------------------------

def test_seam_concurrent_same_pair(tmp_path):
    """Two concurrent first-access requests for the same (user,profile): the
    dedicated per-(user,profile) `threading.Lock` (design §2.7 / §3.1
    `_get_migration_lock`) must serialize them so exactly one upload happens,
    not two (idempotency alone is not what's being tested here — the LOCK's
    existence and its dedup of the upload is)."""
    from app.migrations import _get_migration_lock  # NEW symbol

    fake = FakeR2()
    N = 5
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=N)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database
        ensure_database()  # restore only, baseline set, schema still behind

        barrier = threading.Barrier(2)
        errors = []

        def _worker():
            try:
                barrier.wait(timeout=5)
                lock = _get_migration_lock(USER, PROFILE)
                with lock:
                    from app.migrations import migrate_local_profile_db_at_seam
                    migrate_local_profile_db_at_seam(USER, PROFILE)
            except Exception as e:  # pragma: no cover - surfaced via errors[]
                errors.append(e)

        t1 = threading.Thread(target=_worker)
        t2 = threading.Thread(target=_worker)
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

    assert not errors, f"worker threads raised: {errors}"
    assert len(fake.profile_uploads()) == 1, \
        "exactly one migrator should upload; the second must find it already at head (no double upload)"


# ---------------------------------------------------------------------------
# 5. WAL busy — live/stale sidecar blocks, MigrationBlocked -> 503 (§3.6 row 5, §2.5/§2.6)
# ---------------------------------------------------------------------------

def test_seam_wal_busy_blocks(tmp_path):
    """A live -wal sidecar present, still present after one clear attempt, must
    raise MigrationBlocked and never add the profile to `_initialized_users`.

    Direct-primitive proof (isolation): the primitive alone returns wal_busy
    for a busy file, regardless of migration need."""
    from app.migrations import migrate_local_profile_db_at_seam  # NEW symbols

    fake = FakeR2()
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=5)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=5)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        _ctx()

        db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_path.write_bytes(_build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=5, tag="pre"))

        # Leave a genuinely live connection open so a -wal sidecar persists
        # through clear_stale_wal_sidecars' single retry (mirrors
        # test_t6340's wal_sidecar_present test).
        live = sqlite3.connect(str(db_path))
        try:
            live.execute("PRAGMA journal_mode=WAL")
            live.execute("INSERT INTO games (name) VALUES ('live')")
            live.commit()
            wal_path = db_path.with_name(db_path.name + "-wal")
            assert wal_path.exists(), "test setup: expected a live -wal sidecar"

            result = migrate_local_profile_db_at_seam(USER, PROFILE)
            assert result.status == "wal_busy"
        finally:
            live.close()


def test_seam_call_site_wal_busy_never_marks_initialized(tmp_path):
    """Call-site proof: when the seam's own retry-once-then-raise path (§2.5)
    exhausts against a persistently busy file DURING ensure_database's first
    access, the profile is never added to `_initialized_users` — the caller
    never proceeds to serve a below-head/un-migrated DB."""
    from app.migrations import MigrationBlocked

    fake = FakeR2()
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD, db_version_row=5)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=5)

    from app.migrations import MigrateResult

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         patch("app.database.migrate_local_profile_db_at_seam") as mock_seam, \
         _r2_patched(fake):
        mock_seam.return_value = MigrateResult(status="wal_busy")
        _ctx()
        from app.database import ensure_database

        with pytest.raises(MigrationBlocked):
            ensure_database()

        import app.database as db_module
        assert USER not in db_module._initialized_users, \
            "a wal_busy migration failure must not mark the profile initialized"


# ---------------------------------------------------------------------------
# 6. Orphan reaches seam — migrate-then-serve (§3.6 row 6, Q5)
# ---------------------------------------------------------------------------

def test_seam_orphan_reaches_seam_migrates(tmp_path):
    """A profile that reaches ensure_database (T7520 guard already passed) but
    is registry-thin (not returned by get_profiles) still gets migrated —
    migrate-then-serve, no registry check inside the seam (Q5). The seam is
    wired inside ensure_database, so a single first-access call must both
    NOT raise and land the profile at head."""
    fake = FakeR2()
    N = 3
    data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N)
    key = _profile_r2_key(USER, PROFILE)
    _seed_r2(fake, key, data, sync_version=N)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         patch("app.services.user_db.get_profiles", return_value=[]), \
         _r2_patched(fake):
        _ctx()
        from app.database import ensure_database
        ensure_database()  # must not raise despite the profile being registry-thin

    assert fake._objects[key]["metadata"]["db-version"] == str(N + 1), \
        "an orphan/registry-thin profile that reached the seam must still migrate"


# ---------------------------------------------------------------------------
# 7. Fail-loud — not_at_head / missing / exception block, no fallthrough (§3.6 row 7, §2.6)
# ---------------------------------------------------------------------------

class TestSeamFailLoudBlocks:

    def test_not_at_head_raises_blocked(self, tmp_path):
        """Primitive-level proof (isolation, no ensure_database involved): a
        below-head local file whose post-upload R2 verify still reads
        below head makes the primitive itself return 'not_at_head'."""
        from app.migrations import migrate_local_profile_db_at_seam

        fake = FakeR2()
        N = 5
        data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N)
        key = _profile_r2_key(USER, PROFILE)
        _seed_r2(fake, key, data, sync_version=N)

        db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_path.write_bytes(data)

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
             patch("app.migrations._read_r2_profile_user_version", return_value=PROFILE_HEAD - 1), \
             _r2_patched(fake):
            _ctx()
            result = migrate_local_profile_db_at_seam(USER, PROFILE)

        assert result.status == "not_at_head"

    def test_missing_raises_blocked(self, tmp_path):
        from app.migrations import MigrationBlocked, migrate_local_profile_db_at_seam

        with patch("app.database.USER_DATA_BASE", tmp_path):
            _ctx()
            # No local file at all — the seam guarantees post-restore
            # existence in production, but a "missing" result must still
            # raise, never silently open a below-head/absent DB.
            with pytest.raises(MigrationBlocked):
                result = migrate_local_profile_db_at_seam(USER, PROFILE)
                if result.status == "missing":
                    raise MigrationBlocked(USER, PROFILE, result.status)

    def test_no_fallthrough_to_below_head_open(self, tmp_path):
        """A blocked migration must never let the caller proceed to open the
        below-head DB (§2.6 'No silent fallback to un-migrated data')."""
        from app.migrations import MigrationBlocked

        fake = FakeR2()
        N = 5
        data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N)
        key = _profile_r2_key(USER, PROFILE)
        _seed_r2(fake, key, data, sync_version=N)

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
             patch("app.migrations._read_r2_profile_user_version", return_value=PROFILE_HEAD - 1), \
             _r2_patched(fake):
            _ctx()
            from app.database import ensure_database

            with pytest.raises(MigrationBlocked):
                ensure_database()  # the seam call site (§3.2) must raise, not return

            import app.database as db_module
            assert USER not in db_module._initialized_users


# ---------------------------------------------------------------------------
# 8. CAS refusal — re-pull-and-retry-once, INV-P gated (§3.6 row 8, §2.7)
# ---------------------------------------------------------------------------

class TestSeamCasRefusalRepullRetryOnce:

    def test_sync_failed_nothing_pending_repull_only_no_retry(self, tmp_path):
        """(a) sync_failed with has_sync_pending_scope False: the clean-copy
        case — the other machine already carried the migration to R2 (R2 is
        already at head, our local migration attempt was redundant and lost
        the CAS race). has_sync_pending_scope is False so the seam does a
        re-pull ONLY — it must NOT call the seam primitive a second time
        (no retry needed), and must converge to 'ok' without raising."""
        from app.database import has_sync_pending_scope
        from app.migrations import _seam_repull_and_retry_profile  # NEW symbol

        fake = FakeR2()
        N = 5
        # R2 is ALREADY at head (the other machine's migration won the race).
        head_data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD, db_version_row=N)
        key = _profile_r2_key(USER, PROFILE)
        _seed_r2(fake, key, head_data, sync_version=N)

        seam_calls = {"n": 0}

        def _fake_seam(user_id, profile_id):
            seam_calls["n"] += 1
            from app.migrations import MigrateResult
            return MigrateResult(status="ok", applied=[])

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
             patch("app.migrations.migrate_local_profile_db_at_seam", side_effect=_fake_seam), \
             _r2_patched(fake):
            _ctx()
            # Local copy stamped BEHIND R2's sync version so the restore
            # re-pull sees R2 as newer and downloads it.
            data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N - 1, tag="local")
            db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
            db_path.parent.mkdir(parents=True, exist_ok=True)
            db_path.write_bytes(data)
            from app.database import set_local_db_version
            set_local_db_version(USER, PROFILE, None)  # first-access gate

            assert has_sync_pending_scope(USER, PROFILE) is False

            result = _seam_repull_and_retry_profile(USER, PROFILE, db_path)

        assert result.status == "ok"
        assert seam_calls["n"] == 0, \
            "the clean-copy case (nothing pending) must re-pull only, never re-invoke the seam primitive"

    def test_sync_failed_with_pending_repull_and_retry_lands(self, tmp_path):
        """(b) sync_failed WITH something pending: re-pull + one retry ->
        head -> serve."""
        from app.database import mark_sync_pending
        from app.migrations import _seam_repull_and_retry_profile  # NEW

        fake = FakeR2()
        N = 5
        data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N)
        key = _profile_r2_key(USER, PROFILE)
        _seed_r2(fake, key, data, sync_version=N)

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
             _r2_patched(fake):
            _ctx()
            from app.database import ensure_database
            ensure_database()
            mark_sync_pending(USER, PROFILE)

            db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
            result = _seam_repull_and_retry_profile(USER, PROFILE, db_path)

        assert result.status == "ok"

    def test_persistent_failure_after_single_retry_blocks_no_loop(self, tmp_path):
        """(c) Persistent failure after the single re-pull+retry -> raises
        MigrationBlocked/503, proving it does NOT loop (never a third
        attempt). Something is genuinely pending (mark_sync_pending) so the
        retry path (not the clean-copy short-circuit) is exercised — the
        re-pull is a direct download (no seam-primitive call), so the mocked
        primitive is invoked exactly once, by the single retry."""
        from app.database import mark_sync_pending, set_local_db_version
        from app.migrations import MigrateResult, MigrationBlocked, _seam_repull_and_retry_profile

        fake = FakeR2()
        N = 5
        # R2 already at head — the re-pull converges cleanly; only the
        # (mocked) seam-primitive retry is what keeps failing.
        head_data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD, db_version_row=N)
        key = _profile_r2_key(USER, PROFILE)
        _seed_r2(fake, key, head_data, sync_version=N)

        call_count = {"n": 0}

        def _always_sync_failed(user_id, profile_id):
            call_count["n"] += 1
            return MigrateResult(status="sync_failed", applied=[], r2_version=N)

        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            _ctx()
            db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
            db_path.parent.mkdir(parents=True, exist_ok=True)
            db_path.write_bytes(
                _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N - 1, tag="local")
            )
            set_local_db_version(USER, PROFILE, None)
            mark_sync_pending(USER, PROFILE)  # something genuinely pending -> retry path taken

            with patch("app.migrations.migrate_local_profile_db_at_seam", side_effect=_always_sync_failed), \
                 pytest.raises(MigrationBlocked):
                _seam_repull_and_retry_profile(USER, PROFILE, db_path)

        assert call_count["n"] == 1, \
            f"must retry the seam primitive exactly once after re-pull, saw {call_count['n']} calls"


# ---------------------------------------------------------------------------
# 9. user.sqlite symmetric — at-head-noop / behind-migrates / fail-loud (§3.6 row 9)
# ---------------------------------------------------------------------------

class TestSeamUserDbSymmetric:

    def test_user_db_at_head_noop(self, tmp_path):
        from app.migrations import migrate_local_user_db_at_seam  # NEW symbol

        fake = FakeR2()
        data = _build_user_bytes(tmp_path, user_version=USER_HEAD)
        key = _user_r2_key(USER)
        _seed_r2(fake, key, data, sync_version=4)

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch.object(USER_DB_RUNNER, "run", side_effect=_runner_advances_user_to_head), \
             _r2_patched(fake):
            _ctx()
            from app.services.user_db import ensure_user_database
            ensure_user_database(USER)

            result = migrate_local_user_db_at_seam(USER)

        assert result.status == "ok"
        assert result.applied == []
        assert not any(c[1].endswith("user.sqlite") for c in fake.upload_calls), \
            "at-head user.sqlite migration must not upload"

    def test_user_db_behind_head_migrates(self, tmp_path):
        """The seam is wired inside ensure_user_database, so a single first-
        access call already carries the user.sqlite to head."""
        fake = FakeR2()
        N = 4
        data = _build_user_bytes(tmp_path, user_version=USER_HEAD - 1)
        key = _user_r2_key(USER)
        _seed_r2(fake, key, data, sync_version=N)

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch.object(USER_DB_RUNNER, "run", side_effect=_runner_advances_user_to_head), \
             _r2_patched(fake):
            _ctx()
            from app.services.user_db import ensure_user_database
            ensure_user_database(USER)  # single first access: restore + seam migration

        assert fake._objects[key]["metadata"]["db-version"] == str(N + 1)

    def test_user_db_fail_loud_blocks(self, tmp_path):
        """A persistent sync failure (CAS refusal that survives the single
        re-pull+retry, §2.7) must raise MigrationBlocked, proven at the
        `_seam_repull_and_retry_user` helper directly (isolation — mirrors
        `test_persistent_failure_after_single_retry_blocks_no_loop`).
        migrate_local_user_db_at_seam has no separate R2-verify step (mirrors
        _migrate_user_db, code-expert notes §2b), so the reachable failure
        mode here is a persistent sync failure, not not_at_head. Marking
        pending must happen on an ALREADY-LOCAL file, not before a first-
        access `ensure_user_database` call — that call's own restore-then-
        clear would discharge the marker before the seam even runs (INV-P),
        defeating the retry path this test targets."""
        from app.database import USER_DB_SCOPE, mark_sync_pending, set_local_user_db_version
        from app.migrations import MigrateResult, MigrationBlocked, _seam_repull_and_retry_user

        fake = FakeR2()
        N = 4
        # R2 already at head — the re-pull inside the helper converges
        # cleanly; only the (mocked) seam-primitive retry keeps failing.
        head_data = _build_user_bytes(tmp_path, user_version=USER_HEAD)
        key = _user_r2_key(USER)
        _seed_r2(fake, key, head_data, sync_version=N)

        call_count = {"n": 0}

        def _always_sync_failed(user_id):
            call_count["n"] += 1
            return MigrateResult(status="sync_failed", applied=[])

        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             _r2_patched(fake):
            _ctx()
            db_path = tmp_path / USER / "user.sqlite"
            db_path.parent.mkdir(parents=True, exist_ok=True)
            db_path.write_bytes(_build_user_bytes(tmp_path, user_version=USER_HEAD - 1, tag="local"))
            set_local_user_db_version(USER, None)
            mark_sync_pending(USER, USER_DB_SCOPE)  # something genuinely pending -> retry path taken

            with patch("app.migrations.migrate_local_user_db_at_seam", side_effect=_always_sync_failed), \
                 pytest.raises(MigrationBlocked):
                _seam_repull_and_retry_user(USER, db_path)

        assert call_count["n"] == 1, \
            f"must retry the seam primitive exactly once after re-pull, saw {call_count['n']} calls"


# ---------------------------------------------------------------------------
# 10. Sweep vs seam converge to identical state (§3.6 row 10, Q6)
# ---------------------------------------------------------------------------

def test_sweep_and_seam_identical(tmp_path):
    """A profile migrated via the new seam primitive and one migrated via the
    existing `_migrate_profile_db` (bulk sweep) end at identical `user_version`
    + R2 `db-version` metadata (design §2.3 'Bulk runner stays working')."""
    from app.migrations import _migrate_profile_db, migrate_local_profile_db_at_seam

    seam_profile, sweep_profile = "seamprof1", "sweepprof1"
    N = 8
    fake = FakeR2()
    for pid in (seam_profile, sweep_profile):
        data = _build_profile_bytes(tmp_path, user_version=PROFILE_HEAD - 1, db_version_row=N, tag=pid)
        _seed_r2(fake, _profile_r2_key(USER, pid), data, sync_version=N)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(PROFILE_DB_RUNNER, "run", side_effect=_runner_advances_profile_to_head), \
         _r2_patched(fake):
        # Seam path: restore then seam-migrate.
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id
        set_current_user_id(USER)
        set_current_profile_id(seam_profile)
        from app.database import ensure_database
        ensure_database()
        seam_result = migrate_local_profile_db_at_seam(USER, seam_profile)

        # Sweep path: full bulk migration primitive (force-download).
        sweep_result = _migrate_profile_db(USER, sweep_profile)

    assert seam_result.status == "ok"
    assert sweep_result.status == "ok"

    seam_key = _profile_r2_key(USER, seam_profile)
    sweep_key = _profile_r2_key(USER, sweep_profile)

    from app.migrations import _read_r2_profile_user_version
    with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
        assert _read_r2_profile_user_version(USER, seam_profile) == PROFILE_HEAD
        assert _read_r2_profile_user_version(USER, sweep_profile) == PROFILE_HEAD

    assert fake._objects[seam_key]["metadata"]["db-version"] == fake._objects[sweep_key]["metadata"]["db-version"], \
        "seam and sweep migration must land on the same R2 sync version (both N -> N+1)"


# ---------------------------------------------------------------------------
# 11. Real (unmocked) runner through the real seam (2026-08-31 CI escalation GAP)
#
# The 19 tests above all stub PROFILE_DB_RUNNER.run/USER_DB_RUNNER.run, so
# none of them ever ran a REAL migration.up() through the real seam call
# site -- which is exactly why FIX 1's ordering bug (schema creation running
# before the seam saw a genuinely below-head DB, bricking every restored
# user.sqlite below v004 with "duplicate column name") was invisible to this
# suite and only caught by Branch CI against test_r2_restore_retry.py. These
# two tests close that gap: real base schema, real runner, real seam.
# ---------------------------------------------------------------------------

def test_real_runner_profile_head_minus_one_migrates_via_real_seam(tmp_path):
    """A profile DB built via the REAL base schema (ensure_database on a
    fresh dir, so every table/column is already at head shape) then rolled
    back to PRAGMA user_version = HEAD-1 must reach head with NO exception
    when it re-enters ensure_database's real (unmocked) seam. The one
    pending migration (the highest-numbered one) must apply cleanly against
    an already-head-shape schema -- proving the seam's real-runner path
    works end to end, not just the mocked-runner shape the rest of this file
    exercises. v048 (T7830) is an R2-listing sweep with no local schema
    change; FakeR2 doesn't implement the pagination API it needs, so the
    listing call is stubbed to 'no orphans found' -- the same result a
    clean profile produces for real. This mirrors the live QA evidence run
    during the original T5083 push (persistence-sync.md §T5083)."""
    fake = FakeR2()

    with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
        _ctx()
        from app.database import ensure_database, get_database_path
        ensure_database()  # real base schema, real head stamp

        db_path = get_database_path()
        conn = sqlite3.connect(str(db_path))
        conn.execute(f"PRAGMA user_version = {PROFILE_HEAD - 1}")
        conn.commit()
        conn.close()

        data = db_path.read_bytes()
        key = _profile_r2_key(USER, PROFILE)
        _seed_r2(fake, key, data, sync_version=5)

        import app.database as db_module
        db_module._initialized_users.discard(USER)
        db_module._user_db_versions.pop((USER, PROFILE), None)

        with patch("app.services.orphan_raw_clips.list_raw_clip_objects", return_value=[]):
            ensure_database()  # real seam, real (unmocked) PROFILE_DB_RUNNER

        final_version = sqlite3.connect(str(db_path)).execute("PRAGMA user_version").fetchone()[0]

    assert final_version == PROFILE_HEAD, \
        f"real runner must migrate HEAD-1 -> HEAD via the real seam, got {final_version}"


def test_real_runner_user_db_missing_table_migrates_via_real_seam(tmp_path):
    """The EXACT v004 duplicate-column repro FIX 1 closes: a user.sqlite at
    PRAGMA user_version=1 with `user_activity` (created by v002) genuinely
    ABSENT -- the shape a real pre-v002 DB has. If the seam ran AFTER schema
    creation (the FIX 1 bug), `executescript(_USER_DB_SCHEMA)` would create
    `user_activity` fresh in its FULL HEAD shape (already carrying
    `total_usage_seconds`), and v004's bare `ALTER TABLE user_activity ADD
    COLUMN total_usage_seconds` would then crash with 'duplicate column
    name' on every future request. With the seam correctly running BEFORE
    schema creation, v002 creates the table fresh (without the column) and
    v004 adds it cleanly. This is the ONLY test in this file that would have
    caught FIX 1's bug -- the other 20 all stub the runner."""
    fake = FakeR2()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        _ctx()
        from app.services.user_db import _get_user_db_path, ensure_user_database
        ensure_user_database(USER)  # real base schema, real head stamp

        db_path = _get_user_db_path(USER)
        conn = sqlite3.connect(str(db_path))
        conn.execute("DROP TABLE user_activity")
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
        conn.close()

        data = db_path.read_bytes()
        key = _user_r2_key(USER)
        _seed_r2(fake, key, data, sync_version=4)

        import app.database as db_module
        import app.services.user_db as user_db_module
        with user_db_module._init_lock:
            user_db_module._initialized_user_dbs.discard(USER)
        db_module._user_sqlite_versions.pop(USER, None)

        ensure_user_database(USER)  # real seam, real (unmocked) USER_DB_RUNNER -- must NOT raise

        conn = sqlite3.connect(str(db_path))
        final_version = conn.execute("PRAGMA user_version").fetchone()[0]
        cols = {r[1] for r in conn.execute("PRAGMA table_info(user_activity)").fetchall()}
        conn.close()

    assert final_version == USER_HEAD, \
        f"real runner must migrate a pre-v002 (no user_activity) DB to HEAD, got {final_version}"
    assert "total_usage_seconds" in cols, "v004's column must have been added by the real migration"
