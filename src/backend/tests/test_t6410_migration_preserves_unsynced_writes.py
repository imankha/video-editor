"""
T6410 — the migration runner must NOT swap R2's bytes over a local profile.sqlite
that is not provably BEHIND R2 on the SYNC baseline. Doing so discards committed
local writes that never uploaded (deferred/failed sync), and post-T6340 that
discard becomes the canonical copy (uploads at r2_version+1). The fix keeps local,
migrates it in place, and lets the existing post-migration sync carry the schema
migration AND the pending writes up to R2 together.

Root cause & design: docs/plans/tasks/T6410-... kickoff. `_migrate_profile_db`
decided swap-vs-keep by comparing SCHEMA versions (PRAGMA user_version), which say
nothing about DATA recency. A local file with unsynced writes has the SAME schema
as R2 and the SAME sync baseline (a local write never advances the baseline — only
a successful upload/restore does), so it fell into the `else` swap branch and its
bytes were destroyed. The new `elif` gates the swap on the sync baseline instead:
swap only when R2 is strictly newer than the local copy's confirmed baseline
(a None/0 baseline counts as behind, preserving T6340's original guarantee).

These tests drive the REAL storage.py CAS + version logic against an in-memory R2
(FakeR2 / _r2_patched, reused from test_t4050_durable_sync). Only
PROFILE_DB_RUNNER.run (the schema-migration SQL — NOT where the bug lives) is
stubbed, exactly as the T6340 suite does.

Landmine: `_user_db_versions` (database.py) is a PROCESS-GLOBAL baseline cache keyed
by (user_id, profile_id) that survives across tests even though tmp_path does not.
Every test below uses a UNIQUE user_id and sets/clears its baseline explicitly.
"""

import sqlite3
from pathlib import Path

# Reuse the T6340 harness verbatim (kickoff §Regression tests).
from tests.test_t6340_migration_sync_baseline import (
    HEAD,
    _build_profile_bytes,
    _clear_baseline,
    _profile_env,
    _r2_bytes_user_version,
    _r2_games_count,
    _r2_profile_key,
    _r2_sync_version,
    _seed_r2_profile,
)
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

from app.migrations import _migrate_profile_db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_local_bytes(db_path: Path, data: bytes) -> None:
    """Drop a prebuilt profile.sqlite blob at the local path (no WAL sidecar,
    no live connection — models a quiescent local file with unsynced writes)."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(data)


def _local_games_count(db_path: Path) -> int:
    conn = sqlite3.connect(str(db_path))
    try:
        return conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    finally:
        conn.close()


def _local_user_version(db_path: Path) -> int:
    conn = sqlite3.connect(str(db_path))
    try:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()


def _db_path(tmp_path: Path, user_id: str, profile_id: str) -> Path:
    return tmp_path / user_id / "profiles" / profile_id / "profile.sqlite"


# ---------------------------------------------------------------------------
# 1. RED-first pin — unsynced local writes survive AND reach R2
# ---------------------------------------------------------------------------

def test_unsynced_local_writes_preserved_and_uploaded(tmp_path):
    """R2 at schema HEAD-1, sync N, 3 seeded rows. Local = same schema + same rows
    PLUS one extra unsynced row (4 rows), confirmed baseline == N (== R2). The local
    copy is NOT behind R2 on sync, so it must be kept and migrated in place, not
    swapped away. After the run: status ok; the local file still has the extra row;
    the R2 object ALSO has it, at PRAGMA user_version == HEAD and sync version N+1.

    Pre-fix this is RED: the schema-equal `else` swaps R2's 3-row bytes over local,
    the extra row is lost, and the migrated 3-row copy uploads at N+1 as canonical."""
    user_id, profile_id, N = "t6410u1", "aaaa1111", 7
    fake = FakeR2()
    r2_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=3, tag="r2")
    key = _seed_r2_profile(fake, user_id, profile_id, r2_data, sync_version=N)

    db_path = _db_path(tmp_path, user_id, profile_id)
    local_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=4, tag="local")
    _write_local_bytes(db_path, local_data)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        from app.database import set_local_db_version
        set_local_db_version(user_id, profile_id, N)  # confirmed baseline == R2 sync
        result = _migrate_profile_db(user_id, profile_id)

    assert result.status == "ok", f"expected ok, got {result.status} (r2_version={result.r2_version})"
    # Local copy kept + migrated in place: extra row intact, schema advanced.
    assert _local_games_count(db_path) == 4, "the unsynced local row was discarded (swap happened)"
    assert _local_user_version(db_path) == HEAD, "local schema not migrated to head"
    # The pending write reached R2, at head, one sync version forward.
    assert _r2_games_count(fake, key, tmp_path) == 4, \
        "R2 object is missing the unsynced row — the discard became canonical"
    assert _r2_bytes_user_version(fake, key, tmp_path) == HEAD, "R2 PRAGMA user_version did not reach head"
    assert _r2_sync_version(fake, key) == str(N + 1), \
        f"R2 sync version must advance to {N + 1}, got {_r2_sync_version(fake, key)}"


# ---------------------------------------------------------------------------
# 2. Scope guard — a genuinely-behind local copy is still swapped (T6160 intact)
# ---------------------------------------------------------------------------

def test_genuinely_behind_local_still_swapped(tmp_path):
    """Same shape as case 1 but the local baseline is N-1 (genuinely BEHIND R2's
    sync N). The elif does not fire (N-1 < N), so the ordinary swap path runs: R2's
    3-row copy overwrites local's 4 rows and the extra local-only row is absent from
    R2. This is T6160's discard-on-genuinely-stale behavior, unchanged."""
    user_id, profile_id, N = "t6410u2", "bbbb2222", 7
    fake = FakeR2()
    r2_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=3, tag="r2")
    key = _seed_r2_profile(fake, user_id, profile_id, r2_data, sync_version=N)

    db_path = _db_path(tmp_path, user_id, profile_id)
    local_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=4, tag="local")
    _write_local_bytes(db_path, local_data)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        from app.database import set_local_db_version
        set_local_db_version(user_id, profile_id, N - 1)  # confirmed but BEHIND R2
        result = _migrate_profile_db(user_id, profile_id)

    assert result.status == "ok", f"expected ok, got {result.status} (r2_version={result.r2_version})"
    # Swap happened: R2 won, the extra local-only row never reached R2.
    assert _r2_games_count(fake, key, tmp_path) == 3, \
        "genuinely-stale local row leaked into R2 — swap-on-behind regressed"
    assert _local_games_count(db_path) == 3, "local was not swapped to R2's copy"
    assert _r2_bytes_user_version(fake, key, tmp_path) == HEAD, "R2 did not reach head"


