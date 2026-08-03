"""T6400 — a machine must not CAS-conflict with its OWN write.

Live staging incident 2026-08-03 (diagnosed from T6390's diag payload):

    state -> conflict  db=profile  reason=stale_baseline  loaded=2734  r2=2735
    machine=d8933d5f417308  writer=d8933d5f417308/dcce51f3

`machine == writer machine`, and staging runs exactly ONE machine
(`min_machines_running = 0`), so this was not a cross-machine race — the process
refused a write against a version IT had just uploaded ITSELF.

Cause: the CAS decision (baseline read -> HEAD -> refuse) ran entirely OUTSIDE the
upload lock that serialises the PUT, so two concurrent syncs of the same profile
interleave:

    A: read baseline 2734 ........................... HEAD -> 2735  REFUSE
    B: read baseline 2734 -> HEAD 2734 -> PUT 2735 -> advance baseline

Both upload the SAME file on disk, so A's "stale" copy already contains B's data.
The refusal is a false positive against itself, and it is expensive: it marks a
conflict banner and triggers schedule_profile_db_reheal, which makes the next
request re-download the whole profile.sqlite from R2.

The interleave is reproduced DETERMINISTICALLY (no threads, no sleeps) by passing
the baseline value A captured before B advanced it — which is exactly what
`sync_db_to_r2_explicit` does when B lands between its `get_local_db_version` read
and the primitive's HEAD.

What must NOT change (T4310/T4315/T6340 exist because these were violated):
a genuinely stale baseline still refuses, an unconfirmed (None) baseline still
refuses, the baseline is never advanced on a refusal, and no fallback / auto-merge
/ force-push / blind-retry is introduced.
"""

import sqlite3
import threading
from unittest.mock import patch

import pytest

from app import storage
from app.database import SyncResult
from app.storage import profile_r2_key, sync_database_to_r2_with_version
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "u_t6400"
PROFILE = "cafe6400"
BASE_VERSION = 2734  # the versions from the real incident


