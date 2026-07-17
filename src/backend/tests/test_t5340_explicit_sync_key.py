"""T5340 — the *_explicit R2 sync functions must derive the upload KEY from the
profile_id ARG, never get_current_profile_id() (the ContextVar).

Before T5340, sync_db_to_r2_explicit(user, profile_id) read the RIGHT local file
(from the arg) but uploaded it to the WRONG R2 key (from the ContextVar) whenever
the two disagreed — the T4850 move-reels corruption: the target profile's DB
landed on the SOURCE profile's key, overwriting the source and losing the move.

These tests run the REAL storage.py logic against an in-memory R2, with the
ContextVar deliberately set to a DIFFERENT profile than the arg, so a regression
to ContextVar-keying fails loudly.
"""

import os
from contextlib import ExitStack, contextmanager
from unittest.mock import patch

import pytest

USER = "u_t5340"
PROFILE_A = "aaaa1111"   # the ContextVar (request/active) profile
PROFILE_B = "bbbb2222"   # the ARG (target) profile — differs from the ContextVar


class _FakeR2:
    """In-memory R2: {key: (data, metadata)}. Only the surface the explicit
    profile-sync path touches (upload_file; head_object for completeness)."""

    def __init__(self):
        self.objects = {}
        self.upload_keys = []

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None, Callback=None, Config=None):
        with open(Filename, "rb") as f:
            data = f.read()
        meta = dict((ExtraArgs or {}).get("Metadata", {}))
        self.objects[Key] = (data, meta)
        self.upload_keys.append(Key)

    def head_object(self, Bucket=None, Key=None, **kw):
        if Key not in self.objects:
            from botocore.exceptions import ClientError
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return {"Metadata": dict(self.objects[Key][1])}

    def download_file(self, Bucket, Key, Filename, **kw):
        if Key not in self.objects:
            raise ValueError(f"NoSuchKey: {Key}")
        os.makedirs(os.path.dirname(Filename), exist_ok=True)
        with open(Filename, "wb") as f:
            f.write(self.objects[Key][0])


@contextmanager
def _env(tmp_path):
    """Patch USER_DATA_BASE + turn R2 'on', routing every client getter at a
    single FakeR2. Yields (fake, base_path)."""
    fake = _FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.storage.R2_ENABLED", True), \
         patch("app.database.R2_ENABLED", True), \
         patch("app.storage.get_r2_client", lambda: fake), \
         patch("app.storage.get_r2_sync_client", lambda: fake), \
         patch("app.storage.get_r2_transfer_client", lambda: fake):
        yield fake, tmp_path


def _write_profile_db(base_path, profile_id, marker: str):
    """Create a REAL local profile.sqlite carrying a distinguishing marker row, so
    the uploaded object's bytes identify WHICH profile's DB reached WHICH key."""
    import sqlite3
    d = base_path / USER / "profiles" / profile_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "profile.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    conn.commit()
    conn.close()
    return p


def _profile_key(profile_id):
    from app.storage import profile_r2_key
    return profile_r2_key(USER, profile_id, "profile.sqlite")


def _set_contextvar(profile_id):
    from app.profile_context import set_current_profile_id
    set_current_profile_id(profile_id)


# --------------------------------------------------------------------------- #
# 1. HEADLINE — arg wins over ContextVar for the R2 key.
# --------------------------------------------------------------------------- #

def test_sync_db_to_r2_explicit_keys_off_arg_not_contextvar(tmp_path):
    from app.database import sync_db_to_r2_explicit, set_local_db_version

    with _env(tmp_path) as (fake, base):
        db_b = _write_profile_db(base, PROFILE_B, "profile_b_db")
        set_local_db_version(USER, PROFILE_B, 0)
        expected = db_b.read_bytes()  # capture BEFORE sync (sync bumps db_version on disk)
        # ContextVar points at A; we sync B. Pre-T5340 this uploaded to A's key.
        _set_contextvar(PROFILE_A)

        assert sync_db_to_r2_explicit(USER, PROFILE_B) is True

        assert _profile_key(PROFILE_B) in fake.objects, "B's DB did not land on B's key"
        assert _profile_key(PROFILE_A) not in fake.objects, \
            "REGRESSION: B's DB uploaded to A's key (ContextVar leaked into the key)"
        assert fake.objects[_profile_key(PROFILE_B)][0] == expected


