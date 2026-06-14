"""
T3630: Reel ranking model.

Covers:
- quality_score freeze helpers (single-clip -> rating; multi-clip -> NULL).
- The canonical comparator (ORDER_BY_RANK): ranked above unranked, then quality, then recency.
- Single-clip collection membership + count parity (summary == list_downloads), with
  multi-clip reels routed to Mixes.
- The T3620 resolver adopting ordering + single-clip filter.
- The surgical rank endpoint: set / unrank / 404 / midpoint insertion / renumber.
"""

import asyncio
import sqlite3
import pytest
from unittest.mock import patch

from app.utils.encoding import encode_data
from app.services.collection_metadata import (
    encode_game_ids,
    route_collection,
    compute_project_clip_stats,
    compute_archive_clip_stats,
)

USER_ID = "test-user-t3630"
PROFILE_ID = "testdefault"


@pytest.fixture()
def db(tmp_path):
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _conn(path):
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


_pid = [900]
_rcid = [900]


def _insert_project(cur, archived=False):
    _pid[0] += 1
    cur.execute(
        "INSERT INTO projects (id, name, aspect_ratio, archived_at) VALUES (?, ?, '9:16', ?)",
        (_pid[0], f"P{_pid[0]}", "2026-01-01" if archived else None),
    )
    return _pid[0]


def _insert_raw_clip(cur, *, rating, game_id=None, auto_project_id=None, end_time=None):
    _rcid[0] += 1
    # end_time makes the working-clip identity distinct (the latest-version
    # subquery partitions by COALESCE(rc.end_time, wc.uploaded_filename)); default
    # to the row id so seeded clips are distinct identities.
    cur.execute(
        "INSERT INTO raw_clips (id, filename, rating, game_id, auto_project_id, start_time, end_time) "
        "VALUES (?, 'c.mp4', ?, ?, ?, 0, ?)",
        (_rcid[0], rating, game_id, auto_project_id, end_time if end_time is not None else float(_rcid[0])),
    )
    return _rcid[0]


def _insert_working_clip(cur, project_id, raw_clip_id, version=1):
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, ?)",
        (project_id, raw_clip_id, version),
    )


_fv = [900]


def _insert_fv(cur, *, game_ids=None, ratio="9:16", duration=10.0, tags=None,
               quality_score=5.0, season_rank=None, clip_count=1, project_id=None,
               created_at="2026-01-01 00:00:00", published=True):
    """clip_count defaults to 1 (single-clip = collection-eligible); pass
    clip_count=2 for a multi-clip (Mixes-only) reel."""
    _fv[0] += 1
    if project_id is None:
        project_id = _fv[0]
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, duration, source_type, "
        "name, aspect_ratio, tags, game_ids, quality_score, season_rank, clip_count, published_at, created_at) "
        "VALUES (?, 'f.mp4', 1, ?, 'custom_project', 'Reel', ?, ?, ?, ?, ?, ?, ?, ?)",
        (project_id, duration, ratio,
         encode_data(tags) if tags else None,
         encode_game_ids(game_ids) if game_ids is not None else None,
         quality_score, season_rank, clip_count,
         "2026-01-01 00:00:00" if published else None, created_at),
    )
    return cur.lastrowid


def _downloads(**kwargs):
    from app.routers.downloads import list_downloads
    return asyncio.run(list_downloads(**kwargs))


def _summary():
    from app.routers.collections import collections_summary
    return asyncio.run(collections_summary())


# ---------------------------------------------------------------------------
# route_collection helper
# ---------------------------------------------------------------------------

class TestRouteCollection:
    def test_single_clip_single_game_routes_to_game(self):
        assert route_collection(encode_game_ids([7]), 1) == 7

    def test_multi_clip_routes_to_mixes(self):
        # clip_count != 1 == multi-clip -> Mixes regardless of game_ids
        assert route_collection(encode_game_ids([7]), 2) is None

    def test_unknown_clip_count_routes_to_mixes(self):
        assert route_collection(encode_game_ids([7]), None) is None

    def test_single_clip_game_less_routes_to_mixes(self):
        assert route_collection(None, 1) is None


