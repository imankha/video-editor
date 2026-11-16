"""
T4640: one share flow for games.

POST /api/games/{id}/share (share_game, ShareGameModal) and
POST /api/games/{id}/share-playback (share_playback, SharePlaybackDialog) used to
be two ~240-line copies of the same steps. The characterization cases below run
the SAME delivery scenarios through BOTH endpoints and were written (and passed)
against the pre-merge code; the structural test pins that both endpoints now
call one shared flow and that the pending-share fallback exists once.
"""

import ast
import inspect
import json
import textwrap
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"
UNKNOWN_EMAIL = "stranger@example.com"


# One entry per endpoint: how to post it, which email function it sends with,
# its log prefix, and the channel fields it writes (tag_name, clip count).
ENDPOINTS = {
    "share_game": {
        "post": lambda c, gid, emails: c.post(
            f"/api/games/{gid}/share",
            json={"recipients": [{"email": e, "scope": "all_team"} for e in emails]},
            headers={"X-User-ID": SHARER_ID},
        ),
        "email_fn": "send_game_share_email",
        "log": "[share-game]",
        "tag_name": None,
    },
    "share_playback": {
        "post": lambda c, gid, emails: c.post(
            f"/api/games/{gid}/share-playback",
            json={"emails": emails},
            headers={"X-User-ID": SHARER_ID},
        ),
        "email_fn": "send_playback_share_email",
        "log": "[share-playback]",
        "tag_name": "",
    },
}


@pytest.fixture(params=sorted(ENDPOINTS))
def endpoint(request):
    return ENDPOINTS[request.param]


@pytest.fixture()
def client(pg_conn, tmp_path):
    from app.services.auth_db import create_user
    from app.session_init import _init_cache

    create_user(SHARER_ID, email=SHARER_EMAIL)
    create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)
    _init_cache[SHARER_ID] = {"profile_id": "testdefault", "is_new_user": False}
    _init_cache[RECIPIENT_ID] = {"profile_id": "testdefault", "is_new_user": False}
    game_mock = AsyncMock(return_value=True)
    playback_mock = AsyncMock(return_value=True)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.email.send_game_share_email", game_mock), \
         patch("app.services.email.send_playback_share_email", playback_mock):
        from app.main import app
        c = TestClient(app, raise_server_exceptions=True)
        c.email_mocks = {
            "send_game_share_email": game_mock,
            "send_playback_share_email": playback_mock,
        }
        yield c


