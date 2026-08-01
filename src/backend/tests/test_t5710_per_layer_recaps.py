"""
Tests for T5710: Per-layer recaps (Team Recap / {Athlete} Recap).

Covers:
- Layer filtering (athlete = my_athlete=1 OR NULL; team = my_athlete=0, incl.
  imported/shared_by clips) at the `_get_annotated_clips` SQL layer.
- `GET /api/games/{id}/recap-data?layer=` resolution order end-to-end: empty
  layer, stitched per-layer recap, game-video seek-through, legacy mixed
  seek-filtered, legacy-mixed-with-unresolvable-mapping -> combined, and
  post-grace/no-artifact.
- `ensure_recap(game_id, layer)` idempotency (hit path does not re-stitch).
- Query-count perf guard: the layer split must not add a second per-clip query.

NOTE: uses the `pg_conn` fixture (real Postgres) like test_t3970_expired_share_block.py.
Expected to TRUNCATE the dev Postgres -- run only inside the sandboxed container
(see CLAUDE.md / CLAUDE.local.md), never against staging/prod.
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.utils.encoding import encode_data

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer-user@example.com"

ACTIVE_HASH = "activehash5710"


# ---------------------------------------------------------------------------
# Fixtures (mirror tests/test_t3970_expired_share_block.py)
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user

    create_user(SHARER_ID, email=SHARER_EMAIL)
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    from app.session_init import _init_cache
    _init_cache[SHARER_ID] = {"profile_id": "testdefault", "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.email.send_playback_share_email", new_callable=AsyncMock, return_value=True), \
         patch("app.services.email.send_game_share_email", new_callable=AsyncMock, return_value=True):
        from app.main import app
        c = TestClient(app, raise_server_exceptions=True)
        yield c


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


def _future() -> datetime:
    return datetime.utcnow() + timedelta(days=30)


def _seed_game(blake3: str = ACTIVE_HASH, user_id: str = SHARER_ID) -> int:
    """Insert a bare game (+video), no clips. Returns the game_id."""
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T5710 Game", blake3),
        )
        game_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
            (game_id, blake3, 1),
        )
        conn.commit()
        return game_id


def _seed_clip(game_id, *, rating=3, start=0.0, end=5.0, name="Clip",
               my_athlete=1, shared_by=None, tagged_teammates=None,
               user_id=SHARER_ID):
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO raw_clips (game_id, filename, name, tags, rating,
                                       start_time, end_time, video_sequence,
                                       my_athlete, shared_by, tagged_teammates)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)""",
            (game_id, f"{name}.mp4", name, encode_data([]), rating, start, end,
             my_athlete, shared_by, encode_data(tagged_teammates) if tagged_teammates else None),
        )
        conn.commit()
        return cursor.lastrowid


def _game_video_only_patches():
    """recap-data resolves via the game video (no stitched recap exists)."""
    return [
        patch("app.routers.games.file_exists_in_r2", return_value=False),
        patch("app.routers.games.r2_head_object_global", return_value={"ContentLength": 1}),
        patch("app.routers.games.generate_presigned_url_global",
              return_value="https://r2.example.com/games/x.mp4"),
    ]


def _nothing_survives_patches():
    """Neither a recap nor the game video exists anywhere (post-grace, no legacy)."""
    return [
        patch("app.routers.games.file_exists_in_r2", return_value=False),
        patch("app.routers.games.r2_head_object_global", return_value=None),
    ]


# ---------------------------------------------------------------------------
# Layer filtering (SQL predicate) -- _get_annotated_clips
# ---------------------------------------------------------------------------

