"""T17770: a public game link must keep pointing at playable team recap media.

- "Restore full video" (DELETE /plays-only) must not delete the TEAM recap a live
  public game link for this game plays (it did, so the link presigned a missing key).
- The public resolver must not presign a team recap object that does not exist:
  recap_url None is the explicit "unavailable" state the viewer renders as a message.
"""

import asyncio
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.database import ensure_database, get_db_connection
from app.profile_context import set_current_profile_id
from app.routers import games as games_router
from app.user_context import set_current_user_id

PROFILE_ID = "testdefault"


@pytest.fixture()
def sharer(pg_conn, tmp_path):
    from app.services.auth_db import create_user
    from tests.conftest import register_test_user_ids
    user_id = f"t17770_{uuid.uuid4().hex[:8]}"
    create_user(user_id, email=f"{user_id}@example.com")
    register_test_user_ids(user_id)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        set_current_user_id(user_id)
        set_current_profile_id(PROFILE_ID)
        ensure_database()
        yield user_id


def _add_plays_only_game(user_id: str) -> int:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash, status, auto_export_status, plays_only_at) "
            "VALUES ('G', 'hash17770', 'ready', 'complete', CURRENT_TIMESTAMP)"
        )
        gid = cur.lastrowid
        cur.execute(
            "INSERT OR REPLACE INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) "
            "VALUES ('hash17770', 1, datetime('now', '+10 days'))"
        )
        conn.commit()
    return gid


def _seed_link(user_id: str, game_id: int, profile_id: str = PROFILE_ID) -> str:
    from app.services.sharing_db import create_game_share
    share = create_game_share(
        game_id=game_id, tag_name=None, sharer_user_id=user_id,
        sharer_profile_id=profile_id, recipient_email=f"{user_id}@example.com",
        game_name="G", game_blake3="hash17770",
        clip_names=[{"name": "Team goal", "recap_start": 0.0, "recap_end": 5.0, "player_tags": []}],
        share_type="game_link", game_date=None,
    )
    return share["share_token"]


def _restore(gid: int) -> list[str]:
    deleted = []
    with patch.object(games_router, "delete_from_r2", side_effect=lambda u, k: deleted.append(k) or True):
        assert asyncio.run(games_router.restore_full_video(gid)) == {"plays_only": False}
    return deleted


def test_restore_keeps_team_recap_a_live_public_game_link_plays(sharer):
    gid = _add_plays_only_game(sharer)
    _seed_link(sharer, gid)
    deleted = _restore(gid)
    assert f"recaps/{gid}_team.mp4" not in deleted
    assert f"recaps/{gid}_team_clips.json" not in deleted
    # The athlete recap is still discarded (T12920 D5).
    assert sorted(deleted) == sorted([f"recaps/{gid}.mp4", f"recaps/{gid}_clips.json"])


def test_restore_ignores_a_link_for_the_same_game_id_in_another_profile(sharer):
    gid = _add_plays_only_game(sharer)
    _seed_link(sharer, gid, profile_id="otherprofile")
    deleted = _restore(gid)
    assert f"recaps/{gid}_team.mp4" in deleted


def test_restore_deletes_team_recap_once_the_link_is_revoked(sharer):
    from app.services.sharing_db import revoke_game_link_share
    gid = _add_plays_only_game(sharer)
    _seed_link(sharer, gid)
    revoke_game_link_share(gid, sharer)
    deleted = _restore(gid)
    assert f"recaps/{gid}_team.mp4" in deleted


def test_resolver_reports_missing_team_recap_as_unavailable(sharer):
    from app.main import app
    from app.session_init import _init_cache
    _init_cache[sharer] = {"profile_id": PROFILE_ID, "is_new_user": False}
    token = _seed_link(sharer, 1)
    with patch("app.routers.shares.r2_head_object_global", return_value=None), \
         patch("app.routers.shares.generate_presigned_url_global",
               return_value="https://r2.example.com/recaps/1_team.mp4?sig"):
        resp = TestClient(app).get(f"/api/shared/game/{token}")
    assert resp.status_code == 200
    assert resp.json()["recap_url"] is None
