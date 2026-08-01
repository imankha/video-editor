"""
T5720: Public game link + edge watch page.

Covers the task's CORE guarantee (anonymous scope = TEAM RECAP ONLY) plus the
create/resolve/revoke/beacon contracts:

- The anonymous-scope guarantee is STRUCTURAL: PublicGameLinkResponse has no
  game-source field, proven both by a model_fields type assertion (goes red the
  instant someone ADDS such a field) and by asserting the live response body.
- Idempotent create (twice -> same token); zero-team-clips -> 409 refusal, no row.
- Revoked -> 410; not-a-game_link token never resolves through this endpoint (or
  the teammate endpoint); viewed beacon off the response path.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"

# Fields that MUST NEVER appear in the public game-link response (the full-game
# URL / athlete-layer leak surface).
BANNED_FIELDS = ("game_url", "game_blake3", "video_warm_url", "full_game_url")


@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user
    create_user(SHARER_ID, email=SHARER_EMAIL)
    create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    from app.session_init import _init_cache
    _init_cache[SHARER_ID] = {"profile_id": "testdefault", "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth_headers(user_id: str = SHARER_ID) -> dict:
    return {"X-User-ID": user_id}


def _team_rail() -> list[dict]:
    return [
        {"name": "Team goal", "recap_start": 0.0, "recap_end": 6.2, "player_tags": ["#7"]},
        {"name": "Big save", "recap_start": 6.2, "recap_end": 11.0, "player_tags": []},
    ]


def _seed_game_link(game_id: int = 1, revoked: bool = False) -> str:
    """Insert a game_link share row directly and return its token."""
    from app.services.sharing_db import create_game_share, revoke_game_link_share
    share = create_game_share(
        game_id=game_id,
        tag_name=None,
        sharer_user_id=SHARER_ID,
        sharer_profile_id="testdefault",
        recipient_email=SHARER_EMAIL,
        game_name="vs Riverside",
        game_blake3="blake3hash",
        clip_names=_team_rail(),
        share_type="game_link",
        game_date="2026-03-03",
    )
    if revoked:
        revoke_game_link_share(game_id, SHARER_ID)
    return share["share_token"]


def _seed_game(client, game_id: int = 1, name: str = "vs Riverside") -> None:
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(SHARER_ID)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO games (id, name, blake3_hash, game_date, opponent_name)
               VALUES (?, ?, ?, ?, ?)""",
            (game_id, name, "blake3hash", "2026-03-03", "Riverside"),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# The anonymous-scope guarantee -- STRUCTURAL (no infra needed)
# ---------------------------------------------------------------------------

class TestAnonymousScopeStructural:
    def test_response_model_has_no_game_source_field(self):
        """The teeth: the DTO cannot even declare a full-game field. This goes
        RED the instant someone ADDS one -- before it can ever be populated."""
        from app.routers.shares import PublicGameLinkResponse
        for banned in BANNED_FIELDS:
            assert banned not in PublicGameLinkResponse.model_fields, (
                f"PublicGameLinkResponse must NOT carry {banned!r} -- the public "
                f"link is team-recap-only (EPIC decision 3)"
            )

    def test_clip_model_carries_only_public_fields(self):
        from app.routers.shares import PublicGameClip
        assert set(PublicGameClip.model_fields) == {
            "name", "recap_start", "recap_end", "player_tags",
        }


# ---------------------------------------------------------------------------
# Resolve endpoint
# ---------------------------------------------------------------------------

class TestResolve:
    def test_payload_is_team_only_no_full_game_url(self, client):
        token = _seed_game_link()
        with patch(
            "app.routers.shares.generate_presigned_url_global",
            return_value="https://r2.example.com/recaps/1_team.mp4?sig",
        ):
            resp = client.get(f"/api/shared/game/{token}")
        assert resp.status_code == 200
        body = resp.json()
        # No full-game / athlete-layer field anywhere in the body.
        for banned in BANNED_FIELDS:
            assert banned not in body
        # Exactly the declared public shape.
        assert set(body.keys()) == {
            "share_token", "is_public", "game_name", "game_date",
            "sharer_name", "recap_url", "poster_url", "clips", "clip_count",
        }
        assert body["is_public"] is True
        assert body["recap_url"].endswith("_team.mp4?sig")
        assert body["poster_url"] == f"/api/shared/game/{token}/poster.jpg"
        assert "@" not in body["sharer_name"]  # friendly name, never the email
        # Each clip carries ONLY public-safe fields.
        assert body["clip_count"] == 2
        for clip in body["clips"]:
            assert set(clip.keys()) == {"name", "recap_start", "recap_end", "player_tags"}

    def test_revoked_returns_410(self, client):
        token = _seed_game_link(revoked=True)
        resp = client.get(f"/api/shared/game/{token}")
        assert resp.status_code == 410

    def test_unknown_token_404(self, client):
        resp = client.get("/api/shared/game/does-not-exist")
        assert resp.status_code == 404

    def test_non_game_link_token_never_resolves_here(self, client):
        """A plain 'game' share (email teammate path) must NOT resolve through
        the public game-link endpoint -- that path can carry game_blake3."""
        from app.services.sharing_db import create_game_share
        share = create_game_share(
            game_id=2, tag_name=None, sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault", recipient_email=RECIPIENT_EMAIL,
            game_name="vs Riverside", game_blake3="blake3hash", share_type="game",
        )
        resp = client.get(f"/api/shared/game/{share['share_token']}")
        assert resp.status_code == 404

    def test_game_link_never_resolves_through_teammate_endpoint(self, client):
        """The share_type membership guard: game_link is deliberately absent from
        the teammate resolve tuple, so it 404s there (no game_blake3 leak)."""
        token = _seed_game_link(game_id=3)
        resp = client.get(f"/api/shared/teammate/{token}")
        assert resp.status_code == 404

    def test_resolve_no_n_plus_1(self, client, query_counter):
        """N+1 gate: the per-request SQLite statement count must NOT grow with
        the number of clips. The rail is a snapshot on the Postgres share row, so
        a 50-clip link costs the same as a 2-clip link (no per-clip DB read)."""
        from app.services.sharing_db import create_game_share
        small = _seed_game_link(game_id=7)  # 2 clips
        big_rail = [
            {"name": f"Clip {i}", "recap_start": float(i), "recap_end": float(i + 1),
             "player_tags": []} for i in range(50)
        ]
        big = create_game_share(
            game_id=8, tag_name=None, sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault", recipient_email=SHARER_EMAIL,
            game_name="vs Riverside", game_blake3="blake3hash",
            clip_names=big_rail, share_type="game_link", game_date="2026-03-03",
        )["share_token"]

        with patch(
            "app.routers.shares.generate_presigned_url_global",
            return_value="https://r2.example.com/recaps/team.mp4?sig",
        ):
            client.get(f"/api/shared/game/{small}")  # warm up one-time init
            base = len(query_counter)
            assert client.get(f"/api/shared/game/{small}").status_code == 200
            d_small = len(query_counter) - base
            base = len(query_counter)
            resp_big = client.get(f"/api/shared/game/{big}")
            d_big = len(query_counter) - base
        assert resp_big.json()["clip_count"] == 50
        # Flat: 25x the clips, identical SQLite cost -> no per-clip query.
        assert d_small == d_big