def _write_db(path, rows=()):
    """A self-contained sqlite snapshot (checkpointed, no WAL sidecars)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS rows_ (v TEXT)")
    for r in rows:
        conn.execute("INSERT INTO rows_ (v) VALUES (?)", (r,))
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    for suffix in ("-wal", "-shm"):
        p = path.parent / (path.name + suffix)
        if p.exists():
            p.unlink()


def _append_row(path, value):
    """Commit a row the way a normal request would (leaves the WAL in place)."""
    conn = sqlite3.connect(str(path))
    conn.execute("INSERT INTO rows_ (v) VALUES (?)", (value,))
    conn.commit()
    conn.close()


def _rows_in_r2(fake, key, tmp_path):
    out = tmp_path / "_r2_readback.sqlite"
    out.write_bytes(fake._objects[key]["data"])
    conn = sqlite3.connect(str(out))
    try:
        return {r[0] for r in conn.execute("SELECT v FROM rows_")}
    finally:
        conn.close()


def _seed_r2(fake, key, db_path, version, writer="other_machine/req0"):
    fake._store(key, db_path.read_bytes(), ExtraArgs={"Metadata": {
        "db-version": str(version), "db-writer": writer,
    }})


@pytest.fixture(autouse=True)
def _isolate():
    """Reset the per-process record of our own uploads between tests.

    getattr-tolerant so the RED run fails on the ASSERTION, not on a missing
    attribute that does not exist until the fix lands.
    """
    getattr(storage, "_OWN_UPLOAD_VERSIONS", {}).clear()
    yield
    getattr(storage, "_OWN_UPLOAD_VERSIONS", {}).clear()


@pytest.fixture()
def env(tmp_path):
    fake = FakeR2()
    db_path = tmp_path / "profile.sqlite"
    _write_db(db_path, rows=["seed"])
    key = profile_r2_key(USER, PROFILE, "profile.sqlite")
    _seed_r2(fake, key, db_path, BASE_VERSION)
    with _r2_patched(fake):
        yield fake, db_path, key


# ---------------------------------------------------------------------------
# 1. The bug: the process refuses a version it uploaded itself.
# ---------------------------------------------------------------------------

def test_second_sync_with_a_pre_advance_baseline_is_not_a_conflict(env):
    """B lands between A's baseline read and A's HEAD. A must still upload.

    This is the incident: loaded=2734 / r2=2735 / writer == our own machine.
    """
    fake, db_path, key = env

    # B: the sync that wins the race and moves R2 to 2735.
    ok_b, v_b, _ = sync_database_to_r2_with_version(
        USER, db_path, BASE_VERSION, profile_id=PROFILE, with_diag=True)
    assert (ok_b, v_b) == (True, BASE_VERSION + 1)

    # A: captured its baseline BEFORE B advanced it, HEADs after B's PUT.
    ok_a, v_a, diag = sync_database_to_r2_with_version(
        USER, db_path, BASE_VERSION, profile_id=PROFILE, with_diag=True)

    assert ok_a is True, (
        f"self-conflict: refused our own v{v_a} (diag={diag}). The CAS decision "
        f"must not fire against a version this process uploaded itself."
    )
    assert v_a == BASE_VERSION + 2
    assert fake._objects[key]["metadata"]["db-version"] == str(BASE_VERSION + 2)


def test_rows_committed_after_the_winners_put_still_reach_r2(env, tmp_path):
    """The narrow data-loss window (consequence 3 in the task file).

    Rows committed AFTER the winner's PUT but before the loser's HEAD are not in
    R2. If the loser is refused, T6160's re-heal then DISCARDS them (design
    decision 2 — the refused edit is dropped, never merged). In the incident that
    was a quest achievement; on a keyframe /actions write it is a real user edit.
    """
    fake, db_path, key = env

    sync_database_to_r2_with_version(USER, db_path, BASE_VERSION, profile_id=PROFILE)

    # The loser's gesture commits AFTER the winner already shipped its bytes.
    _append_row(db_path, "committed_after_winner_put")

    ok, _new, diag = sync_database_to_r2_with_version(
        USER, db_path, BASE_VERSION, profile_id=PROFILE, with_diag=True)

    assert ok is True, f"refused, so this row would be discarded by the re-heal (diag={diag})"
    assert "committed_after_winner_put" in _rows_in_r2(fake, key, tmp_path)


def test_wrapper_path_marks_no_conflict_and_returns_ok(tmp_path):
    """End-to-end through the real caller: SyncResult.OK, no .sync_conflict marker.

    Mirrors the incident exactly — the marker is what raises the banner and what
    T6390 rendered into X-Sync-Diag.
    """
    from app import database as db
    from app.database import (
        get_user_data_path_explicit,
        has_sync_conflict,
        set_local_db_version,
        sync_db_to_r2_explicit,
    )

    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
        db_path = get_user_data_path_explicit(USER, PROFILE) / "profile.sqlite"
        _write_db(db_path, rows=["seed"])
        key = profile_r2_key(USER, PROFILE, "profile.sqlite")
        _seed_r2(fake, key, db_path, BASE_VERSION)
        set_local_db_version(USER, PROFILE, BASE_VERSION)

        # B wins and advances the shared baseline to 2735.
        assert sync_db_to_r2_explicit(USER, PROFILE) == SyncResult.OK

        # A read the baseline before B's set_local_db_version landed.
        with patch.object(db, "get_local_db_version", return_value=BASE_VERSION):
            result = sync_db_to_r2_explicit(USER, PROFILE)

        assert result == SyncResult.OK
        assert not has_sync_conflict(USER), "banner raised by a self-conflict"


# ---------------------------------------------------------------------------
# 2. The guard must NOT weaken: a real foreign writer still refuses.
# ---------------------------------------------------------------------------

def test_foreign_writer_ahead_still_refuses(env):
    """Another machine moved R2 ahead — this MUST still be refused (T4310)."""
    fake, db_path, key = env

    # Our process has uploaded nothing; R2 jumps ahead under a foreign writer.
    _seed_r2(fake, key, db_path, BASE_VERSION + 1, writer="other_machine/reqX")

    ok, version, diag = sync_database_to_r2_with_version(
        USER, db_path, BASE_VERSION, profile_id=PROFILE, with_diag=True)

    assert ok is False
    assert version == BASE_VERSION + 1
    assert diag["reason"] == "stale_baseline"
    assert diag["writer"] == "other_machine/reqX"
    # Refused means NOT uploaded: R2 still holds the foreign writer's version.
    assert fake._objects[key]["metadata"]["db-writer"] == "other_machine/reqX"


def test_foreign_writer_ahead_after_our_own_upload_still_refuses(env):
    """The forgiveness is bounded to OUR OWN version, not 'any version >= ours'.

    We upload 2735, then a foreign machine writes 2736. Our next attempt (still
    holding baseline 2734) must refuse — remembering our own upload must not
    become a blanket amnesty.
    """
    fake, db_path, key = env

    ok, v, _ = sync_database_to_r2_with_version(
        USER, db_path, BASE_VERSION, profile_id=PROFILE, with_diag=True)
    assert (ok, v) == (True, BASE_VERSION + 1)

    _seed_r2(fake, key, db_path, BASE_VERSION + 2, writer="other_machine/reqY")

    ok2, v2, diag = sync_database_to_r2_with_version(
        USER, db_path, BASE_VERSION, profile_id=PROFILE, with_diag=True)

    assert ok2 is False
    assert v2 == BASE_VERSION + 2
    assert diag["reason"] == "stale_baseline"


def test_unconfirmed_baseline_still_refuses(env):
    """T4315 BLOCKING-2: current_version=None against real R2 content still refuses,
    even after this process has uploaded successfully."""
    _fake, db_path, _key = env

    sync_database_to_r2_with_version(USER, db_path, BASE_VERSION, profile_id=PROFILE)

    ok, version, diag = sync_database_to_r2_with_version(
        USER, db_path, None, profile_id=PROFILE, with_diag=True)

    assert ok is False
    assert diag["reason"] == "unconfirmed_baseline"
    assert version == BASE_VERSION + 1


# ---------------------------------------------------------------------------
# 3. HEAD budget + lock-timeout ordering must be preserved (T1020/T2720/T6160).
# ---------------------------------------------------------------------------

def _count_heads(fake):
    calls = {"n": 0}
    real = fake.head_object

    def counting(**kwargs):
        calls["n"] += 1
        return real(**kwargs)

    fake.head_object = counting
    return calls


def test_exactly_one_head_per_sync(env):
    fake, db_path, _key = env
    calls = _count_heads(fake)

    sync_database_to_r2_with_version(USER, db_path, BASE_VERSION, profile_id=PROFILE)

    assert calls["n"] == 1, "T6160: the HEAD budget per sync attempt is exactly one"


def test_skip_version_check_issues_no_head(env):
    fake, db_path, _key = env
    calls = _count_heads(fake)

    ok, _v = sync_database_to_r2_with_version(
        USER, db_path, BASE_VERSION, profile_id=PROFILE, skip_version_check=True)

    assert ok is True
    assert calls["n"] == 0, "T1020/T2720: the request-thread callers must issue no HEAD"


def test_lock_timeout_bailout_happens_before_the_head(env):
    """T2720: a deferred sync must cost ZERO R2 calls."""
    fake, db_path, _key = env
    calls = _count_heads(fake)

    held = storage.get_upload_lock(USER, "profile")
    holder_done = threading.Event()

    def hold():
        with held:
            holder_done.wait(5)

    t = threading.Thread(target=hold)
    t.start()
    try:
        # Wait until the holder actually owns the lock.
        for _ in range(500):
            if held.locked():
                break
            threading.Event().wait(0.002)
        ok, version, diag = sync_database_to_r2_with_version(
            USER, db_path, BASE_VERSION, profile_id=PROFILE,
            lock_timeout=0.01, with_diag=True)
    finally:
        holder_done.set()
        t.join(5)

    assert ok is False
    assert version is None
    assert diag["reason"] == "upload_failed"
    assert calls["n"] == 0, "the bail-out must precede the HEAD"


# ---------------------------------------------------------------------------
# 4. The user.sqlite twin has the identical shape and the identical fix.
# ---------------------------------------------------------------------------

def test_user_db_twin_does_not_self_conflict(tmp_path):
    from app.storage import _user_db_r2_key, sync_user_db_to_r2_with_version

    fake = FakeR2()
    db_path = tmp_path / "user.sqlite"
    _write_db(db_path, rows=["seed"])
    key = _user_db_r2_key(USER)
    _seed_r2(fake, key, db_path, BASE_VERSION)

    with _r2_patched(fake):
        ok_b, v_b = sync_user_db_to_r2_with_version(USER, db_path, BASE_VERSION)
        assert (ok_b, v_b) == (True, BASE_VERSION + 1)

        ok_a, v_a, diag = sync_user_db_to_r2_with_version(
            USER, db_path, BASE_VERSION, with_diag=True)

    assert ok_a is True, f"user.sqlite self-conflict (diag={diag})"
    assert v_a == BASE_VERSION + 2


def test_user_db_twin_still_refuses_a_foreign_writer(tmp_path):
    from app.storage import _user_db_r2_key, sync_user_db_to_r2_with_version

    fake = FakeR2()
    db_path = tmp_path / "user.sqlite"
    _write_db(db_path, rows=["seed"])
    key = _user_db_r2_key(USER)
    _seed_r2(fake, key, db_path, BASE_VERSION + 1, writer="other_machine/reqZ")

    with _r2_patched(fake):
        ok, version, diag = sync_user_db_to_r2_with_version(
            USER, db_path, BASE_VERSION, with_diag=True)

    assert ok is False
    assert version == BASE_VERSION + 1
    assert diag["reason"] == "stale_baseline"
