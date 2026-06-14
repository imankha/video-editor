"""
T3610: Collections summary endpoint + downloads game_id/mixes/aspect_ratio
filters, and the shared route_game_ids helper.

Game attribution is read from the FROZEN final_videos.game_ids BLOB (T3605) by
both /api/collections/summary and the /api/downloads filters, so member counts
always equal summary counts (parity is asserted directly here).
"""

import asyncio
import sqlite3
import pytest
from unittest.mock import patch

from app.utils.encoding import encode_data
from app.services.collection_metadata import encode_game_ids, route_game_ids

USER_ID = "test-user-t3610"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Fixtures + seed helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path):
    """Profile DB built by the real ensure_database() (canonical schema)."""
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


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


_next_project = [100]


def _insert_game(cur, game_id, opponent="Carlsbad", date="2025-12-06"):
    cur.execute(
        "INSERT INTO games (id, name, game_date, opponent_name, game_type) "
        "VALUES (?, ?, ?, ?, 'home')",
        (game_id, f"Game {game_id}", date, opponent),
    )


def _insert_fv(cur, *, game_ids=None, ratio="9:16", duration=10.0, tags=None,
               published_at="2026-01-01 00:00:00", created_at="2026-01-01 00:00:00",
               source_type="custom_project", version=1, project_id=None,
               quality_score=5.0):
    """Insert one final_video with frozen columns. Each reel gets a distinct
    project_id by default so latest_final_videos_subquery keeps them all.
    quality_score defaults to a single-clip value (T3630: collections are
    single-clip only); pass quality_score=None to seed a multi-clip reel."""
    if project_id is None:
        _next_project[0] += 1
        project_id = _next_project[0]
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, duration, "
        "source_type, name, aspect_ratio, tags, game_ids, quality_score, published_at, created_at) "
        "VALUES (?, 'f.mp4', ?, ?, ?, 'Reel', ?, ?, ?, ?, ?, ?)",
        (project_id, version, duration, source_type, ratio,
         encode_data(tags) if tags else None,
         encode_game_ids(game_ids) if game_ids is not None else None,
         quality_score, published_at, created_at),
    )
    return cur.lastrowid, project_id


def _summary():
    from app.routers.collections import collections_summary
    return asyncio.run(collections_summary())


def _downloads(**kwargs):
    from app.routers.downloads import list_downloads
    return asyncio.run(list_downloads(**kwargs))


# ---------------------------------------------------------------------------
# route_game_ids helper
# ---------------------------------------------------------------------------

class TestRouteGameIds:
    def test_single_game_routes_to_that_game(self):
        assert route_game_ids(encode_game_ids([7])) == 7

    def test_multi_game_routes_to_mixes(self):
        assert route_game_ids(encode_game_ids([3, 7])) is None

    def test_empty_and_null_route_to_mixes(self):
        assert route_game_ids(encode_game_ids([])) is None  # encodes to None
        assert route_game_ids(None) is None


# ---------------------------------------------------------------------------
# Summary attribution
# ---------------------------------------------------------------------------

