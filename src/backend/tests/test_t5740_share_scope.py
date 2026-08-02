"""
T5740: per-recipient clip scope on the game share + admin funnel.

Core properties asserted:
  * resolve_scoped_clips is the SINGLE source of truth for what a recipient gets,
    so the /share-preview read and the /share send path can never diverge.
  * My-Athlete clips (my_athlete != 0) NEVER cross to a recipient on ANY scope.
  * every copied game AND clip carries a NON-NULL shared_by (T5330), both scopes.
  * a MIXED request (A=all-team, B=tagged-only) gives each recipient exactly their
    own set with no cross-contamination.
  * untagged + tagged-only -> game arrives, zero clips, no crash.
  * admin share-funnel aggregates views/claims/activated per link (multi-claim).
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.constants import ShareClipScope
from app.services.materialization import (
    _tag_names_for_email,
    materialize_game_share,
    resolve_scoped_clips,
)
from app.utils.encoding import encode_data
from tests.test_materialization import _create_profile_db, _insert_game
from tests.test_t5730_claim_import_flow import _open, _profile_db_path


def _insert_clip(conn, game_id, start, end, *, name, my_athlete, rating=3,
                 notes=None, tagged_teammates=None, video_sequence=0):
    """Insert a raw_clip AND its clip_teammates rows (which _filter_clips_for_tag
    joins on) so tagged-only scope resolution works. my_athlete is explicit so
    tests can prove the athlete layer never crosses."""
    tt = encode_data(tagged_teammates) if tagged_teammates else None
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO raw_clips
           (filename, rating, name, notes, start_time, end_time, game_id,
            video_sequence, tagged_teammates, my_athlete)
           VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (rating, name, notes, start, end, game_id, video_sequence, tt, my_athlete),
    )
    clip_id = cur.lastrowid
    if tagged_teammates:
        for tag in tagged_teammates:
            cur.execute(
                "INSERT OR IGNORE INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)",
                (clip_id, tag),
            )
    conn.commit()
    return clip_id

TEAMMATE_EMAILS_DDL = """
CREATE TABLE IF NOT EXISTS teammate_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tag_name, email)
);
"""


def _profile_db_with_teammates(path):
    conn = _create_profile_db(path)
    conn.executescript(TEAMMATE_EMAILS_DDL)
    conn.commit()
    return conn


def _map_email(conn, tag_name, email):
    conn.execute(
        "INSERT INTO teammate_emails (tag_name, email) VALUES (?, ?)",
        (tag_name, email),
    )
    conn.commit()


# ===========================================================================
# Unit: resolve_scoped_clips (the shared selector)
# ===========================================================================

class TestResolveScopedClips:
    def _seed(self, tmp_path):
        conn = _profile_db_with_teammates(tmp_path / "s" / "profile.sqlite")
        game_id = _insert_game(conn, blake3_hash="h")
        # Two Team-layer clips, one tagged for #7; one My-Athlete clip.
        _insert_clip(conn, game_id, 0, 5, name="Team goal", my_athlete=0,
                     rating=5, tagged_teammates=["#7"])
        _insert_clip(conn, game_id, 10, 15, name="Big save", my_athlete=0, rating=4)
        _insert_clip(conn, game_id, 20, 25, name="My kid scores", my_athlete=1,
                     rating=5, tagged_teammates=["#7"])
        _map_email(conn, "#7", "seven@example.com")
        return conn, game_id

    def test_all_team_returns_only_team_layer(self, tmp_path):
        conn, game_id = self._seed(tmp_path)
        clips = resolve_scoped_clips(conn, game_id, "anyone@example.com",
                                     ShareClipScope.ALL_TEAM.value)
        assert sorted(c["name"] for c in clips) == ["Big save", "Team goal"]
        conn.close()

    def test_my_athlete_clip_never_crosses_on_any_scope(self, tmp_path):
        conn, game_id = self._seed(tmp_path)
        # #7 is tagged on BOTH a team clip and the my_athlete clip; tagged-only
        # must still exclude the my_athlete one (it filters the Team layer only via
        # clip_teammates, but the my_athlete clip has my_athlete=1). Prove by name.
        for scope in (ShareClipScope.ALL_TEAM.value, ShareClipScope.TAGGED_ONLY.value,
                      ShareClipScope.GAME_ONLY.value):
            names = [c["name"] for c in resolve_scoped_clips(
                conn, game_id, "seven@example.com", scope)]
            assert "My kid scores" not in names, f"athlete clip leaked on scope={scope}"
        conn.close()

    def test_tagged_only_returns_tagged_team_subset(self, tmp_path):
        conn, game_id = self._seed(tmp_path)
        clips = resolve_scoped_clips(conn, game_id, "seven@example.com",
                                     ShareClipScope.TAGGED_ONLY.value)
        # #7 is tagged on "Team goal" (team) and "My kid scores" (athlete). Only the
        # team one is a Team-layer clip; the athlete clip must not appear.
        assert [c["name"] for c in clips] == ["Team goal"]
        conn.close()

    def test_tagged_only_untagged_email_is_empty(self, tmp_path):
        conn, game_id = self._seed(tmp_path)
        clips = resolve_scoped_clips(conn, game_id, "nobody@example.com",
                                     ShareClipScope.TAGGED_ONLY.value)
        assert clips == []
        assert _tag_names_for_email(conn, "nobody@example.com") == []
        conn.close()

    def test_email_match_is_case_insensitive(self, tmp_path):
        conn, game_id = self._seed(tmp_path)
        clips = resolve_scoped_clips(conn, game_id, "SEVEN@Example.com",
                                     ShareClipScope.TAGGED_ONLY.value)
        assert [c["name"] for c in clips] == ["Team goal"]
        conn.close()

    def test_tagged_only_unions_multiple_tags_without_dupes(self, tmp_path):
        conn = _profile_db_with_teammates(tmp_path / "s" / "profile.sqlite")
        game_id = _insert_game(conn, blake3_hash="h")
        # One clip tagged with BOTH #7 and #9; email maps to both tags.
        _insert_clip(conn, game_id, 0, 5, name="Shared moment", my_athlete=0,
                     rating=5, tagged_teammates=["#7", "#9"])
        _insert_clip(conn, game_id, 6, 9, name="Only nine", my_athlete=0,
                     rating=4, tagged_teammates=["#9"])
        _map_email(conn, "#7", "kid@example.com")
        _map_email(conn, "#9", "kid@example.com")
        clips = resolve_scoped_clips(conn, game_id, "kid@example.com",
                                     ShareClipScope.TAGGED_ONLY.value)
        # "Shared moment" appears once (union dedup), plus "Only nine".
        assert sorted(c["name"] for c in clips) == ["Only nine", "Shared moment"]
        assert len({c["id"] for c in clips}) == 2
        conn.close()

    def test_game_only_is_empty(self, tmp_path):
        conn, game_id = self._seed(tmp_path)
        assert resolve_scoped_clips(conn, game_id, "seven@example.com",
                                    ShareClipScope.GAME_ONLY.value) == []
        conn.close()


# ===========================================================================
# Service: materialize with scoped clip_data (shared_by, mixed, preview==sent)
# ===========================================================================

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
SHARER_PROFILE = "sharerprof"


class TestScopedMaterialization:
    @pytest.fixture()
    def env(self, pg_conn, tmp_path):
        import app.services.pg as pgmod
        from app.services.auth_db import create_user
        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user("user-a", email="a@example.com")
        create_user("user-b", email="b@example.com")
        with patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
             patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.materialization.get_pg", pgmod.get_pg), \
             patch("app.services.materialization.get_game_storage_ref",
                   return_value=None), \
             patch("app.services.materialization.insert_game_storage_ref"):
            yield tmp_path

    def _seed_sharer(self, base):
        s_path = _profile_db_path(base, SHARER_ID, SHARER_PROFILE)
        s_conn = _profile_db_with_teammates(s_path)
        game_id = _insert_game(s_conn, name="vs Riverside", blake3_hash="scopehash")
        _insert_clip(s_conn, game_id, 0, 5, name="Team goal", my_athlete=0,
                     rating=5, tagged_teammates=["#7"])
        _insert_clip(s_conn, game_id, 10, 15, name="Big save", my_athlete=0, rating=4)
        _insert_clip(s_conn, game_id, 20, 25, name="My kid scores", my_athlete=1,
                     rating=5)
        _map_email(s_conn, "#7", "a@example.com")  # A is tagged; B is not
        s_conn.close()
        return game_id

    def _materialize(self, base, game_id, recipient_id, recipient_profile, scope,
                     email, share_id):
        # Mirror share_game: resolve on the sharer conn, then materialize with that
        # exact clip_data (so preview==sent by construction).
        s_conn = _open(base, SHARER_ID, SHARER_PROFILE)
        clip_data = resolve_scoped_clips(s_conn, game_id, email, scope)
        s_conn.close()
        materialize_game_share(
            sharer_user_id=SHARER_ID, sharer_profile_id=SHARER_PROFILE,
            recipient_user_id=recipient_id, recipient_profile_id=recipient_profile,
            game_id=game_id, tag_name=None, share_id=share_id,
            clip_data=clip_data, sharer_email=SHARER_EMAIL,
        )
        return clip_data

    def test_all_team_scope_shared_by_non_null_and_no_athlete(self, env):
        game_id = self._seed_sharer(env)
        _create_profile_db(_profile_db_path(env, "user-a", "ap")).close()
        clip_data = self._materialize(env, game_id, "user-a", "ap",
                                      ShareClipScope.ALL_TEAM.value, "a@example.com", 1)

        conn = _open(env, "user-a", "ap")
        game = conn.execute("SELECT * FROM games").fetchone()
        clips = conn.execute("SELECT * FROM raw_clips ORDER BY start_time").fetchall()
        conn.close()
        assert game["shared_by"] == SHARER_EMAIL
        assert {c["name"] for c in clips} == {"Team goal", "Big save"}
        for c in clips:
            assert c["shared_by"] == SHARER_EMAIL, "every clip must carry provenance"
            assert c["my_athlete"] == 0
        assert "My kid scores" not in {c["name"] for c in clips}
        # preview == sent: the resolved clip names equal what landed.
        assert {c["name"] for c in clip_data} == {c["name"] for c in clips}

    def test_tagged_only_scope_shared_by_non_null(self, env):
        game_id = self._seed_sharer(env)
        _create_profile_db(_profile_db_path(env, "user-a", "ap")).close()
        clip_data = self._materialize(env, game_id, "user-a", "ap",
                                      ShareClipScope.TAGGED_ONLY.value, "a@example.com", 2)
        conn = _open(env, "user-a", "ap")
        game = conn.execute("SELECT * FROM games").fetchone()
        clips = conn.execute("SELECT * FROM raw_clips").fetchall()
        conn.close()
        assert game["shared_by"] == SHARER_EMAIL
        assert {c["name"] for c in clips} == {"Team goal"}
        assert clips[0]["shared_by"] == SHARER_EMAIL
        assert {c["name"] for c in clip_data} == {c["name"] for c in clips}

    def test_mixed_recipients_no_cross_contamination(self, env):
        """A=all-team (2 clips), B=tagged-only. B is NOT tagged -> 0 clips. Neither
        recipient sees the other's set."""
        game_id = self._seed_sharer(env)
        _create_profile_db(_profile_db_path(env, "user-a", "ap")).close()
        _create_profile_db(_profile_db_path(env, "user-b", "bp")).close()

        self._materialize(env, game_id, "user-a", "ap",
                          ShareClipScope.ALL_TEAM.value, "a@example.com", 3)
        self._materialize(env, game_id, "user-b", "bp",
                          ShareClipScope.TAGGED_ONLY.value, "b@example.com", 4)

        a = _open(env, "user-a", "ap")
        b = _open(env, "user-b", "bp")
        a_names = {r["name"] for r in a.execute("SELECT name FROM raw_clips").fetchall()}
        b_clips = b.execute("SELECT * FROM raw_clips").fetchall()
        a_game = a.execute("SELECT shared_by FROM games").fetchone()
        b_game = b.execute("SELECT shared_by FROM games").fetchone()
        a.close(); b.close()
        assert a_names == {"Team goal", "Big save"}
        assert len(b_clips) == 0, "untagged tagged-only recipient gets zero clips"
        # game copied for BOTH, shared_by non-null even on the zero-clip game.
        assert a_game["shared_by"] == SHARER_EMAIL
        assert b_game["shared_by"] == SHARER_EMAIL

    def test_different_tagged_sets_per_recipient(self, env):
        """Two teammates with DIFFERENT tagged sets each get exactly their subset."""
        s_path = _profile_db_path(env, SHARER_ID, SHARER_PROFILE)
        s_conn = _profile_db_with_teammates(s_path)
        game_id = _insert_game(s_conn, name="vs X", blake3_hash="scopehash2")
        _insert_clip(s_conn, game_id, 0, 5, name="Seven play", my_athlete=0,
                     rating=5, tagged_teammates=["#7"])
        _insert_clip(s_conn, game_id, 6, 9, name="Nine play", my_athlete=0,
                     rating=4, tagged_teammates=["#9"])
        _map_email(s_conn, "#7", "a@example.com")
        _map_email(s_conn, "#9", "b@example.com")
        s_conn.close()
        _create_profile_db(_profile_db_path(env, "user-a", "ap")).close()
        _create_profile_db(_profile_db_path(env, "user-b", "bp")).close()

        self._materialize(env, game_id, "user-a", "ap",
                          ShareClipScope.TAGGED_ONLY.value, "a@example.com", 5)
        self._materialize(env, game_id, "user-b", "bp",
                          ShareClipScope.TAGGED_ONLY.value, "b@example.com", 6)

        a = _open(env, "user-a", "ap")
        b = _open(env, "user-b", "bp")
        a_names = {r["name"] for r in a.execute("SELECT name FROM raw_clips").fetchall()}
        b_names = {r["name"] for r in b.execute("SELECT name FROM raw_clips").fetchall()}
        a.close(); b.close()
        assert a_names == {"Seven play"}
        assert b_names == {"Nine play"}