# ---------------------------------------------------------------------------
# 3. T6340 boundary — an UNCONFIRMED (None) baseline is still swapped
# ---------------------------------------------------------------------------

def test_unconfirmed_baseline_still_swapped(tmp_path):
    """No confirmed baseline (None) even though a local-only extra row is present.
    An unconfirmed baseline can never be trusted to keep local, so the swap must
    STILL happen — this is T6340's original guarantee and must not regress."""
    user_id, profile_id, N = "t6410u3", "cccc3333", 7
    fake = FakeR2()
    r2_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=3, tag="r2")
    key = _seed_r2_profile(fake, user_id, profile_id, r2_data, sync_version=N)

    db_path = _db_path(tmp_path, user_id, profile_id)
    local_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=4, tag="local")
    _write_local_bytes(db_path, local_data)
    _clear_baseline(user_id, profile_id)  # baseline None (cache + persisted row)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        result = _migrate_profile_db(user_id, profile_id)

    assert result.status == "ok", f"expected ok, got {result.status} (r2_version={result.r2_version})"
    assert _r2_games_count(fake, key, tmp_path) == 3, "unconfirmed-baseline local was kept — T6340 regressed"
    assert _local_games_count(db_path) == 3, "local was not swapped despite an unconfirmed baseline"


# ---------------------------------------------------------------------------
# 4. Zero boundary — a zero baseline over a legacy R2 object is still swapped
# ---------------------------------------------------------------------------

def test_zero_baseline_still_swapped(tmp_path):
    """R2 object seeded WITHOUT db-version metadata (downloaded_sync_version == 0),
    local baseline 0. The `> 0` bound excludes this: a fresh/empty local DB
    (baseline 0 == 'no version information') must never be kept and uploaded over a
    real legacy R2 object. Assert the swap still happens."""
    user_id, profile_id = "t6410u4", "dddd4444"
    fake = FakeR2()
    r2_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=3, tag="r2")
    key = _r2_profile_key(user_id, profile_id)
    fake._store(key, r2_data)  # NO Metadata -> _download_profile_db returns sync_version 0

    db_path = _db_path(tmp_path, user_id, profile_id)
    local_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=4, tag="local")
    _write_local_bytes(db_path, local_data)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        from app.database import set_local_db_version
        set_local_db_version(user_id, profile_id, 0)  # zero == "no version information"
        result = _migrate_profile_db(user_id, profile_id)

    # Swap taken: local's extra row discarded, R2's legacy copy won.
    assert _local_games_count(db_path) == 3, \
        "a zero-baseline (empty/fresh) local DB was kept over a legacy R2 object"
    assert _r2_games_count(fake, key, tmp_path) == 3, "R2 legacy content changed under a zero baseline"


# ---------------------------------------------------------------------------
# 5. No-churn idempotency — a second run in the same process uploads nothing
# ---------------------------------------------------------------------------

def test_second_run_is_idempotent_no_churn(tmp_path):
    """Run _migrate_profile_db twice in one process on a normal (behind-R2) profile.
    Run 1 swaps + migrates + uploads (N->N+1). Run 2 finds local already at head with
    a baseline == R2, applies nothing, and uploads nothing — the sync version is
    unchanged from after run 1 (no churn from the new keep-local branch)."""
    user_id, profile_id, N = "t6410u5", "eeee5555", 7
    fake = FakeR2()
    r2_data = _build_profile_bytes(tmp_path, user_version=HEAD - 1, games=3, tag="r2")
    key = _seed_r2_profile(fake, user_id, profile_id, r2_data, sync_version=N)
    _clear_baseline(user_id, profile_id)

    p1, p2 = _profile_env(tmp_path)
    with p1, p2, _r2_patched(fake):
        first = _migrate_profile_db(user_id, profile_id)
        assert first.status == "ok", f"run 1 status {first.status}"
        assert first.applied, "run 1 should have applied a schema migration"
        sync_after_1 = _r2_sync_version(fake, key)
        assert sync_after_1 == str(N + 1), f"run 1 sync must advance to {N + 1}, got {sync_after_1}"
        games_after_1 = _r2_games_count(fake, key, tmp_path)

        second = _migrate_profile_db(user_id, profile_id)

    assert second.status == "ok", f"run 2 status {second.status}"
    assert second.applied == [], "run 2 applied migrations — not idempotent"
    assert _r2_sync_version(fake, key) == sync_after_1, "R2 sync version churned on the second run"
    assert _r2_games_count(fake, key, tmp_path) == games_after_1, "R2 content churned on the second run"
