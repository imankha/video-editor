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
            lambda u, path, v: (False, None, True),
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
            lambda u, p_, v: (False, None, True),
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
            lambda u, p_, v: (True, 4, False),
        )

        assert m.ensure_profile_db_local("u1", "target1", require_fresh=True) == path

    def test_genuinely_absent_target_is_not_an_error(self, mat, monkeypatch):
        """NOT_FOUND (first reel ever moved here) must stay distinguishable from
        an R2 ERROR -- only the former may legitimately create an empty schema."""
        m, _base = mat
        monkeypatch.setattr(m, "get_local_db_version", lambda u, p: None, raising=False)
        monkeypatch.setattr(
            "app.storage.sync_database_from_r2_if_newer",
            lambda u, p_, v: (False, None, False),
        )

        assert m.ensure_profile_db_local("u1", "fresh-target", require_fresh=True) is None
