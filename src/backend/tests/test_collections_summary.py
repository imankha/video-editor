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
from app.routers.collections import CURATED_COMBOS

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
               quality_score=5.0, clip_count=1, watched_at=None):
    """Insert one final_video with frozen columns. Each reel gets a distinct
    project_id by default so latest_final_videos_subquery keeps them all.
    clip_count defaults to 1 (T3630: collections are single-clip only); pass
    clip_count=2 to seed a multi-clip (Mixes-only) reel. watched_at defaults to
    NULL (NEW/unwatched); pass a timestamp to seed a watched reel (T4190)."""
    if project_id is None:
        _next_project[0] += 1
        project_id = _next_project[0]
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, duration, "
        "source_type, name, aspect_ratio, tags, game_ids, quality_score, clip_count, published_at, created_at, watched_at) "
        "VALUES (?, 'f.mp4', ?, ?, ?, 'Reel', ?, ?, ?, ?, ?, ?, ?, ?)",
        (project_id, version, duration, source_type, ratio,
         encode_data(tags) if tags else None,
         encode_game_ids(game_ids) if game_ids is not None else None,
         quality_score, clip_count, published_at, created_at, watched_at),
    )
    return cur.lastrowid, project_id


def _insert_raw_clip(cur, *, game_id, auto_project_id):
    """Seed the auto_project chain (raw_clips.auto_project_id -> game_id) used
    as the brilliant-clip grouping fallback in list_downloads (T4190)."""
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, "
        "game_id, name, auto_project_id) VALUES ('c.mp4', 5, 0, 30, ?, 'Clip', ?)",
        (game_id, auto_project_id),
    )
    return cur.lastrowid


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
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=5.0, tags=["Pass"])
        conn.commit(); conn.close()

    def test_groups_present_and_deduped(self, db):
        self._seed_tagged(db)
        s = _summary()  # default sport => soccer
        smart = {sc.key: sc for sc in s.smart_collections}

        # Top Plays = all 4 reels; curated, nudged.
        assert smart["top_plays"].reel_count == 4
        assert smart["top_plays"].ratio_durations == {"9:16": 52.0}
        assert smart["top_plays"].nudge_when_locked is True

        # Curated combo: the 2 goal reels (the Goal+Assist reel counted ONCE).
        assert smart["soccer_goals_assists"].reel_count == 2
        assert smart["soccer_goals_assists"].ratio_durations == {"9:16": 35.0}
        assert smart["soccer_goals_assists"].nudge_when_locked is True

        # Per-tag Goal is ready (35s >= 30s): surfaced, NOT nudged.
        assert smart["tag:Goal"].reel_count == 2
        assert smart["tag:Goal"].name == "Top Goals"
        assert smart["tag:Goal"].nudge_when_locked is False

        # Sub-30s tags stay hidden until ready (no locked nudge for per-tag).
        assert "tag:Dribble" not in smart   # 12s
        assert "tag:Assist" not in smart     # 15s
        assert "tag:Pass" not in smart       # 5s

    def test_order_is_canonical(self, db):
        self._seed_tagged(db)
        s = _summary()
        # Curated first (Top Plays, then combos), then ready per-tag by name.
        assert [sc.key for sc in s.smart_collections] == \
            ["top_plays", "soccer_goals_assists", "tag:Goal"]

    def test_empty_group_omitted(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0, tags=["Goal"])
        conn.commit(); conn.close()

        s = _summary()
        keys = {sc.key for sc in s.smart_collections}
        # Curated combo shows from the first reel (nudge), even sub-30s.
        assert "top_plays" in keys and "soccer_goals_assists" in keys
        # Per-tag Goal hidden: 20s < 30s, not ready yet.
        assert "tag:Goal" not in keys

    def test_per_tag_appears_only_when_ready(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=25.0, tags=["Pass"])
        conn.commit(); conn.close()
        assert "tag:Pass" not in {sc.key for sc in _summary().smart_collections}  # 25s < 30s

        conn = _connect(db)
        cur = conn.cursor()
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=10.0, tags=["Pass"])
        conn.commit(); conn.close()
        smart = {sc.key: sc for sc in _summary().smart_collections}
        assert "tag:Pass" in smart                       # now 35s >= 30s
        assert smart["tag:Pass"].name == "Top Passes"     # pluralized
        assert smart["tag:Pass"].nudge_when_locked is False

    def test_curated_combos_are_sport_specific(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=20.0, tags=["Kill"])
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=15.0, tags=["Ace"])
        conn.commit(); conn.close()

        from app.routers.collections import collections_summary
        s = asyncio.run(collections_summary(sport="volleyball"))
        smart = {sc.key: sc for sc in s.smart_collections}
        # Volleyball combo present (Kill OR Ace), soccer combo absent.
        assert smart["vb_kills_aces"].reel_count == 2
        assert smart["vb_kills_aces"].nudge_when_locked is True
        assert "soccer_goals_assists" not in smart

    def test_smart_ratio_eligibility(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=40.0, tags=["Goal"])  # >=30
        _insert_fv(cur, game_ids=[7], ratio="16:9", duration=10.0, tags=["Goal"])  # <30
        conn.commit(); conn.close()

        ga = next(sc for sc in _summary().smart_collections if sc.key == "soccer_goals_assists")
        assert ga.ratio_eligible == {"9:16": True, "16:9": False}

    def test_tags_member_filter_parity(self, db):
        self._seed_tagged(db)
        s = _summary()
        ga = next(sc for sc in s.smart_collections if sc.key == "soccer_goals_assists")

        members = _downloads(tags="Goal,Assist")
        assert members.total_count == ga.reel_count == 2  # deduped

        dribble = _downloads(tags="Dribble")
        assert dribble.total_count == 1

        # top_plays member fetch is the unfiltered list
        plays = next(sc for sc in s.smart_collections if sc.key == "top_plays")
        assert _downloads().total_count == plays.reel_count == 4