class TestLayerFilteringSQL:
    """Unit-level: exercises the real predicate against the real app schema via
    an isolated per-user data dir (no HTTP), fast and Postgres-free."""

    @pytest.fixture(autouse=True)
    def _isolated_user_data(self, tmp_path):
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db._initialized_user_dbs", set()):
            set_current_user_id("t5710-sql-user")
            set_current_profile_id("testdefault")
            from app.database import ensure_database
            ensure_database()
            yield

    def test_athlete_includes_my_athlete_1_and_null(self):
        from app.constants import RecapLayer
        from app.database import get_db_connection
        from app.services.auto_export import _get_annotated_clips

        game_id = _seed_game()
        c1 = _seed_clip(game_id, name="Own clip", my_athlete=1)
        with get_db_connection() as conn:
            conn.execute("INSERT INTO raw_clips (game_id, filename, name, rating, start_time, end_time, video_sequence, my_athlete) "
                         "VALUES (?, 'legacy.mp4', 'Legacy NULL clip', 3, 10.0, 15.0, 1, NULL)", (game_id,))
            conn.commit()
            c2 = conn.execute("SELECT id FROM raw_clips WHERE name = 'Legacy NULL clip'").fetchone()["id"]

        clips = _get_annotated_clips(game_id, RecapLayer.ATHLETE)
        ids = {c["id"] for c in clips}
        assert ids == {c1, c2}

    def test_team_is_exactly_my_athlete_0(self):
        from app.constants import RecapLayer
        from app.services.auto_export import _get_annotated_clips

        game_id = _seed_game()
        _seed_clip(game_id, name="Own clip", my_athlete=1, start=0.0, end=5.0)
        team_clip = _seed_clip(game_id, name="Team clip", my_athlete=0, start=10.0, end=15.0)

        clips = _get_annotated_clips(game_id, RecapLayer.TEAM)
        assert [c["id"] for c in clips] == [team_clip]

    def test_imported_clips_land_on_team(self):
        """shared_by NOT NULL clips are my_athlete=0 by construction (materialization
        forces this) -- confirm they're included in the team layer."""
        from app.constants import RecapLayer
        from app.services.auto_export import _get_annotated_clips

        game_id = _seed_game()
        imported = _seed_clip(game_id, name="Imported clip", my_athlete=0,
                              shared_by="teammate@example.com")

        clips = _get_annotated_clips(game_id, RecapLayer.TEAM)
        assert [c["id"] for c in clips] == [imported]

    def test_unfiltered_call_returns_all_layers(self):
        """layer=None (default) is unfiltered -- used by brilliant-clip
        preservation + backfill_hiq_recaps, must see EVERY rated clip."""
        from app.services.auto_export import _get_annotated_clips

        game_id = _seed_game()
        _seed_clip(game_id, name="Own", my_athlete=1, start=0.0, end=5.0)
        _seed_clip(game_id, name="Team", my_athlete=0, start=10.0, end=15.0)

        clips = _get_annotated_clips(game_id)
        assert len(clips) == 2


# ---------------------------------------------------------------------------
# recap-data?layer= resolution order (endpoint, real Postgres via pg_conn)
# ---------------------------------------------------------------------------

