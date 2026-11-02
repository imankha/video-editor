"""T14160: a profile.sqlite that disappears locally must never become an empty
authoritative copy, and the sweep must never delete on a missing file.

These are the prerequisite guards for evicting the local DB cache. Each
scenario is reachable today without eviction (a manual delete, a crash, a
TOCTOU race), and eviction would make it routine.

1. File gone, version still cached: the next access must restore from R2,
   not create an empty DB whose upload passes CAS and clobbers R2.
2. File gone between the upload's exists() check and its WAL checkpoint: the
   checkpoint must not create an empty file that is then uploaded.
3. Phase 2 artifact gate on a profile whose file is missing: fail closed
   (defer the irreversible R2 delete), never skip the profile.
"""

import sqlite3
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest

if "cv2" not in sys.modules:
    sys.modules["cv2"] = types.ModuleType("cv2")

from tests.r2_fake_transport import FakeR2Transport

USER = "t14160u"
PROFILE = "aaaaaaaa"


@pytest.fixture
def fake_r2(tmp_path):
    from app import database, migrations, storage
    from app.profile_context import set_current_profile_id
    from app.services import user_db
    from app.user_context import set_current_user_id

    fake = FakeR2Transport()
    with fake.patched_storage_clients(), \
         patch.object(database, "USER_DATA_BASE", tmp_path), \
         patch.object(user_db, "USER_DATA_BASE", tmp_path), \
         patch.object(database, "R2_ENABLED", True), \
         patch.object(storage, "R2_ENABLED", True):
        set_current_user_id(USER)
        set_current_profile_id(PROFILE)
        yield fake, tmp_path
    database.forget_local_db_state(USER)
    migrations._clear_seam_verified(USER)


def _profile_path(base: Path) -> Path:
    return base / USER / "profiles" / PROFILE / "profile.sqlite"


def _r2_profile_object(fake):
    (key,) = [k for k in fake.objects if k.endswith(f"{PROFILE}/profile.sqlite")]
    return fake.objects[key]


def _r2_project_names(fake, scratch: Path) -> list[str]:
    copy = scratch / "r2copy.sqlite"
    copy.write_bytes(_r2_profile_object(fake)["body"])
    conn = sqlite3.connect(copy)
    try:
        return sorted(r[0] for r in conn.execute("SELECT name FROM projects"))
    finally:
        conn.close()


def _write_project(name: str) -> None:
    from app import database

    with database.get_db_connection() as conn:
        conn.execute("INSERT INTO projects (name, aspect_ratio) VALUES (?, '16:9')", (name,))
        conn.commit()


def _unlink_db(path: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        Path(str(path) + suffix).unlink(missing_ok=True)


def test_missing_file_with_cached_version_restores_not_clobbers(fake_r2, tmp_path_factory):
    from app import database
    from app.database import SyncResult

    fake, base = fake_r2
    _write_project("keep me")
    assert database.sync_db_to_r2_explicit(USER, PROFILE) == SyncResult.OK

    _unlink_db(_profile_path(base))

    with database.get_db_connection() as conn:
        visible = sorted(r[0] for r in conn.execute("SELECT name FROM projects"))
    assert visible == ["keep me"], "a missing local file must be restored from R2"

    _write_project("new")
    assert database.sync_db_to_r2_explicit(USER, PROFILE) == SyncResult.OK
    assert _r2_project_names(fake, tmp_path_factory.mktemp("r2")) == ["keep me", "new"]


def test_file_vanishing_before_checkpoint_never_uploads_empty(fake_r2, tmp_path_factory):
    from app import database
    from app.database import SyncResult

    fake, base = fake_r2
    _write_project("keep me")
    assert database.sync_db_to_r2_explicit(USER, PROFILE) == SyncResult.OK
    before = dict(_r2_profile_object(fake))

    from app import storage

    path = _profile_path(base)
    real_head = storage.get_db_version_from_r2

    def head_then_vanish(*args, **kwargs):
        # The window between the primitive's exists() check and its checkpoint.
        out = real_head(*args, **kwargs)
        _unlink_db(path)
        return out

    with patch.object(storage, "get_db_version_from_r2", side_effect=head_then_vanish):
        result = database.sync_db_to_r2_explicit(USER, PROFILE)

    assert result != SyncResult.OK
    assert not path.exists(), "the sync must not create an empty profile.sqlite"
    after = _r2_profile_object(fake)
    assert after["body"] == before["body"], "R2 must keep the last good copy"
    assert _r2_project_names(fake, tmp_path_factory.mktemp("r2")) == ["keep me"]


def test_phase2_artifact_gate_fails_closed_on_missing_db(tmp_path):
    from app.services import sweep_scheduler

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch.object(sweep_scheduler, "recap_artifacts_present") as artifacts:
        missing = sweep_scheduler._phase2_artifact_gate_missing("h" * 64, [(USER, PROFILE)])

    assert missing is True, "a holder whose DB is not on disk must defer the R2 delete"
    artifacts.assert_not_called()