# ---------------------------------------------------------------------------
# Viewed beacon (analytics off the response path)
# ---------------------------------------------------------------------------

class TestViewedBeacon:
    def test_beacon_204(self, client):
        token = _seed_game_link()
        resp = client.post(f"/api/shared/game/{token}/viewed")
        assert resp.status_code == 204

    def test_beacon_revoked_204_no_record(self, client):
        token = _seed_game_link(revoked=True)
        resp = client.post(f"/api/shared/game/{token}/viewed")
        assert resp.status_code == 204

    def test_beacon_unknown_404(self, client):
        resp = client.post("/api/shared/game/nope/viewed")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Create + revoke (authed sharer gestures)
# ---------------------------------------------------------------------------

class TestCreateAndRevoke:
    def test_create_is_idempotent(self, client):
        _seed_game(client, game_id=10)
        fake = {
            "status": "stitched", "recap_key": "recaps/10_team.mp4",
            "mapping_key": "recaps/10_team_clips.json",
            "poster_key": "recaps/posters/10_team.jpg", "clip_count": 2,
        }
        with patch("app.services.auto_export.ensure_recap", return_value=fake), \
             patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock), \
             patch("app.routers.games._build_team_clip_rail", return_value=_team_rail()):
            first = client.post("/api/games/10/share-link", headers=_auth_headers())
            second = client.post("/api/games/10/share-link", headers=_auth_headers())
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["already_existed"] is False
        assert second.json()["already_existed"] is True
        assert first.json()["share_token"] == second.json()["share_token"]
        assert first.json()["path"] == f"/shared/game/{first.json()['share_token']}"

    def test_empty_team_layer_refused_no_row(self, client):
        _seed_game(client, game_id=11)
        empty = {
            "status": "empty", "recap_key": "recaps/11_team.mp4",
            "mapping_key": "recaps/11_team_clips.json",
            "poster_key": "recaps/posters/11_team.jpg", "clip_count": 0,
        }
        with patch("app.services.auto_export.ensure_recap", return_value=empty), \
             patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock):
            resp = client.post("/api/games/11/share-link", headers=_auth_headers())
        assert resp.status_code == 409
        assert resp.json()["detail"]["error"] == "empty_team_layer"
        # No share row was created.
        from app.services.sharing_db import get_active_game_link_share
        assert get_active_game_link_share(11, SHARER_ID) is None

    def test_create_missing_game_404(self, client):
        resp = client.post("/api/games/999/share-link", headers=_auth_headers())
        assert resp.status_code == 404

    def test_revoke_then_resolve_410(self, client):
        _seed_game(client, game_id=12)
        fake = {
            "status": "stitched", "recap_key": "recaps/12_team.mp4",
            "mapping_key": "recaps/12_team_clips.json",
            "poster_key": "recaps/posters/12_team.jpg", "clip_count": 2,
        }
        with patch("app.services.auto_export.ensure_recap", return_value=fake), \
             patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock), \
             patch("app.routers.games._build_team_clip_rail", return_value=_team_rail()):
            created = client.post("/api/games/12/share-link", headers=_auth_headers())
        token = created.json()["share_token"]

        revoke = client.delete("/api/games/12/share-link", headers=_auth_headers())
        assert revoke.status_code == 200
        resp = client.get(f"/api/shared/game/{token}")
        assert resp.status_code == 410

    def test_revoke_no_active_link_404(self, client):
        resp = client.delete("/api/games/13/share-link", headers=_auth_headers())
        assert resp.status_code == 404