# ---------------------------------------------------------------------------
# clip_count + quality_score freeze helpers (membership vs ordering)
# ---------------------------------------------------------------------------

class TestClipStatsFreeze:
    def test_brilliant_single_clip(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            pid = _insert_project(cur)
            _insert_raw_clip(cur, rating=4, game_id=1, auto_project_id=pid)
            c.commit()
            assert compute_project_clip_stats(cur, pid) == (1, 4.0)

    def test_single_working_clip(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            pid = _insert_project(cur)
            rc = _insert_raw_clip(cur, rating=5, game_id=1)
            _insert_working_clip(cur, pid, rc)
            c.commit()
            assert compute_project_clip_stats(cur, pid) == (1, 5.0)

    def test_multi_clip_count_no_quality(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            pid = _insert_project(cur)
            for r in (5, 4):
                rc = _insert_raw_clip(cur, rating=r, game_id=1)
                _insert_working_clip(cur, pid, rc)
            c.commit()
            assert compute_project_clip_stats(cur, pid) == (2, None)

    def test_archive_clip_stats(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            rc = _insert_raw_clip(cur, rating=3, game_id=1)
            c.commit()
            assert compute_archive_clip_stats(cur, {"working_clips": [{"raw_clip_id": rc}]}) == (1, 3.0)
            multi = {"working_clips": [{"raw_clip_id": rc}, {"raw_clip_id": rc + 999}]}
            assert compute_archive_clip_stats(cur, multi) == (2, None)


# ---------------------------------------------------------------------------
# Comparator + single-clip membership + parity
# ---------------------------------------------------------------------------

class TestOrderingAndMembership:
    def test_ranked_above_unranked_then_quality_then_recency(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            # all single-clip (quality set), same game so all are members
            _insert_fv(cur, game_ids=[1], quality_score=4.0, season_rank=None,
                       created_at="2026-03-01 00:00:00")           # unranked, q4
            _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=None,
                       created_at="2026-01-01 00:00:00")           # unranked, q5 older
            _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=None,
                       created_at="2026-02-01 00:00:00")           # unranked, q5 newer
            ranked = _insert_fv(cur, game_ids=[1], quality_score=1.0, season_rank=2.0)
            ranked_top = _insert_fv(cur, game_ids=[1], quality_score=1.0, season_rank=1.0)
            c.commit()
        dl = _downloads(game_id=1, aspect_ratio="9:16")
        order = [d.id for d in dl.downloads]
        # ranked first (by rank asc), then unranked by quality desc, then recency desc
        assert order[0] == ranked_top
        assert order[1] == ranked
        # remaining three unranked: q5-newer, q5-older, q4
        assert dl.downloads[2].quality_score == 5.0
        assert dl.downloads[3].quality_score == 5.0
        assert dl.downloads[4].quality_score == 4.0
        assert dl.downloads[2].created_at > dl.downloads[3].created_at

    def test_multi_clip_excluded_from_game_collection_into_mixes(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            single = _insert_fv(cur, game_ids=[1], clip_count=1)   # single-clip game 1
            multi = _insert_fv(cur, game_ids=[1], clip_count=2)    # multi-clip, same game
            c.commit()
        game = _downloads(game_id=1)
        assert [d.id for d in game.downloads] == [single]   # multi-clip excluded
        mixes = _downloads(mixes=True)
        assert multi in [d.id for d in mixes.downloads]      # multi-clip in Mixes
        assert single not in [d.id for d in mixes.downloads]

    def test_summary_membership_parity(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            _insert_fv(cur, game_ids=[1], quality_score=5.0)
            _insert_fv(cur, game_ids=[1], quality_score=4.0)
            _insert_fv(cur, game_ids=[1], clip_count=2)         # multi-clip -> mixes
            c.commit()
        summary = _summary()
        game = next(g for g in summary.games if g.game_id == 1)
        assert game.reel_count == 2                            # only single-clip
        # parity: member fetch count == summary count
        assert _downloads(game_id=1).total_count == game.reel_count
        assert summary.mixes.reel_count == 1                   # the multi-clip reel

    def test_smart_collection_single_clip_only(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            _insert_fv(cur, game_ids=[1], quality_score=5.0, tags=["Goal"])
            _insert_fv(cur, game_ids=[2], clip_count=2, tags=["Goal"])  # multi-clip
            c.commit()
        summary = _summary()
        goals = next((s for s in summary.smart_collections if s.key == "top_goals_assists"), None)
        assert goals is not None
        assert goals.reel_count == 1                            # multi-clip Goal excluded
        members = _downloads(tags="Goal,Assist")
        assert members.total_count == 1


# ---------------------------------------------------------------------------
# Resolver (T3620) adopts ordering + single-clip filter
# ---------------------------------------------------------------------------

class TestResolverOrdering:
    def test_resolver_orders_and_excludes_multiclip(self, db):
        from app.routers.collections import evaluate_collection_members
        with _conn(db) as c:
            cur = c.cursor()
            top = _insert_fv(cur, game_ids=[1], quality_score=2.0, season_rank=1.0)
            mid = _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=None,
                             created_at="2026-05-01 00:00:00")
            _insert_fv(cur, game_ids=[1], clip_count=2)   # multi-clip excluded
            c.commit()
        with _conn(db) as c:
            members = evaluate_collection_members(
                c, {"scope": {"type": "game", "game_id": 1}, "filter": {}, "aspect_ratio": "9:16"})
        ids = [m["id"] for m in members]
        assert ids == [top, mid]   # ranked first, then unranked; multi-clip absent


# ---------------------------------------------------------------------------
# Rank endpoint
# ---------------------------------------------------------------------------

class TestV009Migration:
    """Validate the real ALTER + backfill + collection_settings path on a
    pre-v009 DB (live single-clip path; archived path mirrors v008)."""

    def _pre_v009_db(self, tmp_path):
        path = tmp_path / "pre.sqlite"
        c = sqlite3.connect(str(path))
        c.executescript("""
            CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, aspect_ratio TEXT,
                                   archived_at TIMESTAMP);
            CREATE TABLE raw_clips (id INTEGER PRIMARY KEY, filename TEXT, rating INTEGER NOT NULL,
                                    game_id INTEGER, auto_project_id INTEGER, start_time REAL, end_time REAL);
            CREATE TABLE working_clips (id INTEGER PRIMARY KEY, project_id INTEGER, raw_clip_id INTEGER,
                                        uploaded_filename TEXT, version INTEGER DEFAULT 1);
            CREATE TABLE final_videos (id INTEGER PRIMARY KEY, project_id INTEGER, filename TEXT,
                                       version INTEGER, source_type TEXT, game_id INTEGER, name TEXT,
                                       aspect_ratio TEXT, published_at TIMESTAMP, created_at TIMESTAMP,
                                       duration REAL, tags BLOB, game_ids BLOB);
        """)
        c.commit()
        return path, c

    def test_alter_table_backfill_and_settings(self, tmp_path):
        from app.migrations.profile_db.v009_season_rank import V009SeasonRank
        path, c = self._pre_v009_db(tmp_path)
        # single-clip project (1 working clip) and a multi-clip project (2)
        c.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (1, 'P1', '9:16')")
        c.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (2, 'P2', '9:16')")
        c.execute("INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (10, 'a', 4, 1.0)")
        c.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (1, 10, 1)")
        c.execute("INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (20, 'b', 5, 2.0)")
        c.execute("INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (21, 'c', 4, 3.0)")
        c.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (2, 20, 1)")
        c.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (2, 21, 1)")
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, published_at) "
                  "VALUES (100, 1, 'f1', 1, 'custom_project', '2026-01-01')")  # single -> count 1, q 4.0
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, published_at) "
                  "VALUES (101, 2, 'f2', 1, 'custom_project', '2026-01-01')")  # multi -> count 2, q NULL
        # Orphaned brilliant clip: project gone, no archive -> still single-clip,
        # rating unrecoverable (the bug clip_count fixes).
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, published_at) "
                  "VALUES (102, 999, 'f3', 1, 'brilliant_clip', '2026-01-01')")
        c.commit()

        with patch("app.services.project_archive.load_archive", return_value=None):
            V009SeasonRank().up(c)

        cols = {r[1] for r in c.execute("PRAGMA table_info(final_videos)").fetchall()}
        assert {"season_rank", "quality_score", "clip_count"} <= cols
        assert c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collection_settings'").fetchone()
        rows = {r[0]: (r[1], r[2]) for r in
                c.execute("SELECT id, clip_count, quality_score FROM final_videos").fetchall()}
        assert rows[100] == (1, 4.0)    # single-clip -> count 1, rating
        assert rows[101] == (2, None)   # multi-clip -> count 2, no quality
        assert rows[102] == (1, None)   # orphaned brilliant -> single-clip, rating lost
        c.close()