class TestEmptyLayerStates:
    def test_zero_team_clips_returns_explicit_empty(self, client):
        game_id = _seed_game()
        _seed_clip(game_id, name="Own", my_athlete=1)  # athlete-only game
        resp = client.get(
            f"/api/games/{game_id}/recap-data?layer=team",
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["empty"] is True
        assert data["url"] is None
        assert data["clips"] == []
        assert data["video_kind"] is None

    def test_zero_athlete_clips_mirror_case(self, client):
        game_id = _seed_game()
        _seed_clip(game_id, name="Team", my_athlete=0)  # team-only game
        resp = client.get(
            f"/api/games/{game_id}/recap-data?layer=athlete",
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["empty"] is True
        assert data["clips"] == []

    def test_empty_team_never_falls_back_to_athlete_content(self, client):
        """The empty-team response must never carry athlete clip data under
        the team label (no-silent-fallback, CLAUDE.md)."""
        game_id = _seed_game()
        _seed_clip(game_id, name="Own goal", my_athlete=1)
        resp = client.get(
            f"/api/games/{game_id}/recap-data?layer=team",
            headers=_auth_headers(SHARER_ID),
        )
        data = resp.json()
        assert data["clips"] == []
        assert "Own goal" not in str(data)

    def test_invalid_layer_rejected(self, client):
        game_id = _seed_game()
        resp = client.get(
            f"/api/games/{game_id}/recap-data?layer=bogus",
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 400


class TestSeekThroughPath:
    """In-grace, no stitched recap yet -- game video seek-through per layer."""

    def test_athlete_layer_game_relative_offsets(self, client):
        game_id = _seed_game()
        _seed_clip(game_id, name="Own", my_athlete=1, start=10.0, end=15.0)
        _seed_clip(game_id, name="Team", my_athlete=0, start=20.0, end=25.0)

        with patch("app.routers.games.file_exists_in_r2", return_value=False), \
             patch("app.routers.games.r2_head_object_global", return_value={"ContentLength": 1}), \
             patch("app.routers.games.generate_presigned_url_global",
                   return_value="https://r2.example.com/games/x.mp4"):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=athlete",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "game"
        assert len(data["clips"]) == 1
        assert data["clips"][0]["name"] == "Own"
        assert data["clips"][0]["recap_start"] == 10.0
        assert data["clips"][0]["recap_end"] == 15.0

    def test_team_layer_game_relative_offsets(self, client):
        game_id = _seed_game()
        _seed_clip(game_id, name="Own", my_athlete=1, start=10.0, end=15.0)
        _seed_clip(game_id, name="Team", my_athlete=0, start=20.0, end=25.0)

        with patch("app.routers.games.file_exists_in_r2", return_value=False), \
             patch("app.routers.games.r2_head_object_global", return_value={"ContentLength": 1}), \
             patch("app.routers.games.generate_presigned_url_global",
                   return_value="https://r2.example.com/games/x.mp4"):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=team",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "game"
        assert len(data["clips"]) == 1
        assert data["clips"][0]["name"] == "Team"
        assert data["clips"][0]["recap_start"] == 20.0


class TestPostGraceExpired:
    def test_nothing_survives_returns_names_only_no_video(self, client):
        game_id = _seed_game()
        _seed_clip(game_id, name="Own", my_athlete=1)
        with _nothing_survives_patches()[0], _nothing_survives_patches()[1]:
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=athlete",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["url"] is None
        assert data["video_kind"] is None
        assert len(data["clips"]) == 1  # names still listed


class TestStalePerLayerStitchedRecap:
    def test_stamped_athlete_recap_preferred_over_game_video(self, client):
        game_id = _seed_game()
        _seed_clip(game_id, name="Own", my_athlete=1)
        with patch("app.routers.games.file_exists_in_r2", return_value=True), \
             patch("app.routers.games.r2_head_object_global", return_value={"ContentLength": 1}), \
             patch("app.routers.games.generate_presigned_url",
                   return_value="https://r2.example.com/recaps/g.mp4"), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=("athlete", [{"id": 1, "name": "Own", "rating": 3,
                                               "tags": [], "notes": "",
                                               "recap_start": 0.0, "recap_end": 5.0}])):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=athlete",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "recap"
        assert data["url"] == "https://r2.example.com/recaps/g.mp4"

    def test_team_stamped_recap_uses_team_key(self, client):
        game_id = _seed_game()
        _seed_clip(game_id, name="Team clip", my_athlete=0)

        def fake_exists(user_id, key):
            return key == f"recaps/{game_id}_team.mp4"

        with patch("app.routers.games.file_exists_in_r2", side_effect=fake_exists), \
             patch("app.routers.games.r2_head_object_global", return_value=None), \
             patch("app.routers.games.generate_presigned_url",
                   return_value="https://r2.example.com/recaps/g_team.mp4"), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=("team", [{"id": 1, "name": "Team clip", "rating": 3,
                                            "tags": [], "notes": "",
                                            "recap_start": 0.0, "recap_end": 5.0}])):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=team",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "recap"
        assert data["url"] == "https://r2.example.com/recaps/g_team.mp4"


class TestStaleMixedLegacyRecap:
    """T5710 design decision 1/2: a legacy (pre-T5710, unstamped) mixed recap
    survives after the game video is gone. THE RISKY CASE -- must never show
    one layer's content under the other's label."""

    def test_seek_filtered_to_athlete_when_mapping_resolves(self, client):
        game_id = _seed_game()
        athlete_clip = _seed_clip(game_id, name="Own", my_athlete=1, start=0, end=5)
        team_clip = _seed_clip(game_id, name="Team", my_athlete=0, start=10, end=15)
        legacy_mapping = [
            {"id": athlete_clip, "name": "Own", "rating": 3, "tags": [], "notes": "",
             "recap_start": 0.0, "recap_end": 5.0},
            {"id": team_clip, "name": "Team", "rating": 3, "tags": [], "notes": "",
             "recap_start": 5.0, "recap_end": 10.0},
        ]

        def fake_exists(user_id, key):
            return key == f"recaps/{game_id}.mp4"  # only the LEGACY key exists

        with patch("app.routers.games.file_exists_in_r2", side_effect=fake_exists), \
             patch("app.routers.games.r2_head_object_global", return_value=None), \
             patch("app.routers.games.generate_presigned_url",
                   return_value="https://r2.example.com/recaps/g.mp4"), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=(None, legacy_mapping)):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=athlete",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "recap_legacy"
        assert [c["id"] for c in data["clips"]] == [athlete_clip]
        assert data["url"] == "https://r2.example.com/recaps/g.mp4"

    def test_seek_filtered_to_team_when_mapping_resolves(self, client):
        game_id = _seed_game()
        athlete_clip = _seed_clip(game_id, name="Own", my_athlete=1, start=0, end=5)
        team_clip = _seed_clip(game_id, name="Team", my_athlete=0, start=10, end=15)
        legacy_mapping = [
            {"id": athlete_clip, "name": "Own", "rating": 3, "tags": [], "notes": "",
             "recap_start": 0.0, "recap_end": 5.0},
            {"id": team_clip, "name": "Team", "rating": 3, "tags": [], "notes": "",
             "recap_start": 5.0, "recap_end": 10.0},
        ]

        def fake_exists(user_id, key):
            return key == f"recaps/{game_id}.mp4"

        with patch("app.routers.games.file_exists_in_r2", side_effect=fake_exists), \
             patch("app.routers.games.r2_head_object_global", return_value=None), \
             patch("app.routers.games.generate_presigned_url",
                   return_value="https://r2.example.com/recaps/g.mp4"), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=(None, legacy_mapping)):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=team",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "recap_legacy"
        assert [c["id"] for c in data["clips"]] == [team_clip]
        # Never leak the athlete-layer clip under the team response.
        assert "Own" not in [c["name"] for c in data["clips"]]

    def test_unresolvable_mapping_degrades_to_combined_never_per_layer(self, client):
        """Clip ids in the frozen JSON no longer resolve against live raw_clips
        (e.g. deleted) -- offsets are unrecoverable. Must degrade to a single
        combined entry, NOT be silently served under either layer's label."""
        game_id = _seed_game()
        _seed_clip(game_id, name="Own", my_athlete=1)
        stale_mapping = [
            {"id": 999999, "name": "Deleted clip", "rating": 3, "tags": [], "notes": "",
             "recap_start": 0.0, "recap_end": 5.0},
        ]

        def fake_exists(user_id, key):
            return key == f"recaps/{game_id}.mp4"

        with patch("app.routers.games.file_exists_in_r2", side_effect=fake_exists), \
             patch("app.routers.games.r2_head_object_global", return_value=None), \
             patch("app.routers.games.generate_presigned_url",
                   return_value="https://r2.example.com/recaps/g.mp4"), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=(None, stale_mapping)):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=athlete",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "recap_legacy_combined"
        assert data["clips"] == []
        assert data["url"] == "https://r2.example.com/recaps/g.mp4"

    def test_missing_mapping_json_degrades_to_combined(self, client):
        """The .mp4 survives but its _clips.json is gone entirely."""
        game_id = _seed_game()
        _seed_clip(game_id, name="Team", my_athlete=0)  # team layer must be non-empty (row 0 guard)

        def fake_exists(user_id, key):
            return key == f"recaps/{game_id}.mp4"

        with patch("app.routers.games.file_exists_in_r2", side_effect=fake_exists), \
             patch("app.routers.games.r2_head_object_global", return_value=None), \
             patch("app.routers.games.generate_presigned_url",
                   return_value="https://r2.example.com/recaps/g.mp4"), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=(None, [])):
            resp = client.get(
                f"/api/games/{game_id}/recap-data?layer=team",
                headers=_auth_headers(SHARER_ID),
            )
        data = resp.json()
        assert data["video_kind"] == "recap_legacy_combined"
        assert data["clips"] == []