# ---------------------------------------------------------------------------
# Every supported sport: curated combos nudge, per-tag hides until ready
# ---------------------------------------------------------------------------

class TestMultiSportCollections:
    @pytest.mark.parametrize("sport", list(CURATED_COMBOS.keys()))
    def test_each_sport_curated_and_per_tag(self, db, sport):
        """For each sport: seeding a reel with one of the sport's curated combo
        tags surfaces (a) Top Plays, (b) the curated combo as a nudge card, and
        (c) that tag's per-tag collection once it clears 30s."""
        from app.routers.collections import collections_summary

        combo = CURATED_COMBOS[sport][0]
        tag = sorted(combo["tags"])[0]

        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=40.0, tags=[tag])  # >=30s
        conn.commit(); conn.close()

        s = asyncio.run(collections_summary(sport=sport))
        smart = {sc.key: sc for sc in s.smart_collections}

        # Flagship is always present and nudges.
        assert smart["top_plays"].nudge_when_locked is True
        # Curated combo joined the reel (OR membership) and nudges.
        assert smart[combo["key"]].reel_count == 1
        assert smart[combo["key"]].nudge_when_locked is True
        # The seeded tag's per-tag collection is ready (40s) and does NOT nudge.
        assert smart[f"tag:{tag}"].nudge_when_locked is False
        assert smart[f"tag:{tag}"].reel_count == 1

    def test_wrong_sport_combo_omitted_but_per_tag_survives(self, db):
        """Per-tag is sport-agnostic: a volleyball Kill reel viewed with the
        soccer combo set still yields its per-tag card, just no soccer combo."""
        from app.routers.collections import collections_summary

        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], ratio="9:16", duration=40.0, tags=["Kill"])
        conn.commit(); conn.close()

        s = asyncio.run(collections_summary(sport="soccer"))
        smart = {sc.key: sc for sc in s.smart_collections}
        assert "soccer_goals_assists" not in smart   # no Goal/Assist reels
        assert "vb_kills_aces" not in smart           # soccer combo set in use
        assert smart["tag:Kill"].nudge_when_locked is False  # per-tag still works


