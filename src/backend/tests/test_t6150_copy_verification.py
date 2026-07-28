"""T6150 -- copy_user_between_envs must DETECT a partial copy, not ship it silently.

Background: staging carried a `final_videos` row ("Brilliant Control") whose R2
object did not exist -> black player for the user. The object half of the copy
landed while the profile-DB half did not become authoritative on the LIVE
destination backend, so the DB referenced a reel the freshly-copied object store
never contained. The copy reported SUCCESS anyway -- a silent half-apply.

`verify_r2_copy` (pre-existing) proves the object SET was mirrored but never opens
the profile.sqlite, so it is BLIND to a DB row whose object is missing. These
tests pin the new `verify_media_refs` check that catches exactly that, and the
live-destination precondition that stops the half-apply at the source.

Red-first: against the pre-change script `verify_media_refs` does not exist and
the dangling state ships silently; these tests fail (ImportError / no detection)
and pass once the check is added.
"""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

import copy_user_between_envs as cu

UID = "3ed03fb5-1111-2222-3333-444455556666"
PID = "9fa7378c"
ENV = "staging"


class FakeR2:
    """Minimal R2 stand-in: list by prefix + download a stored sqlite blob."""

    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)

    def get_paginator(self, _name):
        objs = self.objects

        class _Paginator:
            def paginate(self, Bucket=None, Prefix=""):
                yield {"Contents": [{"Key": k} for k in objs if k.startswith(Prefix)]}

        return _Paginator()

    def download_file(self, Bucket, Key, Filename):
        Path(Filename).write_bytes(self.objects[Key])

    def head_object(self, Bucket=None, Key=None):
        # Real R2 404s a missing key; verify_r2_copy's _db_version catches that.
        if Key not in self.objects:
            raise KeyError(Key)
        return {"Metadata": {"db-version": "test-v1"}}


def _profile_sqlite_bytes(tmp_path, finals, workings, posters=None):
    """Build a real profile.sqlite with the media-ref tables and return its bytes."""
    posters = posters or {}
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE final_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "filename TEXT NOT NULL, poster_filename TEXT)"
    )
    conn.execute(
        "CREATE TABLE working_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL)"
    )
    for fn in finals:
        conn.execute(
            "INSERT INTO final_videos (filename, poster_filename) VALUES (?, ?)",
            (fn, posters.get(fn)),
        )
    for fn in workings:
        conn.execute("INSERT INTO working_videos (filename) VALUES (?)", (fn,))
    conn.commit()
    conn.close()
    data = db.read_bytes()
    db.unlink()
    return data


def _prof_key(sub, fn):
    return f"{ENV}/users/{UID}/profiles/{PID}/{sub}/{fn}"


def _sqlite_key():
    return f"{ENV}/users/{UID}/profiles/{PID}/profile.sqlite"


def test_verify_media_refs_detects_dangling_final_video(tmp_path):
    """A final_videos row whose object is absent must fail the copy loudly."""
    db_bytes = _profile_sqlite_bytes(
        tmp_path,
        finals=["final_31_eda94512.mp4", "final_30_present.mp4"],
        workings=[],
    )
    objects = {
        _sqlite_key(): db_bytes,
        _prof_key("final_videos", "final_30_present.mp4"): b"x",
        # final_31_eda94512.mp4 ("Brilliant Control") intentionally absent
    }
    r2 = FakeR2(objects)
    with pytest.raises(SystemExit) as exc:
        cu.verify_media_refs(r2, "bucket", UID, ENV)
    assert exc.value.code == 1


def test_verify_media_refs_detects_dangling_working_video(tmp_path):
    """working_videos refs are checked too (project 31's working video also 404'd)."""
    db_bytes = _profile_sqlite_bytes(
        tmp_path,
        finals=[],
        workings=["working_31_f874d743.mp4"],
    )
    objects = {_sqlite_key(): db_bytes}  # working object absent
    r2 = FakeR2(objects)
    with pytest.raises(SystemExit):
        cu.verify_media_refs(r2, "bucket", UID, ENV)


