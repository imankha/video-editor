"""
T17240: an unnamed play reads as its game plus in-match time.

A one-tap play is stored as "Play N" (frontend defaultPlayName), so two plays
from different games both read "Play 1" in the ranking game and on reel tiles.
The display shows "Vs Oceanside 0:14" instead; the stored name never changes,
so renaming keeps working.
"""

import asyncio

from tests import test_reel_ranking as rr
from tests.test_reel_ranking import (
    _conn,
    _downloads,
    _insert_fv,
    _insert_project,
    _insert_raw_clip,
    _insert_working_clip,
)

db = rr.db  # the per-test user DB fixture


def _insert_game(cur, game_id, opponent, game_type="home"):
    cur.execute(
        "INSERT INTO games (id, name, opponent_name, game_type, game_date) "
        "VALUES (?, ?, ?, ?, '2026-10-04')",
        (game_id, f"g{game_id}.mp4", opponent, game_type),
    )


def _name_reel(cur, reel_id, name):
    cur.execute("UPDATE final_videos SET name = ? WHERE id = ?", (name, reel_id))


class TestUnnamedPlayLabel:
    def test_default_name_reads_game_plus_time(self):
        from app.queries import unnamed_play_label
        assert unnamed_play_label("Play 1", "Oceanside", "home", 14.2) == "Vs Oceanside 0:14"
        assert unnamed_play_label("Play 3", "Carlsbad", "away", 754) == "at Carlsbad 12:34"

    def test_custom_name_is_kept(self):
        from app.queries import unnamed_play_label
        assert unnamed_play_label("Bicycle kick", "Oceanside", "home", 14) is None

    def test_no_game_or_time_keeps_the_name(self):
        from app.queries import unnamed_play_label
        assert unnamed_play_label("Play 1", None, "home", 14) is None
        assert unnamed_play_label("Play 1", "Oceanside", "home", None) is None


class TestRankingShowsGamePlusTime:
    def test_two_unnamed_plays_read_apart(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            _insert_game(cur, 1, "Oceanside")
            _insert_game(cur, 2, "Carlsbad", "away")
            a = _insert_fv(cur, game_ids=[1], source_clip_id=1, clip_game_start_time=14.0)
            b = _insert_fv(cur, game_ids=[2], source_clip_id=2, clip_game_start_time=75.0)
            _name_reel(cur, a, "Play 1")
            _name_reel(cur, b, "Play 1")
            c.commit()
        from app.routers.rank import rank_next
        m = asyncio.run(rank_next(aspect_ratio="9:16"))
        names = {m.a.id: m.a.name, m.b.id: m.b.name}
        assert names == {a: "Vs Oceanside 0:14", b: "at Carlsbad 1:15"}


class TestReelTileShowsGamePlusTime:
    def test_download_display_name(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            _insert_game(cur, 1, "Oceanside")
            a = _insert_fv(cur, game_ids=[1], source_clip_id=1, clip_game_start_time=14.0)
            b = _insert_fv(cur, game_ids=[1], source_clip_id=2, clip_game_start_time=30.0)
            _name_reel(cur, a, "Play 1")
            _name_reel(cur, b, "Header goal")
            c.commit()
        by_id = {d.id: d for d in _downloads().downloads}
        assert by_id[a].display_name == "Vs Oceanside 0:14"
        # The stored name stays the rename source.
        assert by_id[a].project_name == "Play 1"
        assert by_id[b].display_name == "Header goal"


class TestDraftTileShowsGamePlusTime:
    def test_project_display_name(self, db):
        with _conn(db) as c:
            cur = c.cursor()
            _insert_game(cur, 1, "Oceanside")
            pid = _insert_project(cur)
            cur.execute("UPDATE projects SET name = 'Play 1' WHERE id = ?", (pid,))
            rc = _insert_raw_clip(cur, rating=5, game_id=1, start_time=14.0, end_time=20.0)
            _insert_working_clip(cur, pid, rc)
            c.commit()
        from app.routers.projects import _read_projects_list
        by_id = {p.id: p for p in _read_projects_list()}
        assert by_id[pid].display_name == "Vs Oceanside 0:14"
        assert by_id[pid].name == "Play 1"