# ---------------------------------------------------------------------------
# T4190: per-bucket unwatched (NEW) counts so a collapsed group never hides a
# new reel -- the My Reels badge (SUM watched_at IS NULL) always has a visible
# on-screen counterpart.
# ---------------------------------------------------------------------------

class TestUnwatchedCount:
    def test_game_bucket_counts_only_unwatched(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], duration=20.0, watched_at=None)             # NEW
        _insert_fv(cur, game_ids=[7], duration=15.0, watched_at=None)             # NEW
        _insert_fv(cur, game_ids=[7], duration=15.0, watched_at="2026-02-01 00:00:00")  # watched
        conn.commit(); conn.close()

        g = _summary().games[0]
        assert g.reel_count == 3
        assert g.unwatched_count == 2

    def test_fully_watched_game_has_zero(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], duration=20.0, watched_at="2026-02-01 00:00:00")
        conn.commit(); conn.close()

        assert _summary().games[0].unwatched_count == 0

    def test_mixes_bucket_counts_unwatched(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        # multi-game reel -> mixes; unwatched.
        _insert_game(cur, 3); _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[3, 7], duration=40.0, watched_at=None)
        conn.commit(); conn.close()

        assert _summary().mixes.unwatched_count == 1

    def test_badge_parity_across_buckets(self, db):
        """Every unwatched reel lands in exactly one game/mixes bucket, so the
        buckets' unwatched sum equals the /count badge (SUM watched_at IS NULL)."""
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 7)
        _insert_fv(cur, game_ids=[7], duration=20.0, watched_at=None)             # game NEW
        _insert_fv(cur, game_ids=[3, 7], duration=40.0, watched_at=None)          # mixes NEW
        _insert_fv(cur, game_ids=[7], duration=20.0, watched_at="2026-02-01 00:00:00")  # watched
        conn.commit(); conn.close()

        s = _summary()
        bucket_unwatched = sum(g.unwatched_count for g in s.games) + s.mixes.unwatched_count
        assert bucket_unwatched == 2  # matches the two watched_at IS NULL reels


# ---------------------------------------------------------------------------
# T4190: brilliant_clip reels group by their FROZEN game_ids (survives the
# source clip's draft being re-created); the raw_clips auto_project chain is
# only a fallback for pre-v008 reels whose frozen blob is empty.
# ---------------------------------------------------------------------------

class TestBrilliantFrozenGrouping:
    def test_frozen_game_ids_are_primary(self, db):
        """A brilliant reel keeps its game_names from the frozen blob even when
        NO raw_clip points at its project (draft re-created -> chain broken)."""
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 6, opponent="Legends", date="2025-06-06")
        _insert_fv(cur, game_ids=[6], source_type="brilliant_clip",
                   project_id=53, duration=33.0)
        # deliberately no raw_clips row with auto_project_id=53
        conn.commit(); conn.close()

        item = next(d for d in _downloads().downloads if d.project_id == 53)
        assert item.game_ids == [6]
        assert item.game_names == ["Vs Legends Jun 6"]

    def test_auto_project_chain_is_fallback_when_frozen_empty(self, db):
        """A pre-v008 brilliant reel (no frozen game_ids) still resolves its
        game via the raw_clips auto_project chain."""
        conn = _connect(db)
        cur = conn.cursor()
        _insert_game(cur, 6, opponent="Legends", date="2025-06-06")
        _insert_fv(cur, game_ids=None, source_type="brilliant_clip",
                   project_id=46, duration=33.0)
        _insert_raw_clip(cur, game_id=6, auto_project_id=46)
        conn.commit(); conn.close()

        item = next(d for d in _downloads().downloads if d.project_id == 46)
        assert item.game_ids == [6]
        assert item.game_names == ["Vs Legends Jun 6"]