class TestSummaryAttribution:
    def test_single_game_attributed(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=15.0)
        conn.commit(); conn.close()

        s = _summary()
        assert len(s.games) == 1
        g = s.games[0]
        assert g.game_id == 7
        assert g.game_name == "Vs Carlsbad Dec 6"
        assert g.reel_count == 2
        assert g.ratio_counts == {"9:16": 2}
        assert g.ratio_durations == {"9:16": 35.0}
        assert s.mixes.reel_count == 0
        assert s.total_reel_count == 2

    def test_multi_game_goes_to_mixes(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 3); _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[3, 7], ratio="9:16", duration=40.0)
        conn.commit(); conn.close()

        s = _summary()
        assert s.games == []
        assert s.mixes.reel_count == 1
        assert s.mixes.ratio_durations == {"9:16": 40.0}

    def test_gameless_reel_goes_to_mixes(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_fv(cur, game_ids=None, ratio="16:9", duration=12.0)
        conn.commit(); conn.close()

        s = _summary()
        assert s.games == []
        assert s.mixes.reel_count == 1

    def test_deleted_game_keeps_attribution_with_fallback_name(self, db):
        """game_ids=[N] whose games row is gone still belongs to game N
        (frozen id authoritative); display falls back to 'Game N'."""
        conn = _connect(db)
        cur = conn.cursor()
        _insert_fv(cur, game_ids=[42], ratio="9:16", duration=33.0)  # no games row
        conn.commit(); conn.close()

        s = _summary()
        assert len(s.games) == 1
        assert s.games[0].game_id == 42
        assert s.games[0].game_name == "Game 42"
        assert s.games[0].game_date is None


# ---------------------------------------------------------------------------
# Ratio-as-identity eligibility (>= COLLECTION_MIN_DURATION_SEC)
# ---------------------------------------------------------------------------

class TestRatioEligibility:
    def test_one_ratio_eligible_other_not(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=40.0)   # eligible
        _insert_fv(cur, game_ids=[7], ratio="16:9", duration=10.0)   # sub-30s
        conn.commit(); conn.close()

        g = _summary().games[0]
        assert g.ratio_eligible == {"9:16": True, "16:9": False}
        assert g.ratio_durations == {"9:16": 40.0, "16:9": 10.0}

    def test_both_ratios_eligible(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=40.0)
        _insert_fv(cur, game_ids=[7], ratio="16:9", duration=35.0)
        conn.commit(); conn.close()

        g = _summary().games[0]
        assert g.ratio_eligible == {"9:16": True, "16:9": True}

    def test_exactly_30s_is_eligible(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=30.0)
        conn.commit(); conn.close()

        assert _summary().games[0].ratio_eligible == {"9:16": True}


# ---------------------------------------------------------------------------
# NULL handling (no silent fallback)
# ---------------------------------------------------------------------------

class TestNullHandling:
    def test_null_duration_excluded_but_counted(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=None)
        conn.commit(); conn.close()

        g = _summary().games[0]
        assert g.reel_count == 2
        assert g.ratio_counts == {"9:16": 2}
        assert g.ratio_durations == {"9:16": 20.0}
        assert g.total_duration == 20.0
        assert g.has_null_durations is True
        assert g.ratio_eligible == {"9:16": False}  # 20 < 30

    def test_null_aspect_ratio_excluded_and_logged(self, db, caplog):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0)
        _insert_fv(cur, game_ids=[7], ratio=None, duration=20.0)   # bug row
        conn.commit(); conn.close()

        with caplog.at_level("WARNING"):
            s = _summary()
        assert s.total_reel_count == 1
        assert s.games[0].reel_count == 1
        assert "NULL aspect_ratio" in caplog.text


# ---------------------------------------------------------------------------
# Versioning + publish filter
# ---------------------------------------------------------------------------

class TestVersioningAndPublish:
    def test_only_latest_published_versions(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        # Two versions of the same project: only v2 counts
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=5.0,
                   version=1, project_id=500)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=25.0,
                   version=2, project_id=500)
        # Unpublished reel excluded
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=99.0,
                   published_at=None)
        conn.commit(); conn.close()

        g = _summary().games[0]
        assert g.reel_count == 1
        assert g.ratio_durations == {"9:16": 25.0}


# ---------------------------------------------------------------------------
# Season + tag totals
# ---------------------------------------------------------------------------

class TestSeasonAndTagTotals:
    def test_season_from_game_date_and_created_at(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7, date="2025-12-06")              # Fall 2025
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0)
        # game-less mix uses created_at (Spring 2026)
        _insert_fv(cur, game_ids=None, ratio="9:16", duration=10.0,
                   created_at="2026-02-01 00:00:00")
        conn.commit(); conn.close()

        s = _summary()
        seasons = {(t.season, t.ratio): t for t in s.season_totals}
        assert seasons[("Fall 2025", "9:16")].total_duration == 20.0
        assert seasons[("Spring 2026", "9:16")].total_duration == 10.0

    def test_tag_totals_per_ratio_with_eligibility(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0,
                   tags=["Goal", "Dribble"])
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=15.0, tags=["Goal"])
        conn.commit(); conn.close()

        s = _summary()
        tags = {(t.tag, t.ratio): t for t in s.tag_totals}
        assert tags[("Goal", "9:16")].total_duration == 35.0
        assert tags[("Goal", "9:16")].eligible is True       # 35 >= 30
        assert tags[("Dribble", "9:16")].total_duration == 20.0
        assert tags[("Dribble", "9:16")].eligible is False   # 20 < 30


# ---------------------------------------------------------------------------
# Downloads filters + count parity
# ---------------------------------------------------------------------------