# ===========================================================================
# Analytics: per-link view counts from the sharer's logged share_viewed events
# ===========================================================================

_USER_ACTION_LOG_DDL = """
CREATE TABLE user_action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    context TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


class TestShareViewCounts:
    def test_counts_share_viewed_per_token(self, tmp_path):
        import json
        from contextlib import contextmanager

        from app import analytics

        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(_USER_ACTION_LOG_DDL)
        rows = [
            ("share_viewed", {"share_token": "tokX"}),
            ("share_viewed", {"share_token": "tokX"}),   # tokX = 2 views
            ("share_viewed", {"share_token": "tokY"}),   # tokY = 1 view
            ("share_viewed", {"share_token": "other"}),  # not requested
            ("clip_created", {"share_token": "tokX"}),   # not a view
        ]
        for action, ctx in rows:
            conn.execute(
                "INSERT INTO user_action_log (action, context) VALUES (?, ?)",
                (action, json.dumps(ctx)),
            )
        conn.commit()

        @contextmanager
        def fake_conn(_uid):
            try:
                yield conn
            finally:
                pass

        with patch("app.services.user_db.get_user_db_connection", fake_conn):
            counts = analytics.share_view_counts("sharer-user", ["tokX", "tokY"])
        assert counts == {"tokX": 2, "tokY": 1}
        conn.close()

    def test_returns_none_when_db_unavailable(self, tmp_path):
        from contextlib import contextmanager

        from app import analytics

        @contextmanager
        def boom(_uid):
            raise RuntimeError("R2 down")
            yield  # pragma: no cover

        with patch("app.services.user_db.get_user_db_connection", boom):
            assert analytics.share_view_counts("sharer-user", ["tokX"]) is None


# ===========================================================================
# Admin: per-link funnel (views -> claims -> activated), multi-claim fixture
# ===========================================================================

class TestAdminShareFunnel:
    def test_multi_claim_aggregation(self, pg_conn):
        import asyncio

        from app.services.auth_db import create_user
        from app.services.pg import get_pg
        from app.services.sharing_db import (
            create_game_share,
            get_game_share_by_token,
            record_share_claim,
        )
        from app.routers import admin as admin_mod

        create_user("sharer-user", email="funnelsharer@example.com")
        create_user("user-1", email="claimer1@example.com")
        create_user("user-2", email="claimer2@example.com")

        share = create_game_share(
            game_id=99, tag_name=None,
            sharer_user_id="sharer-user", sharer_profile_id="sp",
            recipient_email="funnelsharer@example.com", game_name="Funnel Game",
            game_blake3="funnelhash", share_type="game_link", game_date="2026-03-03",
        )
        share_row = get_game_share_by_token(share["share_token"])
        share_id = share_row["id"]

        # TWO claimers (multi-claim), one of whom activated (export_completed).
        record_share_claim(share_id=share_id, claimer_user_id="user-1",
                           claimer_profile_id="p1", include_annotations=True,
                           local_game_id=1)
        record_share_claim(share_id=share_id, claimer_user_id="user-2",
                           claimer_profile_id="p2", include_annotations=False,
                           local_game_id=2)
        with get_pg() as conn:
            conn.cursor().execute(
                "INSERT INTO user_actions (user_id, action, platform, count) "
                "VALUES ('user-1', 'export_completed', 'web', 3)")

        with patch("app.routers.admin.is_admin", return_value=True), \
             patch("app.routers.admin.get_current_user_id", return_value="admin-user"), \
             patch("app.analytics.share_view_counts",
                   return_value={share["share_token"]: 5}):
            result = asyncio.run(admin_mod.analytics_share_funnel(limit=100))

        assert result["activation_metric"] == "export_completed"
        links = [l for l in result["links"] if l["share_token"] == share["share_token"]]
        assert len(links) == 1
        link = links[0]
        assert link["game_name"] == "Funnel Game"
        assert link["sharer_email"] == "funnelsharer@example.com"
        assert link["views"] == 5
        assert link["claims"] == 2          # both claimers counted
        assert link["activated"] == 1       # only user-1 exported
        assert link["revoked"] is False