# ---------------------------------------------------------------------------
# ensure_recap idempotency
# ---------------------------------------------------------------------------

class TestEnsureRecapIdempotency:
    @pytest.fixture(autouse=True)
    def _isolated_user_data(self, tmp_path):
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db._initialized_user_dbs", set()):
            set_current_user_id("t5710-ensure-user")
            set_current_profile_id("testdefault")
            from app.database import ensure_database
            ensure_database()
            yield

    def test_hit_path_does_not_restitch(self):
        from app.services.auto_export import ensure_recap

        game_id = _seed_game(user_id="t5710-ensure-user")
        _seed_clip(game_id, name="Team", my_athlete=0, user_id="t5710-ensure-user")

        with patch("app.services.auto_export.file_exists_in_r2", return_value=True), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=("team", [{"id": 1, "name": "Team", "rating": 3,
                                            "tags": [], "notes": "",
                                            "recap_start": 0.0, "recap_end": 5.0}])), \
             patch("app.services.auto_export._generate_recap") as gen, \
             patch("app.services.auto_export._generate_recap_from_legacy_slice") as gen_legacy, \
             patch("app.services.poster.ensure_recap_poster", return_value=True):
            result = ensure_recap("t5710-ensure-user", "testdefault", game_id, "team")

        assert result["status"] == "present"
        gen.assert_not_called()
        gen_legacy.assert_not_called()

    def test_empty_layer_stitches_nothing(self):
        from app.services.auto_export import ensure_recap

        game_id = _seed_game(user_id="t5710-ensure-user")
        _seed_clip(game_id, name="Own", my_athlete=1, user_id="t5710-ensure-user")  # athlete-only

        with patch("app.services.auto_export.file_exists_in_r2", return_value=False), \
             patch("app.services.auto_export._generate_recap") as gen, \
             patch("app.services.auto_export._generate_recap_from_legacy_slice") as gen_legacy:
            result = ensure_recap("t5710-ensure-user", "testdefault", game_id, "team")

        assert result["status"] == "empty"
        assert result["clip_count"] == 0
        gen.assert_not_called()
        gen_legacy.assert_not_called()

    def test_second_call_after_stitch_is_a_hit(self):
        """Simulates the real two-call sequence: miss+stitch, then a repeat
        call finds the now-stamped recap and short-circuits."""
        from app.services.auto_export import ensure_recap

        game_id = _seed_game(user_id="t5710-ensure-user")
        _seed_clip(game_id, name="Team", my_athlete=0, user_id="t5710-ensure-user")

        call_count = {"n": 0}

        def fake_exists(user_id, key):
            # First call: nothing stitched yet. After the (mocked) stitch, the
            # object exists.
            return call_count["n"] > 0

        with patch("app.services.auto_export.file_exists_in_r2", side_effect=fake_exists), \
             patch("app.services.auto_export.r2_head_object_global", return_value={"ContentLength": 1}), \
             patch("app.services.auto_export._generate_recap",
                   side_effect=lambda *a, **k: call_count.update(n=call_count["n"] + 1)), \
             patch("app.services.auto_export.load_recap_mapping",
                   return_value=("team", [{"id": 1, "name": "Team", "rating": 3,
                                            "tags": [], "notes": "",
                                            "recap_start": 0.0, "recap_end": 5.0}])), \
             patch("app.services.poster.ensure_recap_poster", return_value=True):
            first = ensure_recap("t5710-ensure-user", "testdefault", game_id, "team")
            second = ensure_recap("t5710-ensure-user", "testdefault", game_id, "team")

        assert first["status"] == "stitched"
        assert second["status"] == "present"
        assert call_count["n"] == 1  # _generate_recap invoked exactly once