class TestDownloadsFilters:
    def _seed_mixed(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7); _insert_game(cur, 8)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0)
        _insert_fv(cur, game_ids=[7], ratio="16:9", duration=10.0)
        _insert_fv(cur, game_ids=[8], ratio="9:16", duration=12.0)
        _insert_fv(cur, game_ids=[7, 8], ratio="9:16", duration=40.0)  # mix
        _insert_fv(cur, game_ids=None, ratio="9:16", duration=8.0)     # game-less mix
        conn.commit(); conn.close()

    def test_game_id_filter_matches_summary_count(self, db):
        self._seed_mixed(db)
        s = _summary()
        g7 = next(g for g in s.games if g.game_id == 7)
        members = _downloads(game_id=7)
        # game 7 has 2 reels (the [7,8] reel routes to mixes, not game 7)
        assert members.total_count == g7.reel_count == 2

    def test_mixes_filter_matches_summary_count(self, db):
        self._seed_mixed(db)
        s = _summary()
        members = _downloads(mixes=True)
        assert members.total_count == s.mixes.reel_count == 2

    def test_aspect_ratio_filter(self, db):
        self._seed_mixed(db)
        # game 7 has one 9:16 + one 16:9; ratio-scoped member fetch
        members = _downloads(game_id=7, aspect_ratio="16:9")
        assert members.total_count == 1
        assert members.downloads[0].aspect_ratio == "16:9"

    def test_ratio_scoped_member_count_matches_summary(self, db):
        self._seed_mixed(db)
        s = _summary()
        g7 = next(g for g in s.games if g.game_id == 7)
        for ratio, count in g7.ratio_counts.items():
            members = _downloads(game_id=7, aspect_ratio=ratio)
            assert members.total_count == count

    def test_total_parity_with_unfiltered_downloads(self, db):
        self._seed_mixed(db)
        s = _summary()
        alld = _downloads()
        assert s.total_reel_count == alld.total_count

    def test_game_id_and_mixes_mutually_exclusive(self, db):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            _downloads(game_id=7, mixes=True)
        assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# Smart collections (Top Plays / Goals & Assists / Dribbles)
# ---------------------------------------------------------------------------

class TestSmartCollections:
    def _seed_tagged(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        # Two goal reels (one also tagged Assist) + one dribble reel, all portrait.
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0, tags=["Goal"])
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=15.0, tags=["Goal", "Assist"])
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=12.0, tags=["Dribble"])
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=5.0, tags=["Pass"])  # untagged-for-smart
        conn.commit(); conn.close()

    def test_groups_present_and_deduped(self, db):
        self._seed_tagged(db)
        s = _summary()
        smart = {sc.key: sc for sc in s.smart_collections}

        # top_plays = all 4 reels
        assert smart["top_plays"].reel_count == 4
        assert smart["top_plays"].ratio_durations == {"9:16": 52.0}

        # goals & assists = the 2 goal reels (the Goal+Assist reel counted ONCE)
        assert smart["top_goals_assists"].reel_count == 2
        assert smart["top_goals_assists"].ratio_durations == {"9:16": 35.0}

        # dribbles = 1 reel
        assert smart["top_dribbles"].reel_count == 1

    def test_order_is_canonical(self, db):
        self._seed_tagged(db)
        s = _summary()
        assert [sc.key for sc in s.smart_collections] == \
            ["top_plays", "top_goals_assists", "top_dribbles"]

    def test_empty_group_omitted(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0, tags=["Goal"])
        conn.commit(); conn.close()

        s = _summary()
        keys = {sc.key for sc in s.smart_collections}
        assert "top_plays" in keys and "top_goals_assists" in keys
        assert "top_dribbles" not in keys  # no dribble reels

    def test_smart_ratio_eligibility(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=40.0, tags=["Goal"])  # >=30
        _insert_fv(cur, game_ids=[7], ratio="16:9", duration=10.0, tags=["Goal"])  # <30
        conn.commit(); conn.close()

        ga = next(sc for sc in _summary().smart_collections if sc.key == "top_goals_assists")
        assert ga.ratio_eligible == {"9:16": True, "16:9": False}

    def test_tags_member_filter_parity(self, db):
        self._seed_tagged(db)
        s = _summary()
        ga = next(sc for sc in s.smart_collections if sc.key == "top_goals_assists")

        members = _downloads(tags="Goal,Assist")
        assert members.total_count == ga.reel_count == 2  # deduped

        dribble = _downloads(tags="Dribble")
        assert dribble.total_count == 1

        # top_plays member fetch is the unfiltered list
        plays = next(sc for sc in s.smart_collections if sc.key == "top_plays")
        assert _downloads().total_count == plays.reel_count == 4