class TestRankEndpoint:
    def _set(self, **kwargs):
        from app.routers.downloads import set_rank, RankRequest
        download_id = kwargs.pop("download_id")
        return asyncio.run(set_rank(download_id, RankRequest(**kwargs)))

    def _rank(self, db, fid):
        with _conn(db) as c:
            row = c.execute("SELECT season_rank FROM final_videos WHERE id=?", (fid,)).fetchone()
            return row["season_rank"]

    def test_set_and_clear_rank(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            fid = _insert_fv(cur, game_ids=[1], quality_score=5.0)
            c.commit()
        self._set(download_id=fid, rank=3.5)
        assert self._rank(db, fid) == 3.5
        self._set(download_id=fid, rank=None)
        assert self._rank(db, fid) is None

    def test_unpublished_or_missing_404(self, db):
        from fastapi import HTTPException
        with _conn(db) as c:
            cur = c.cursor()
            unpub = _insert_fv(cur, game_ids=[1], quality_score=5.0, published=False)
            c.commit()
        with pytest.raises(HTTPException) as e:
            self._set(download_id=unpub, rank=1.0)
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            self._set(download_id=999999, rank=1.0)
        assert e.value.status_code == 404

    def test_midpoint_insertion(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            a = _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=3.0)
            b = _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=4.0)
            x = _insert_fv(cur, game_ids=[1], quality_score=5.0)
            c.commit()
        res = self._set(download_id=x, prev_id=a, next_id=b)
        assert res["rank"] == 3.5
        assert self._rank(db, x) == 3.5

    def test_insertion_at_ends(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            a = _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=2.0)
            top = _insert_fv(cur, game_ids=[1], quality_score=5.0)
            bottom = _insert_fv(cur, game_ids=[1], quality_score=5.0)
            c.commit()
        assert self._set(download_id=top, next_id=a)["rank"] == 1.0   # 2.0 - 1
        assert self._set(download_id=bottom, prev_id=a)["rank"] == 3.0  # 2.0 + 1

    def test_renumber_on_exhausted_gap(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            a = _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=1.0)
            b = _insert_fv(cur, game_ids=[1], quality_score=5.0, season_rank=1.0 + 1e-9)
            x = _insert_fv(cur, game_ids=[1], quality_score=5.0)
            c.commit()
        res = self._set(download_id=x, prev_id=a, next_id=b)
        # after renumber a->1, b->2, midpoint 1.5
        assert res["rank"] == 1.5
        assert self._rank(db, a) == 1.0
        assert self._rank(db, b) == 2.0