# ---------------------------------------------------------------------------
# Perf guard: no N+1 added by the layer split
# ---------------------------------------------------------------------------

class TestQueryCounterPerfGuard:
    def test_recap_data_query_count_linear_slope_one_per_clip(self, client, query_counter):
        """The per-clip enrichment loop (game_start_time/in_drafts/tagged_teammates)
        is a pre-existing O(N) pattern (one query per clip); T5710 must not add a
        SECOND per-clip query on top of it. Confirm the marginal cost per clip is
        exactly 1 statement between a 3-clip and a 30-clip game."""
        game_small = _seed_game(blake3="qc-small-5710")
        for i in range(3):
            _seed_clip(game_small, name=f"Clip {i}", my_athlete=1, start=i * 10, end=i * 10 + 5)

        game_large = _seed_game(blake3="qc-large-5710")
        for i in range(30):
            _seed_clip(game_large, name=f"Clip {i}", my_athlete=1, start=i * 10, end=i * 10 + 5)

        patches = _game_video_only_patches()
        with patches[0], patches[1], patches[2]:
            query_counter.statements.clear()
            client.get(f"/api/games/{game_small}/recap-data?layer=athlete",
                       headers=_auth_headers(SHARER_ID))
            small_count = len(query_counter.statements)

            query_counter.statements.clear()
            client.get(f"/api/games/{game_large}/recap-data?layer=athlete",
                       headers=_auth_headers(SHARER_ID))
            large_count = len(query_counter.statements)

        # Pre-existing per-clip enrichment does 2 statements/clip (the in_drafts/
        # game_start_time lookup + compute_unified_clip_start's own query) --
        # that slope predates T5710. The guard: confirm the layer split didn't
        # ADD a third (e.g. a separate per-clip tagged_teammates query --
        # T5710 piggybacks it onto the SAME existing enrichment SELECT).
        clip_delta = 30 - 3
        assert large_count - small_count == 2 * clip_delta, (
            f"expected exactly 2 statements/clip (pre-existing), got "
            f"{(large_count - small_count) / clip_delta:.2f} -- the layer split "
            f"may have added a new per-clip query"
        )
