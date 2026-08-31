"""A move must never build on a profile DB it could not confirm is current.

Prod incident (arshia, 2026-07-24): five reels lost their final_videos row while
the mp4 survived in R2. move_reels resolves the TARGET profile through
ensure_profile_db_local, which was written for READ-ONLY collection-share
resolution and therefore serves a stale local copy when R2 is unreachable
(`was_error` and the file exists). move_reels then inserts into that stale copy
and syncs it back with skip_version_check=True -- a force-push. R2 is overwritten
with [stale snapshot + the new row], so every reel moved into that profile since
the stale copy was taken silently disappears.

Replaying the observed Ella U13 sequence against that mechanism reproduces the
surviving ids exactly (11, 21, 41, 42, 38): the losses of 18 and 34 each land on
the move that followed them, and the reverted sqlite_sequence lets the next
insert reuse the freed id, which is why the numbering looks unbroken.

Guard: a writer asks for require_fresh and gets ProfileDBRefreshFailed instead of
a stale path. Readers keep the old lenient behaviour.
"""

import sqlite3

import pytest


@pytest.fixture
def mat(tmp_path, monkeypatch):
    from app.services import materialization as m
    monkeypatch.setattr(m, "USER_DATA_BASE", tmp_path)
    return m, tmp_path


def _make_local(base, user_id, profile_id):
    d = base / user_id / "profiles" / profile_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "profile.sqlite"
    con = sqlite3.connect(str(p))
    con.execute("CREATE TABLE final_videos (id INTEGER PRIMARY KEY, filename TEXT)")
    # T5085: ensure_profile_db_local now calls the JIT seam (migrations.
    # run_profile_seam) after its restore -- a hand-built fixture with no
    # PRAGMA user_version reads as schema version 0 (genuinely below head),
    # so stamp it head to keep this file's assertions about R2-freshness
    # decoupled from schema-migration behavior, which isn't what this file
    # tests.
    from tests.conftest import stamp_schema_head
    stamp_schema_head(con, "profile_db")
    con.commit()
    con.close()
    return p


class TestRequireFresh:

    def test_writer_refuses_a_stale_copy_when_r2_errors(self, mat, monkeypatch):
        """The exact clobber path: R2 unreachable + a stale local file present."""
        m, base = mat
        _make_local(base, "u1", "target1")
        monkeypatch.setattr(
            m, "get_local_db_version", lambda u, p: 3, raising=False
        )
        # (downloaded=False, new_version=None, was_error=True)
        monkeypatch.setattr(
            "app.storage.sync_database_from_r2_if_newer",
            lambda u, path, v, **kw: (False, None, True),
        )

        with pytest.raises(m.ProfileDBRefreshFailed):
            m.ensure_profile_db_local("u1", "target1", require_fresh=True)

    def test_reader_still_gets_the_stale_copy(self, mat, monkeypatch):
        """Share resolution must keep working during an R2 blip -- serving a
        slightly stale reel list is fine when nothing is written back."""
        m, base = mat
        path = _make_local(base, "u1", "target1")
        monkeypatch.setattr(m, "get_local_db_version", lambda u, p: 3, raising=False)
        monkeypatch.setattr(
            "app.storage.sync_database_from_r2_if_newer",
            lambda u, p_, v, **kw: (False, None, True),
        )

        assert m.ensure_profile_db_local("u1", "target1") == path

    def test_writer_proceeds_when_refresh_succeeds(self, mat, monkeypatch):
        """No R2 error -> the writer gets the confirmed-current path."""
        m, base = mat
        path = _make_local(base, "u1", "target1")
        monkeypatch.setattr(m, "get_local_db_version", lambda u, p: 3, raising=False)
        monkeypatch.setattr(m, "set_local_db_version", lambda u, p, v: None, raising=False)
        monkeypatch.setattr(
            "app.storage.sync_database_from_r2_if_newer",
            lambda u, p_, v, **kw: (True, 4, False),
        )

        assert m.ensure_profile_db_local("u1", "target1", require_fresh=True) == path

    def test_genuinely_absent_target_is_not_an_error(self, mat, monkeypatch):
        """NOT_FOUND (first reel ever moved here) must stay distinguishable from
        an R2 ERROR -- only the former may legitimately create an empty schema."""
        m, _base = mat
        monkeypatch.setattr(m, "get_local_db_version", lambda u, p: None, raising=False)
        monkeypatch.setattr(
            "app.storage.sync_database_from_r2_if_newer",
            lambda u, p_, v, **kw: (False, None, False),
        )

        assert m.ensure_profile_db_local("u1", "fresh-target", require_fresh=True) is None


class TestClearsPendingMarkerForTheArgProfileNotTheAmbientOne:
    """T5081 (INV-P reason b, site 4, round 7 review MAJOR — no site 4
    coverage existed): ensure_profile_db_local temporarily points the
    profile_context ContextVar at its OWN profile_id argument (so the R2
    helpers' ContextVar-derived key resolution finds the right object) — the
    single site where the scope a caller has in mind and the ambient
    ContextVar it started with can legitimately differ (e.g. a session
    actively working profile A calls this to resolve profile B's share). The
    .sync_pending clear must target the function's own (user_id, profile_id)
    ARGUMENTS, never whatever the ambient ContextVar happened to hold when
    the call started."""

    def test_clear_targets_the_argument_profile_not_the_ambient_context(self, mat, monkeypatch):
        import app.database as db_module
        from app.database import has_sync_pending_scope, mark_sync_pending
        from app.profile_context import set_current_profile_id

        m, base = mat
        monkeypatch.setattr(db_module, "USER_DATA_BASE", base)  # same dir as `m`'s patch

        path = _make_local(base, "u1", "target1")
        monkeypatch.setattr(m, "get_local_db_version", lambda u, p: 3, raising=False)
        monkeypatch.setattr(m, "set_local_db_version", lambda u, p, v: None, raising=False)
        monkeypatch.setattr(
            "app.storage.sync_database_from_r2_if_newer",
            lambda u, p_, v, **kw: (True, 4, False),
        )

        # The caller's ambient session is on a DIFFERENT profile than the one
        # being resolved -- exactly the divergence this function exists for.
        set_current_profile_id("ambient-profile")
        mark_sync_pending("u1", "target1")          # the arg profile's refused write
        mark_sync_pending("u1", "ambient-profile")   # an unrelated marker on the ambient one

        result = m.ensure_profile_db_local("u1", "target1", require_fresh=True)

        assert result == path
        assert has_sync_pending_scope("u1", "target1") is False, \
            "the restore replaced the ARGUMENT profile's content -- its marker must clear"
        assert has_sync_pending_scope("u1", "ambient-profile") is True, \
            "the ambient ContextVar's profile was never touched by this call -- its marker must survive"