# --------------------------------------------------------------------------- #
# 2. T4850 move-reels regression — target R2 copy updated, source R2 UNCHANGED.
# --------------------------------------------------------------------------- #

def test_move_reels_target_sync_leaves_source_r2_intact(tmp_path):
    """Simulate move_reels_to_profile's cross-profile durable write: the request
    (ContextVar) profile is the SOURCE; the handler syncs the TARGET's DB via
    sync_db_to_r2_explicit(user, target). The source's durable R2 copy must NOT
    be touched, and the target's copy must receive the moved-in DB."""
    from app.database import sync_db_to_r2_explicit, set_local_db_version

    with _env(tmp_path) as (fake, base):
        # Seed the SOURCE profile's durable R2 copy (its pre-move state).
        fake.objects[_profile_key(PROFILE_A)] = (b"SOURCE_DB_PRE_MOVE", {"db-version": "7"})
        # Local target DB now carries the moved-in reels.
        db_b = _write_profile_db(base, PROFILE_B, "target_db_with_moved_reels")
        set_local_db_version(USER, PROFILE_B, 0)
        expected = db_b.read_bytes()  # capture BEFORE sync (sync bumps db_version on disk)

        # Request profile is the SOURCE (as in a real move-reels request).
        _set_contextvar(PROFILE_A)
        assert sync_db_to_r2_explicit(USER, PROFILE_B) is True

        # Target got the moved reels.
        assert fake.objects[_profile_key(PROFILE_B)][0] == expected
        # Source R2 copy is byte-for-byte unchanged (no corruption).
        assert fake.objects[_profile_key(PROFILE_A)][0] == b"SOURCE_DB_PRE_MOVE"
        assert _profile_key(PROFILE_A) not in fake.upload_keys, \
            "REGRESSION: source R2 key was written during a target sync"


# --------------------------------------------------------------------------- #
# 3. No silent fallback — a missing profile_id RAISES (never the ContextVar).
# --------------------------------------------------------------------------- #

def test_sync_db_to_r2_explicit_raises_without_profile_id(tmp_path):
    from app.database import sync_db_to_r2_explicit

    with _env(tmp_path):
        _set_contextvar(PROFILE_A)  # a ContextVar IS available — must still refuse it
        with pytest.raises(ValueError, match="profile_id"):
            sync_db_to_r2_explicit(USER, "")


# --------------------------------------------------------------------------- #
# 4. The primitive: profile_id=None still uses the ContextVar (request path
#    unchanged); an explicit profile_id overrides it.
# --------------------------------------------------------------------------- #

def test_primitive_key_source_switches_on_profile_id(tmp_path):
    from app.storage import sync_database_to_r2_with_version

    with _env(tmp_path) as (fake, base):
        p = _write_profile_db(base, PROFILE_B, "db")
        _set_contextvar(PROFILE_A)

        # No profile_id -> request path -> ContextVar (A) key.
        ok, _ = sync_database_to_r2_with_version(USER, p, 0, skip_version_check=True)
        assert ok and _profile_key(PROFILE_A) in fake.objects

        # Explicit profile_id -> arg (B) key.
        ok, _ = sync_database_to_r2_with_version(USER, p, 0, skip_version_check=True,
                                                 profile_id=PROFILE_B)
        assert ok and _profile_key(PROFILE_B) in fake.objects


# --------------------------------------------------------------------------- #
# 5. user.sqlite analog is inherently ContextVar-free (key has no profile
#    segment), so sync_user_db_to_r2_explicit was never affected — lock it in.
# --------------------------------------------------------------------------- #

def test_user_db_key_is_profile_independent(tmp_path):
    from app.database import sync_user_db_to_r2_explicit, set_local_user_db_version
    from app.storage import _user_db_r2_key

    with _env(tmp_path) as (fake, base):
        (base / USER).mkdir(parents=True, exist_ok=True)
        (base / USER / "user.sqlite").write_bytes(b"USER_DB")
        set_local_user_db_version(USER, 0)
        _set_contextvar(PROFILE_A)  # irrelevant to the user.sqlite key

        assert sync_user_db_to_r2_explicit(USER) is True
        key = _user_db_r2_key(USER)
        assert key in fake.objects
        assert "/profiles/" not in key, "user.sqlite key must not be profile-scoped"
