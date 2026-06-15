"""
T3630: Reel ranking GAME (pairwise Glicko).

Covers:
- Glicko-1 update math (winner up / loser down, RD shrinks), seeding, confidence.
- clip_count / quality_score freeze helpers + single-clip identity freeze.
- The canonical comparator (ORDER_BY_RANK): rating DESC, then quality, then recency.
- Single-clip collection membership + count parity (summary == list_downloads).
- The T3620 resolver adopting ordering + single-clip filter.
- v009 backfill of the new ranking columns (incl. orphaned brilliant clip).
- Pairing (least-matched first, nearest-rating opponent, no immediate repeat).
- The rank endpoints: next shape, result update + twin sync, confidence, empty pool.
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
    compute_project_clip_identity,
)
from app.services import glicko

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


def _insert_raw_clip(cur, *, rating, game_id=None, auto_project_id=None,
                     start_time=0.0, end_time=None):
    _rcid[0] += 1
    cur.execute(
        "INSERT INTO raw_clips (id, filename, rating, game_id, auto_project_id, start_time, end_time) "
        "VALUES (?, 'c.mp4', ?, ?, ?, ?, ?)",
        (_rcid[0], rating, game_id, auto_project_id, start_time,
         end_time if end_time is not None else float(_rcid[0])),
    )
    return _rcid[0]


def _insert_working_clip(cur, project_id, raw_clip_id, version=1):
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, ?)",
        (project_id, raw_clip_id, version),
    )


_fv = [900]


def _insert_fv(cur, *, game_ids=None, ratio="9:16", duration=10.0, tags=None,
               quality_score=5.0, rating=None, rd=glicko.RD_MAX, match_count=0,
               source_clip_id=None, clip_start_time=None, clip_count=1,
               project_id=None, created_at="2026-01-01 00:00:00", published=True):
    """clip_count defaults to 1 (single-clip = collection-eligible + rankable);
    pass clip_count=2 for a multi-clip (Mixes-only) reel. rating defaults to the
    star seed when not given (mirrors the export freeze)."""
    _fv[0] += 1
    if project_id is None:
        project_id = _fv[0]
    if rating is None and clip_count == 1:
        rating = glicko.seed_rating(quality_score)
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, duration, source_type, "
        "name, aspect_ratio, tags, game_ids, quality_score, clip_count, rating, rd, "
        "match_count, source_clip_id, clip_start_time, published_at, created_at) "
        "VALUES (?, 'f.mp4', 1, ?, 'custom_project', 'Reel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (project_id, duration, ratio,
         encode_data(tags) if tags else None,
         encode_game_ids(game_ids) if game_ids is not None else None,
         quality_score, clip_count, rating, rd, match_count,
         source_clip_id, clip_start_time,
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
# Glicko engine (pure math)
# ---------------------------------------------------------------------------

class TestGlicko:
    def test_winner_up_loser_down_rd_shrinks(self):
        wr, wrd, lr, lrd = 1500.0, glicko.RD_MAX, 1500.0, glicko.RD_MAX
        nw_r, nw_rd = glicko.update_one(wr, wrd, lr, lrd, 1.0)
        nl_r, nl_rd = glicko.update_one(lr, lrd, wr, wrd, 0.0)
        assert nw_r > wr and nl_r < lr
        assert nw_rd < wrd and nl_rd < lrd
        # Symmetric start -> symmetric rating move.
        assert round(nw_r - 1500, 3) == round(1500 - nl_r, 3)

    def test_rd_floor(self):
        # Many wins drive RD toward the floor but never below it.
        r, rd = 1500.0, glicko.RD_MAX
        for _ in range(200):
            r, rd = glicko.update_one(r, rd, 1500.0, 60.0, 1.0)
        assert rd >= glicko.RD_MIN

    def test_seed_from_star(self):
        assert glicko.seed_rating(5) == 1580.0
        assert glicko.seed_rating(3) == 1500.0
        assert glicko.seed_rating(1) == 1420.0
        assert glicko.seed_rating(None) == 1500.0  # neutral, no silent guess

    def test_confidence_bounds(self):
        assert glicko.confidence(glicko.RD_MAX) == 0.0
        assert glicko.confidence(glicko.RD_MIN) == 1.0
        assert 0.0 < glicko.confidence(200.0) < 1.0


# ---------------------------------------------------------------------------
# route_collection helper
# ---------------------------------------------------------------------------

class TestRouteCollection:
    def test_single_clip_single_game_routes_to_game(self):
        assert route_collection(encode_game_ids([7]), 1) == 7

    def test_multi_clip_routes_to_mixes(self):
        assert route_collection(encode_game_ids([7]), 2) is None

    def test_unknown_clip_count_routes_to_mixes(self):
        assert route_collection(encode_game_ids([7]), None) is None

    def test_single_clip_game_less_routes_to_mixes(self):
        assert route_collection(None, 1) is None


# ---------------------------------------------------------------------------
# clip_count + quality + identity freeze helpers
# ---------------------------------------------------------------------------

class TestClipStatsFreeze:
    def test_single_working_clip_stats_and_identity(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            pid = _insert_project(cur)
            rc = _insert_raw_clip(cur, rating=5, game_id=1, start_time=2000.0)
            _insert_working_clip(cur, pid, rc)
            c.commit()
            assert compute_project_clip_stats(cur, pid) == (1, 5.0)
            assert compute_project_clip_identity(cur, pid) == (rc, 2000.0)

    def test_multi_clip_no_quality_no_identity(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            pid = _insert_project(cur)
            for r in (5, 4):
                rc = _insert_raw_clip(cur, rating=r, game_id=1)
                _insert_working_clip(cur, pid, rc)
            c.commit()
            assert compute_project_clip_stats(cur, pid) == (2, None)
            assert compute_project_clip_identity(cur, pid) == (None, None)

    def test_brilliant_single_clip_identity(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            pid = _insert_project(cur)
            rc = _insert_raw_clip(cur, rating=4, game_id=1, auto_project_id=pid,
                                  start_time=33 * 60 + 5)
            c.commit()
            assert compute_project_clip_stats(cur, pid) == (1, 4.0)
            sid, start = compute_project_clip_identity(cur, pid)
            assert sid == rc and start == 33 * 60 + 5


# ---------------------------------------------------------------------------
# Comparator + single-clip membership + parity
# ---------------------------------------------------------------------------

class TestOrderingAndMembership:
    def test_rating_desc_then_quality_then_recency(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            top = _insert_fv(cur, game_ids=[1], rating=1700.0, quality_score=5.0)
            mid = _insert_fv(cur, game_ids=[1], rating=1500.0, quality_score=3.0)
            # Equal rating: quality breaks the tie, then recency.
            q5n = _insert_fv(cur, game_ids=[1], rating=1400.0, quality_score=5.0,
                             created_at="2026-02-01 00:00:00")
            q5o = _insert_fv(cur, game_ids=[1], rating=1400.0, quality_score=5.0,
                             created_at="2026-01-01 00:00:00")
            q4 = _insert_fv(cur, game_ids=[1], rating=1400.0, quality_score=4.0)
            c.commit()
        order = [d.id for d in _downloads(game_id=1, aspect_ratio="9:16").downloads]
        assert order[0] == top
        assert order[1] == mid
        assert order[2] == q5n   # equal rating, q5 newer
        assert order[3] == q5o   # equal rating, q5 older
        assert order[4] == q4    # equal rating, q4 last

    def test_multi_clip_excluded_into_mixes(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            single = _insert_fv(cur, game_ids=[1], clip_count=1)
            multi = _insert_fv(cur, game_ids=[1], clip_count=2, rating=None)
            c.commit()
        assert [d.id for d in _downloads(game_id=1).downloads] == [single]
        mixes = [d.id for d in _downloads(mixes=True).downloads]
        assert multi in mixes and single not in mixes

    def test_summary_membership_parity(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            _insert_fv(cur, game_ids=[1], quality_score=5.0)
            _insert_fv(cur, game_ids=[1], quality_score=4.0)
            _insert_fv(cur, game_ids=[1], clip_count=2, rating=None)
            c.commit()
        summary = _summary()
        game = next(g for g in summary.games if g.game_id == 1)
        assert game.reel_count == 2
        assert _downloads(game_id=1).total_count == game.reel_count
        assert summary.mixes.reel_count == 1


# ---------------------------------------------------------------------------
# Resolver (T3620) adopts ordering + single-clip filter
# ---------------------------------------------------------------------------

class TestResolverOrdering:
    def test_resolver_orders_by_rating_and_excludes_multiclip(self, db):
        from app.routers.collections import evaluate_collection_members
        with _conn(db) as c:
            cur = c.cursor()
            top = _insert_fv(cur, game_ids=[1], rating=1700.0, quality_score=2.0)
            mid = _insert_fv(cur, game_ids=[1], rating=1500.0, quality_score=5.0)
            _insert_fv(cur, game_ids=[1], clip_count=2, rating=None)
            c.commit()
        with _conn(db) as c:
            members = evaluate_collection_members(
                c, {"scope": {"type": "game", "game_id": 1}, "filter": {}, "aspect_ratio": "9:16"})
        assert [m["id"] for m in members] == [top, mid]


# ---------------------------------------------------------------------------
# v009 migration backfill
# ---------------------------------------------------------------------------

class TestV009Migration:
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

    def test_alter_backfill_and_settings(self, tmp_path):
        from app.migrations.profile_db.v009_season_rank import V009SeasonRank
        path, c = self._pre_v009_db(tmp_path)
        c.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (1, 'P1', '9:16')")
        c.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (2, 'P2', '9:16')")
        # single-clip project 1: raw clip 10, 4 star, start 600s
        c.execute("INSERT INTO raw_clips (id, filename, rating, start_time, end_time) VALUES (10, 'a', 4, 600.0, 1.0)")
        c.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (1, 10, 1)")
        # multi-clip project 2
        c.execute("INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (20, 'b', 5, 2.0)")
        c.execute("INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (21, 'c', 4, 3.0)")
        c.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (2, 20, 1)")
        c.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (2, 21, 1)")
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, published_at) "
                  "VALUES (100, 1, 'f1', 1, 'custom_project', '2026-01-01')")
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, published_at) "
                  "VALUES (101, 2, 'f2', 1, 'custom_project', '2026-01-01')")
        # Orphaned brilliant clip: project gone, no archive.
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, published_at) "
                  "VALUES (102, 999, 'f3', 1, 'brilliant_clip', '2026-01-01')")
        c.commit()

        with patch("app.services.project_archive.load_archive", return_value=None):
            V009SeasonRank().up(c)

        cols = {r[1] for r in c.execute("PRAGMA table_info(final_videos)").fetchall()}
        assert {"clip_count", "quality_score", "rating", "rd", "match_count",
                "source_clip_id", "clip_start_time"} <= cols
        assert c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collection_settings'").fetchone()

        c.row_factory = sqlite3.Row
        rows = {r["id"]: r for r in
                c.execute("SELECT id, clip_count, quality_score, rating, rd, match_count, "
                          "source_clip_id, clip_start_time FROM final_videos").fetchall()}
        # single-clip -> count 1, q4, rating seed 1540, rd 350, source 10, start 600
        assert rows[100]["clip_count"] == 1
        assert rows[100]["quality_score"] == 4.0
        assert rows[100]["rating"] == glicko.seed_rating(4.0)
        assert rows[100]["rd"] == glicko.RD_MAX
        assert rows[100]["match_count"] == 0
        assert rows[100]["source_clip_id"] == 10
        assert rows[100]["clip_start_time"] == 600.0
        # multi-clip -> count 2, no quality/rating/source
        assert rows[101]["clip_count"] == 2
        assert rows[101]["quality_score"] is None
        assert rows[101]["rating"] is None
        assert rows[101]["source_clip_id"] is None
        # orphaned brilliant -> single-clip, rating neutral, source/start lost
        assert rows[102]["clip_count"] == 1
        assert rows[102]["quality_score"] is None
        assert rows[102]["rating"] == glicko.seed_rating(None)
        assert rows[102]["source_clip_id"] is None
        c.close()

    def test_v010_seeds_rating_on_a_v9_draft_db(self, tmp_path):
        """A DB stamped by the v009 DRAFT (season_rank/clip_count/quality_score, NO
        rating) -> v010 adds the ranking columns and seeds rating from quality."""
        from app.migrations.profile_db.v010_ranking_columns import V010RankingColumns
        path, c = self._pre_v009_db(tmp_path)
        # Simulate the draft outcome: clip_count/quality_score present, no rating.
        c.execute("ALTER TABLE final_videos ADD COLUMN season_rank REAL")
        c.execute("ALTER TABLE final_videos ADD COLUMN clip_count INTEGER")
        c.execute("ALTER TABLE final_videos ADD COLUMN quality_score REAL")
        c.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (1, 'P1', '9:16')")
        c.execute("INSERT INTO raw_clips (id, filename, rating, start_time, end_time) VALUES (10, 'a', 4, 600.0, 1.0)")
        c.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (1, 10, 1)")
        # single-clip reel (already backfilled by the draft), and a multi-clip reel.
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, "
                  "published_at, clip_count, quality_score) "
                  "VALUES (200, 1, 'f', 1, 'custom_project', '2026-01-01', 1, 4.0)")
        c.execute("INSERT INTO final_videos (id, project_id, filename, version, source_type, "
                  "published_at, clip_count, quality_score) "
                  "VALUES (201, NULL, 'g', 1, 'custom_project', '2026-01-01', 2, NULL)")
        c.commit()

        with patch("app.services.project_archive.load_archive", return_value=None):
            V010RankingColumns().up(c)

        c.row_factory = sqlite3.Row
        cols = {r["name"] for r in c.execute("PRAGMA table_info(final_videos)").fetchall()}
        assert {"rating", "rd", "match_count", "source_clip_id", "clip_start_time"} <= cols
        rows = {r["id"]: r for r in c.execute(
            "SELECT id, rating, rd, source_clip_id, clip_start_time FROM final_videos").fetchall()}
        assert rows[200]["rating"] == glicko.seed_rating(4.0)
        assert rows[200]["rd"] == glicko.RD_MAX
        assert rows[200]["source_clip_id"] == 10
        assert rows[200]["clip_start_time"] == 600.0
        assert rows[201]["rating"] is None  # multi-clip stays unranked
        c.close()


# ---------------------------------------------------------------------------
# Pairing (spec §4.3)
# ---------------------------------------------------------------------------

class TestPairing:
    def _reel(self, rid, rating, mc):
        return {"id": rid, "rating": rating, "match_count": mc}

    def test_least_matched_candidate_and_nearest_opponent(self):
        from app.routers.rank import _pick_pair
        pool = [
            self._reel(1, 1500, 5),
            self._reel(2, 1490, 0),   # least matched -> candidate
            self._reel(3, 1495, 3),   # nearest to 1490
            self._reel(4, 1700, 1),
        ]
        cand, opp = _pick_pair(pool, exclude_id=None)
        assert cand["id"] == 2
        assert opp["id"] == 3

    def test_no_immediate_repeat(self):
        from app.routers.rank import _pick_pair
        pool = [
            self._reel(1, 1500, 0),   # candidate
            self._reel(2, 1499, 2),   # nearest, but excluded (last opponent)
            self._reel(3, 1480, 2),   # next nearest
        ]
        cand, opp = _pick_pair(pool, exclude_id=2)
        assert cand["id"] == 1
        assert opp["id"] == 3

    def test_exclude_ignored_when_only_option(self):
        from app.routers.rank import _pick_pair
        pool = [self._reel(1, 1500, 0), self._reel(2, 1499, 2)]
        cand, opp = _pick_pair(pool, exclude_id=2)
        assert {cand["id"], opp["id"]} == {1, 2}

    def test_too_small_pool(self):
        from app.routers.rank import _pick_pair
        assert _pick_pair([{"id": 1, "rating": 1500, "match_count": 0}], None) == (None, None)


# ---------------------------------------------------------------------------
# Rank endpoints (next / result / confidence)
# ---------------------------------------------------------------------------

class TestRankEndpoints:
    def _next(self, **kw):
        from app.routers.rank import rank_next
        return asyncio.run(rank_next(**kw))

    def _result(self, winner_id, loser_id):
        from app.routers.rank import rank_result, RankResultRequest
        return asyncio.run(rank_result(RankResultRequest(winner_id=winner_id, loser_id=loser_id)))

    def _confidence(self, ratio="9:16"):
        from app.routers.rank import rank_confidence
        return asyncio.run(rank_confidence(aspect_ratio=ratio))

    def _restore(self, undo):
        from app.routers.rank import rank_restore
        return asyncio.run(rank_restore(undo))

    def test_next_shape_and_empty_pool(self, db):
        # Empty / single-reel pool -> 204.
        with _conn(db) as c:
            cur = c.cursor()
            a = _insert_fv(cur, game_ids=[1], source_clip_id=1)
            c.commit()
        assert getattr(self._next(aspect_ratio="9:16"), "status_code", None) == 204
        with _conn(db) as c:
            cur = c.cursor()
            b = _insert_fv(cur, game_ids=[2], source_clip_id=2)
            c.commit()
        m = self._next(aspect_ratio="9:16")
        assert {m.a.id, m.b.id} == {a, b}
        assert m.a.stream_url.endswith(f"/api/downloads/{m.a.id}/stream")

    def test_result_updates_and_confidence_rises(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            w = _insert_fv(cur, game_ids=[1], source_clip_id=10, quality_score=3.0)
            l = _insert_fv(cur, game_ids=[2], source_clip_id=20, quality_score=3.0)
            c.commit()
        # Before any match: confidence 0, nothing ranked.
        pre = self._confidence()
        assert pre.confidence_pct == 0 and pre.ranked_count == 0 and pre.total == 2
        res = self._result(w, l)
        assert res.confidence_pct > 0
        assert res.ranked_count == 2 and res.total == 2
        with _conn(db) as c:
            rows = {r["id"]: r for r in c.execute(
                "SELECT id, rating, rd, match_count FROM final_videos").fetchall()}
        assert rows[w]["rating"] > rows[l]["rating"]
        assert rows[w]["rd"] < glicko.RD_MAX and rows[l]["rd"] < glicko.RD_MAX
        assert rows[w]["match_count"] == 1 and rows[l]["match_count"] == 1

    def test_undo_restores_pre_pick_state(self, db):
        # A pick moves ratings + match_count; /restore (rematch) reverts both
        # reels (and twins) exactly to the pre-pick snapshot.
        with _conn(db) as c:
            cur = c.cursor()
            w = _insert_fv(cur, game_ids=[1], source_clip_id=10, quality_score=3.0)
            l = _insert_fv(cur, game_ids=[2], source_clip_id=20, quality_score=3.0)
            tw = _insert_fv(cur, ratio="16:9", game_ids=[1], source_clip_id=10, quality_score=3.0)  # winner's twin (same seed)
            c.commit()
        snap = lambda: {r["id"]: (r["rating"], r["rd"], r["match_count"]) for r in
                        _conn(db).execute("SELECT id, rating, rd, match_count FROM final_videos")}
        pre = snap()
        res = self._result(w, l)
        assert res.undo is not None
        post = snap()
        assert post[w][2] == 1 and post[l][2] == 1 and post[tw][2] == 1  # match_count bumped (twin too)
        assert post[w] != pre[w]
        # Rematch: restore reverts everything, including the winner's twin.
        self._restore(res.undo)
        back = snap()
        assert back[w] == pre[w] and back[l] == pre[l] and back[tw] == pre[tw]

    def test_twin_sync_by_source_clip_id(self, db):
        # Portrait + Landscape twins share source_clip_id=10; a Portrait pick
        # must move the Landscape twin too.
        with _conn(db) as c:
            cur = c.cursor()
            portrait = _insert_fv(cur, ratio="9:16", game_ids=[1], source_clip_id=10)
            landscape = _insert_fv(cur, ratio="16:9", game_ids=[1], source_clip_id=10)
            opp = _insert_fv(cur, ratio="9:16", game_ids=[2], source_clip_id=20)
            c.commit()
        self._result(portrait, opp)
        with _conn(db) as c:
            rows = {r["id"]: r for r in c.execute(
                "SELECT id, rating, rd, match_count FROM final_videos").fetchall()}
        # Landscape twin mirrors the Portrait winner exactly.
        assert rows[landscape]["rating"] == rows[portrait]["rating"]
        assert rows[landscape]["rd"] == rows[portrait]["rd"]
        assert rows[landscape]["match_count"] == 1

    def test_result_missing_rating_surfaced(self, db):
        from fastapi import HTTPException
        with _conn(db) as c:
            cur = c.cursor()
            ok = _insert_fv(cur, game_ids=[1], source_clip_id=10)
            broken = _insert_fv(cur, game_ids=[2], clip_count=1)
            # Force a genuine seed gap (rating NULL) past _insert_fv's auto-seed.
            cur.execute("UPDATE final_videos SET rating = NULL WHERE id = ?", (broken,))
            c.commit()
        with pytest.raises(HTTPException) as e:
            self._result(ok, broken)
        assert e.value.status_code == 400

    def test_target_matchups_scales_with_size(self):
        from app.routers.rank import _target_matchups
        assert _target_matchups(2) == 3        # floor (clamped up)
        assert _target_matchups(8) == 3        # ceil(log2 8) = 3
        assert _target_matchups(9) == 4
        assert _target_matchups(64) == 6
        assert _target_matchups(1000) == 8     # cap

    def test_coverage_confidence_and_eligibility(self, db):
        # 4 single-clip reels x 10s = 40s -> rankable (>= 30s). Target K = 3.
        with _conn(db) as c:
            cur = c.cursor()
            [_insert_fv(cur, game_ids=[i], source_clip_id=i, duration=10.0)
             for i in range(1, 5)]
            c.commit()
        # Nothing sorted -> 0%, but eligible (there's ranking work to do).
        pre = self._confidence()
        assert pre.confidence_pct == 0 and pre.total == 4 and pre.eligible is True
        # Sort every clip to its target -> 100% and NOT eligible (caught up).
        with _conn(db) as c:
            c.execute("UPDATE final_videos SET match_count = 3")
            c.commit()
        done = self._confidence()
        assert done.confidence_pct == 100 and done.eligible is False
        # The sorter exhausts (204) exactly when coverage is complete.
        assert getattr(self._next(aspect_ratio="9:16"), "status_code", None) == 204

    def test_partial_coverage_under_100_and_still_eligible(self, db):
        # K = 3 for 4 reels. match_counts 3,3,1,0 -> coverage (1+1+1/3+0)/4 = 58%.
        with _conn(db) as c:
            cur = c.cursor()
            ids = [_insert_fv(cur, game_ids=[i], source_clip_id=i, duration=10.0)
                   for i in range(1, 5)]
            c.commit()
        with _conn(db) as c:
            c.execute("UPDATE final_videos SET match_count=3 WHERE id IN (?,?)", (ids[0], ids[1]))
            c.execute("UPDATE final_videos SET match_count=1 WHERE id=?", (ids[2],))
            c.commit()
        r = self._confidence()
        assert r.confidence_pct == 58 and r.eligible is True  # not 100 while a clip is unsorted

    def test_orphan_updates_only_itself(self, db):
        # source_clip_id NULL -> per-reel rating (update only its own row).
        with _conn(db) as c:
            cur = c.cursor()
            orphan = _insert_fv(cur, game_ids=[1], source_clip_id=None)
            opp = _insert_fv(cur, game_ids=[2], source_clip_id=20)
            c.commit()
        self._result(orphan, opp)
        with _conn(db) as c:
            row = c.execute("SELECT rating, match_count FROM final_videos WHERE id=?",
                            (orphan,)).fetchone()
        assert row["match_count"] == 1 and row["rating"] > glicko.seed_rating(5.0)
