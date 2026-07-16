"""T5110: poster backfill must not crash on a profile below head schema.

`backfill_posters` enumerates profiles via the UNFILTERED `_get_profile_ids`
(which includes orphan profiles that `run_all_migrations` deliberately
registry-skips, T4830). `ensure_database()` only does CREATE TABLE IF NOT
EXISTS -- it never runs versioned ALTERs -- so an orphan/below-head profile
lacks `final_videos.poster_filename`. Before this fix, the `... WHERE
poster_filename IS NULL` candidate query raised
`sqlite3.OperationalError: no such column: poster_filename` and aborted the
ENTIRE run before any real profile was processed (hit on prod 2026-07-13).

Two guarantees are pinned here:
  1. Every profile the backfill touches is migrated to head FIRST, so a
     below-head profile is healed and scanned normally (no crash).
  2. If a profile still can't be brought to head (migration unavailable / a
     corrupt blob), the per-profile candidate query error is recorded in
     `result["failed"]` and the sweep CONTINUES to the remaining profiles.
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.services import poster as poster_mod
from app.services.poster import backfill_posters

USER_ID = "test-user-t5110"
OLD_PROFILE = "oldprof"   # below head, missing poster_filename column
GOOD_PROFILE = "goodprof"  # at head, has a published poster-less reel

# Enumerated OLD first so a crash there would starve GOOD (proves sweep continues).
PROFILE_ORDER = [OLD_PROFILE, GOOD_PROFILE]


def _profile_path(base, profile_id):
    p = base / USER_ID / "profiles" / profile_id
    p.mkdir(parents=True, exist_ok=True)
    return p / "profile.sqlite"


def _make_below_head_profile(base):
    """A profile whose final_videos table has NO poster_filename column and a
    user_version just below head (only v024 is pending)."""
    from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER

    path = _profile_path(base, OLD_PROFILE)
    conn = sqlite3.connect(str(path))
    # project_id is a long-standing base column (predates poster_filename by many
    # versions) so any real below-head profile has it; only poster_filename (v024)
    # is missing here. T5090's backfill reconstruction reads project_id.
    conn.execute(
        "CREATE TABLE final_videos (id INTEGER PRIMARY KEY, project_id INTEGER, "
        "filename TEXT, published_at TEXT)"
    )
    conn.execute(
        "INSERT INTO final_videos (id, project_id, filename, published_at) "
        "VALUES (1, NULL, 'old.mp4', '2026-01-01')"
    )
    # One below head so exactly the pending v024 (add poster_filename) applies.
    conn.execute(f"PRAGMA user_version = {PROFILE_DB_RUNNER.latest_version - 1}")
    conn.commit()
    conn.close()
    return path


def _make_head_profile(base):
    """A canonical head-schema profile (via ensure_database) with a published,
    poster-less reel -- the profile that MUST still be scanned."""
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    from app.database import ensure_database, get_database_path

    set_current_user_id(USER_ID)
    set_current_profile_id(GOOD_PROFILE)
    ensure_database()
    path = get_database_path()
    conn = sqlite3.connect(str(path))
    conn.execute(
        "INSERT INTO final_videos (id, filename, published_at, poster_filename) "
        "VALUES (1, 'good.mp4', '2026-01-01', NULL)"
    )
    conn.commit()
    conn.close()
    return path


@pytest.fixture()
def two_profiles(tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        _make_head_profile(tmp_path)      # creates via ensure_database
        _make_below_head_profile(tmp_path)
        yield tmp_path


def test_backfill_migrates_below_head_profile_and_scans_all(two_profiles):
    """Preferred path: the below-head profile is migrated to head, so BOTH
    profiles' candidates are scanned and the run does not crash."""
    def fake_exists(user_id, rel_path):
        # Videos present, posters absent -> both are generation candidates.
        return rel_path.startswith("final_videos/") and not rel_path.startswith(
            "final_videos/posters/"
        )

    with patch("app.services.auth_db.get_all_users_for_admin",
               return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=PROFILE_ORDER), \
         patch("app.storage.file_exists_in_r2", side_effect=fake_exists), \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        res = backfill_posters(limit=25, dry_run=True)

    # Both published poster-less reels scanned -- the below-head one did NOT
    # abort the sweep; it was healed to head and included.
    assert res["scanned"] == 2, res
    assert res["failed"] == [], res

    # The below-head profile now carries the poster_filename column at head.
    old_path = two_profiles / USER_ID / "profiles" / OLD_PROFILE / "profile.sqlite"
    cols = {r[1] for r in sqlite3.connect(str(old_path)).execute(
        "PRAGMA table_info(final_videos)").fetchall()}
    assert "poster_filename" in cols


def test_backfill_records_unhealable_profile_and_continues(two_profiles):
    """Fallback path: if the profile can't be migrated to head (migration
    no-op'd), the candidate query error is recorded in `failed` and the sweep
    continues to the good profile instead of aborting."""
    def fake_exists(user_id, rel_path):
        return rel_path.startswith("final_videos/") and not rel_path.startswith(
            "final_videos/posters/"
        )

    from app.migrations import MigrateResult

    # Simulate a profile that stays below head (e.g. migration verify failed):
    # no column is added, so the candidate query on OLD_PROFILE raises.
    def fake_migrate(user_id, profile_id):
        return MigrateResult(status="not_at_head", applied=[])

    with patch("app.services.auth_db.get_all_users_for_admin",
               return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=PROFILE_ORDER), \
         patch("app.migrations._migrate_profile_db", side_effect=fake_migrate), \
         patch("app.storage.file_exists_in_r2", side_effect=fake_exists), \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        res = backfill_posters(limit=25, dry_run=True)

    # The below-head profile is recorded in `failed` (not a crash)...
    assert len(res["failed"]) == 1, res
    assert res["failed"][0]["profile_id"] == OLD_PROFILE
    assert "candidate_query_failed" in res["failed"][0]["error"]
    # ...and the good profile was still scanned (sweep continued).
    assert res["scanned"] == 1, res
