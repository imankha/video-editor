"""T14990: read-only title resolution for the admin's "where they left off"
row. `_resolve_object_title` is unit-tested against an in-memory profile.sqlite
fixture (same style as test_clip_phases.py's pure-function tests);
`resolve_resume_point_titles`'s profile/db-open plumbing is verified via
monkeypatch (same pattern as test_clip_phases.py's TestUserAggregation) so
this needs no real R2/profile-DB-residency machinery.
"""

import sqlite3

from app.services.resume_points import _resolve_object_title


def _make_profile_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE raw_clips (id INTEGER PRIMARY KEY, game_id INTEGER);
        CREATE TABLE projects (id INTEGER PRIMARY KEY, source_raw_clip_id INTEGER);
        """
    )
    return conn


class TestResolveObjectTitlePure:
    def test_game_path_resolves_game_name(self):
        conn = _make_profile_db()
        conn.execute("INSERT INTO games (id, name) VALUES (123, 'Lucas U12')")
        kind, obj_id, title = _resolve_object_title(conn, "/annotate/g/123?profile=abc")
        assert (kind, obj_id, title) == ("game", 123, "Lucas U12")

    def test_project_path_resolves_containing_game_name(self):
        conn = _make_profile_db()
        conn.execute("INSERT INTO games (id, name) VALUES (1, 'Lucas U12')")
        conn.execute("INSERT INTO raw_clips (id, game_id) VALUES (50, 1)")
        conn.execute("INSERT INTO projects (id, source_raw_clip_id) VALUES (8124, 50)")
        kind, obj_id, title = _resolve_object_title(conn, "/focus/p/8124?profile=abc")
        assert (kind, obj_id, title) == ("play", 8124, "Lucas U12")

    def test_unknown_object_id_resolves_to_none_title(self):
        conn = _make_profile_db()
        kind, obj_id, title = _resolve_object_title(conn, "/annotate/g/999")
        assert (kind, obj_id, title) == ("game", 999, None)

    def test_home_path_has_no_object(self):
        conn = _make_profile_db()
        assert _resolve_object_title(conn, "/home") == (None, None, None)


class TestResolveResumePointTitlesWrapper:
    def test_resolves_profile_name_and_object_title(self, monkeypatch):
        import app.services.resume_points as rp

        db = _make_profile_db()
        db.execute("INSERT INTO games (id, name) VALUES (1, 'Lucas U12')")
        db.execute("INSERT INTO raw_clips (id, game_id) VALUES (50, 1)")
        db.execute("INSERT INTO projects (id, source_raw_clip_id) VALUES (8124, 50)")

        monkeypatch.setattr(
            "app.services.user_db.get_profiles",
            lambda uid: [{"id": "prof-a", "name": "Lucas"}],
        )
        monkeypatch.setattr(
            "app.services.materialization.open_profile_db_readonly",
            lambda uid, pid: db if pid == "prof-a" else None,
        )

        point = {
            "path": "/focus/p/8124?profile=prof-a", "profile_id": "prof-a",
            "screen": "framing", "step": "crop", "t": 37.2, "dialog": None,
            "tab": None, "build": 412, "left_at": "2026-11-03T22:14:09Z",
        }
        enriched = rp.resolve_resume_point_titles("user-x", point)

        assert enriched["profile_name"] == "Lucas"
        assert enriched["object_kind"] == "play"
        assert enriched["object_id"] == 8124
        assert enriched["object_title"] == "Lucas U12"
        # Original fields pass through untouched.
        assert enriched["step"] == "crop"
        assert enriched["build"] == 412

    def test_missing_profile_id_skips_lookup_entirely(self, monkeypatch):
        import app.services.resume_points as rp

        def _must_not_be_called(uid):
            raise AssertionError("get_profiles should not be called with no profile_id")

        monkeypatch.setattr("app.services.user_db.get_profiles", _must_not_be_called)
        point = {"path": "/home", "profile_id": None, "screen": "project-manager"}
        enriched = rp.resolve_resume_point_titles("user-x", point)
        assert enriched["profile_name"] is None
        assert enriched["object_kind"] is None

    def test_profile_not_found_leaves_profile_name_none(self, monkeypatch):
        import app.services.resume_points as rp

        monkeypatch.setattr("app.services.user_db.get_profiles", lambda uid: [])
        monkeypatch.setattr(
            "app.services.materialization.open_profile_db_readonly",
            lambda uid, pid: None,
        )
        point = {"path": "/annotate/g/5?profile=deleted-prof", "profile_id": "deleted-prof"}
        enriched = rp.resolve_resume_point_titles("user-x", point)
        assert enriched["profile_name"] is None
        assert enriched["object_title"] is None