def _seed_game_with_clips() -> int:
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(SHARER_ID)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO games (name, blake3_hash) VALUES (?, ?)", ("Test Game", "t4640hash"))
        game_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
            (game_id, "t4640hash", 1),
        )
        for i in range(3):
            cursor.execute(
                """INSERT INTO raw_clips (game_id, filename, name, tags, rating, start_time, end_time,
                                          video_sequence, my_athlete)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                (game_id, f"clip_{i}.mp4", f"Clip {i}", json.dumps([]), 3, i * 10.0, i * 10.0 + 5.0, 1),
            )
        conn.commit()
        return game_id


def _pending(email):
    from app.services.sharing_db import get_pending_shares_for_email
    return get_pending_shares_for_email(email)


def _clip_count(pending_row) -> int:
    from app.utils.encoding import decode_data
    return len(decode_data(bytes(pending_row["clip_data"])))


class TestBothEndpointsShareTheSameCases:
    def test_non_user_gets_a_pending_share_with_every_clip(self, client, endpoint):
        game_id = _seed_game_with_clips()
        resp = endpoint["post"](client, game_id, [UNKNOWN_EMAIL])
        assert resp.status_code == 200
        assert resp.json() == {"results": [{"email": UNKNOWN_EMAIL, "sent": True}], "all_sent": True}
        client.email_mocks[endpoint["email_fn"]].assert_awaited_once()
        pending = _pending(UNKNOWN_EMAIL)
        assert len(pending) == 1
        assert pending[0]["game_id"] == game_id
        assert pending[0]["tag_name"] == endpoint["tag_name"]
        assert _clip_count(pending[0]) == 3

    def test_single_profile_recipient_is_materialized(self, client, endpoint):
        game_id = _seed_game_with_clips()
        mat = MagicMock(return_value={"game_id": game_id})
        with patch("app.services.user_db.get_profiles", return_value=[{"id": "p1"}]), \
             patch("app.services.materialization.materialize_game_share", mat):
            resp = endpoint["post"](client, game_id, [RECIPIENT_EMAIL])
        assert resp.status_code == 200
        mat.assert_called_once()
        kw = mat.call_args.kwargs
        assert kw["sharer_user_id"] == SHARER_ID
        assert kw["sharer_profile_id"] == "testdefault"
        assert kw["recipient_user_id"] == RECIPIENT_ID
        assert kw["recipient_profile_id"] == "p1"
        assert kw["game_id"] == game_id
        assert kw["tag_name"] == endpoint["tag_name"]
        assert kw["sharer_email"] == SHARER_EMAIL
        assert len(kw["clip_data"]) == 3
        assert _pending(RECIPIENT_EMAIL) == []

    def test_multi_profile_recipient_gets_a_pending_share(self, client, endpoint, caplog):
        game_id = _seed_game_with_clips()
        mat = MagicMock()
        with patch("app.services.user_db.get_profiles", return_value=[{"id": "p1"}, {"id": "p2"}]), \
             patch("app.services.materialization.materialize_game_share", mat), \
             caplog.at_level("INFO"):
            resp = endpoint["post"](client, game_id, [RECIPIENT_EMAIL])
        assert resp.status_code == 200
        mat.assert_not_called()
        pending = _pending(RECIPIENT_EMAIL)
        assert len(pending) == 1 and _clip_count(pending[0]) == 3
        assert any(f"{endpoint['log']} Created pending share for multi-profile user" in r.message
                   for r in caplog.records)

    @pytest.mark.parametrize("failure", ["refresh_failed", "below_head", "migration_blocked"])
    def test_a_refused_materialization_falls_back_to_a_pending_share(
        self, client, endpoint, caplog, failure,
    ):
        from app.migrations import MigrationBlocked
        from app.services.db_refresh import RefreshFailed
        from app.services.materialization import RecipientProfileBelowHead

        exc = {
            "refresh_failed": RefreshFailed("R2 blip"),
            "below_head": RecipientProfileBelowHead("v026 missing"),
            "migration_blocked": MigrationBlocked(RECIPIENT_ID, "p1", "wal busy"),
        }[failure]
        game_id = _seed_game_with_clips()
        with patch("app.services.user_db.get_profiles", return_value=[{"id": "p1"}]), \
             patch("app.services.materialization.materialize_game_share", side_effect=exc), \
             caplog.at_level("WARNING"):
            resp = endpoint["post"](client, game_id, [RECIPIENT_EMAIL])
        assert resp.status_code == 200
        pending = _pending(RECIPIENT_EMAIL)
        assert len(pending) == 1
        assert pending[0]["tag_name"] == endpoint["tag_name"]
        assert _clip_count(pending[0]) == 3
        messages = [r.message for r in caplog.records]
        assert any(f"{endpoint['log']} Materialization refused" in m for m in messages)
        assert not any("Materialization failed" in m for m in messages)

    def test_an_unexpected_materialization_error_is_logged_not_pended(self, client, endpoint, caplog):
        game_id = _seed_game_with_clips()
        with patch("app.services.user_db.get_profiles", return_value=[{"id": "p1"}]), \
             patch("app.services.materialization.materialize_game_share", side_effect=ValueError("boom")), \
             caplog.at_level("ERROR"):
            resp = endpoint["post"](client, game_id, [RECIPIENT_EMAIL])
        assert resp.status_code == 200
        assert resp.json()["all_sent"] is True
        assert _pending(RECIPIENT_EMAIL) == []
        assert any(f"{endpoint['log']} Materialization failed for {RECIPIENT_EMAIL}" in r.message
                   for r in caplog.records)

    def test_a_failed_email_revokes_the_share_and_skips_delivery(self, client, endpoint):
        from app.services.sharing_db import list_shares_for_game

        game_id = _seed_game_with_clips()
        client.email_mocks[endpoint["email_fn"]].return_value = False
        resp = endpoint["post"](client, game_id, [UNKNOWN_EMAIL])
        assert resp.status_code == 200
        assert resp.json() == {"results": [{"email": UNKNOWN_EMAIL, "sent": False}], "all_sent": False}
        assert _pending(UNKNOWN_EMAIL) == []
        shares = list_shares_for_game(game_id, SHARER_ID)
        assert len(shares) == 1 and shares[0]["revoked_at"] is not None

    def test_one_failed_email_skips_delivery_for_every_recipient(self, client, endpoint):
        game_id = _seed_game_with_clips()
        client.email_mocks[endpoint["email_fn"]].side_effect = (
            lambda **kw: kw["recipient_email"] != UNKNOWN_EMAIL
        )
        resp = endpoint["post"](client, game_id, [UNKNOWN_EMAIL, "other@example.com"])
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {"email": UNKNOWN_EMAIL, "sent": False},
                {"email": "other@example.com", "sent": True},
            ],
            "all_sent": False,
        }
        assert _pending("other@example.com") == []

    def test_email_carries_the_share_token_and_sender(self, client, endpoint):
        from app.services.sharing_db import list_shares_for_game

        game_id = _seed_game_with_clips()
        endpoint["post"](client, game_id, [UNKNOWN_EMAIL])
        kw = client.email_mocks[endpoint["email_fn"]].call_args.kwargs
        share = list_shares_for_game(game_id, SHARER_ID)[0]
        assert kw["recipient_email"] == UNKNOWN_EMAIL
        assert kw["sharer_email"] == SHARER_EMAIL
        assert kw["game_name"] == "Test Game"
        assert kw["share_token"] == share["share_token"]
        assert kw["is_first_touch"] is True

    def test_missing_game_is_404(self, client, endpoint):
        _seed_game_with_clips()
        resp = endpoint["post"](client, 999999, [UNKNOWN_EMAIL])
        assert resp.status_code == 404


class TestOneSharedFlow:
    def _calls(self, fn):
        tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
        return {
            node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", None)
            for node in ast.walk(tree) if isinstance(node, ast.Call)
        }

    def test_both_endpoints_call_the_shared_flow(self):
        from app.routers import games

        for fn in (games.share_game, games.share_playback):
            calls = self._calls(fn)
            assert "share_game_flow" in calls, f"{fn.__name__} must delegate to share_game_flow"
            assert "create_pending_share" not in calls, f"{fn.__name__} still has its own pending fallback"

    def test_the_pending_share_fallback_exists_once(self):
        from app.services import game_share

        source = inspect.getsource(game_share)
        assert source.count("create_pending_share(") == 1
        assert source.count("except (RefreshFailed, RecipientProfileBelowHead, MigrationBlocked)") == 1