def test_verify_media_refs_passes_when_every_ref_resolves(tmp_path):
    """A coherent copy -- every media row has its object -- must NOT fail."""
    db_bytes = _profile_sqlite_bytes(
        tmp_path,
        finals=["final_a.mp4"],
        workings=["working_b.mp4"],
    )
    objects = {
        _sqlite_key(): db_bytes,
        _prof_key("final_videos", "final_a.mp4"): b"x",
        _prof_key("working_videos", "working_b.mp4"): b"y",
    }
    r2 = FakeR2(objects)
    cu.verify_media_refs(r2, "bucket", UID, ENV)  # no SystemExit


def test_missing_media_table_fails_loudly(tmp_path, caplog):
    """A profile.sqlite lacking final_videos/working_videos is not a valid profile
    DB -- verify must fail with the structured [VERIFY-REFS] message, not a bare
    'no such table' traceback (and must not leak the sqlite handle)."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")  # no media tables
    conn.commit()
    conn.close()
    r2 = FakeR2({_sqlite_key(): db.read_bytes()})
    with caplog.at_level("ERROR"), pytest.raises(SystemExit) as exc:
        cu.verify_media_refs(r2, "bucket", UID, ENV)
    assert exc.value.code == 1
    assert any("no 'final_videos' table" in r.message for r in caplog.records)


def test_missing_poster_is_warning_not_failure(tmp_path, caplog):
    """Posters are cosmetic (T4890) -- a set-but-missing poster must not fail the copy."""
    # poster_filename stores the basename INCLUDING `.jpg` (poster.py).
    db_bytes = _profile_sqlite_bytes(
        tmp_path,
        finals=["final_a.mp4"],
        workings=[],
        posters={"final_a.mp4": "final_a.mp4.jpg"},  # poster object absent
    )
    objects = {
        _sqlite_key(): db_bytes,
        _prof_key("final_videos", "final_a.mp4"): b"x",
        # posters/final_a.mp4.jpg absent -> warn only
    }
    r2 = FakeR2(objects)
    with caplog.at_level("WARNING"):
        cu.verify_media_refs(r2, "bucket", UID, ENV)  # no SystemExit
    assert any("poster" in r.message.lower() for r in caplog.records)


def test_present_poster_at_correct_key_does_not_warn(tmp_path, caplog):
    """Pins the poster key: `final_videos/posters/{poster_filename}` with NO extra
    `.jpg` (poster_filename already ends in .jpg). A double-suffix regression would
    make this present poster look missing and spuriously warn on every real copy."""
    db_bytes = _profile_sqlite_bytes(
        tmp_path,
        finals=["final_a.mp4"],
        workings=[],
        posters={"final_a.mp4": "final_a.mp4.jpg"},
    )
    objects = {
        _sqlite_key(): db_bytes,
        _prof_key("final_videos", "final_a.mp4"): b"x",
        _prof_key("final_videos/posters", "final_a.mp4.jpg"): b"p",
    }
    r2 = FakeR2(objects)
    with caplog.at_level("WARNING"):
        cu.verify_media_refs(r2, "bucket", UID, ENV)  # no SystemExit
    assert not any("poster" in r.message.lower() for r in caplog.records)


def test_verify_r2_copy_is_blind_to_dangling_ref(tmp_path):
    """Proves the GAP: the pre-existing object-set check passes on the exact state
    verify_media_refs rejects -- the copy was silent before this task."""
    db_bytes = _profile_sqlite_bytes(
        tmp_path, finals=["final_31_eda94512.mp4"], workings=[]
    )
    # Source == destination object set (so verify_r2_copy is satisfied), yet the
    # DB references final_31_eda94512.mp4, which is in NEITHER -- a dangling ref.
    src_keys = [f"production/users/{UID}/profiles/{PID}/profile.sqlite"]
    objects = {
        _sqlite_key(): db_bytes,
        # NOTE: no media object anywhere; only the sqlite was "mirrored"
    }
    # Rewrite the source sqlite key into the destination object map for parity.
    objects[f"production/users/{UID}/profiles/{PID}/profile.sqlite"] = db_bytes
    r2 = FakeR2(objects)
    # verify_r2_copy only compares object SETS + sqlite db-version -> it passes.
    cu.verify_r2_copy(r2, "bucket", UID, "production", ENV, src_keys)
    # verify_media_refs, on the SAME destination, catches the dangling row.
    with pytest.raises(SystemExit):
        cu.verify_media_refs(r2, "bucket", UID, ENV)


def test_live_destination_requires_stopped_machines_ack(monkeypatch, caplog):
    """main() refuses --to staging/production without --dest-machines-stopped:
    a live backend reverts the copied DB half and produces dangling refs.

    Asserts on the GUARD's own message, not merely exit-code 1 -- the pre-change
    main() also exits 1 (it reaches load_env and fails on a missing .env), so an
    exit-code-only assertion would pass against the unfixed script for the wrong
    reason. The guard must fire BEFORE any env/DB access."""
    monkeypatch.setattr(
        sys, "argv",
        ["copy_user_between_envs.py", "--email", "x@y.com",
         "--from", "production", "--to", "staging"],
    )
    # Hermetic: if the guard ever failed to fire, execution would fall through to
    # load_env and (in an env that HAS .env.prod) attempt a REAL prod DB connect.
    # Stub load_env so the test can never touch real env files or Postgres.
    monkeypatch.setattr(cu, "load_env", lambda *_: pytest.fail("reached load_env -- guard did NOT fire"))
    with caplog.at_level("ERROR"), pytest.raises(SystemExit) as exc:
        cu.main()
    assert exc.value.code == 1
    assert any(
        "dest-machines-stopped" in r.message or "Refusing to copy into LIVE" in r.message
        for r in caplog.records
    ), "guard message not logged -- main() did not refuse the live-destination copy"


def test_live_destination_ack_flag_passes_the_guard(monkeypatch, caplog):
    """With --dest-machines-stopped the guard must NOT fire; main() proceeds past
    it (and then fails later on env/DB access in this test env). Distinguishes
    'blocked by guard' from 'proceeded', so the guard can't silently always-block."""
    monkeypatch.setattr(
        sys, "argv",
        ["copy_user_between_envs.py", "--email", "x@y.com",
         "--from", "production", "--to", "staging", "--dest-machines-stopped"],
    )
    # Sentinel: reaching load_env proves we PASSED the guard. Raising here keeps
    # the test hermetic (no real env files / Postgres) and lets us assert the
    # guard did not short-circuit before it.
    def _sentinel(*_):
        raise SystemExit(99)
    monkeypatch.setattr(cu, "load_env", _sentinel)
    with caplog.at_level("ERROR"), pytest.raises(SystemExit) as exc:
        cu.main()
    assert exc.value.code == 99, "did not reach load_env -- guard blocked despite the ack flag"
    assert not any(
        "Refusing to copy into LIVE" in r.message for r in caplog.records
    ), "guard fired even though --dest-machines-stopped was given"


def test_dry_run_into_live_is_exempt_from_guard(monkeypatch, caplog):
    """A --dry-run copy into staging/production writes nothing, so the
    stopped-machines guard must NOT block it -- execution proceeds past the guard."""
    monkeypatch.setattr(
        sys, "argv",
        ["copy_user_between_envs.py", "--email", "x@y.com",
         "--from", "production", "--to", "staging", "--dry-run"],
    )
    def _sentinel(*_):
        raise SystemExit(99)
    monkeypatch.setattr(cu, "load_env", _sentinel)
    with caplog.at_level("ERROR"), pytest.raises(SystemExit) as exc:
        cu.main()
    assert exc.value.code == 99, "dry-run was blocked by the live-destination guard"
    assert not any(
        "Refusing to copy into LIVE" in r.message for r in caplog.records
    ), "guard fired on a --dry-run copy"
