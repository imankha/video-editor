"""T5270: Warm recap poster at teammate share creation.

Covers:
- poster.recap_poster_r2_keys / poster.warm_recap_poster: key scheme matches
  ensure_recap_poster's convention, runs off the event loop (ffmpeg work must
  not block it), never raises even when ensure_recap_poster explodes.
- games.share_game / games.share_playback / clips.share_with_teammates: warm
  the recap poster once a share is actually created, AWAITED before the
  response returns; never called when no share was created (create_game_share
  failed for every recipient); a poster failure never fails share creation.
- End-to-end: after share creation warms the poster, the teammate GET
  poster.jpg endpoint is a pure cache read (asserts zero ffmpeg/extract calls).
"""

import asyncio
import threading
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import poster as poster_mod

USER_ID = "t5270-user"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# poster.recap_poster_r2_keys / poster.warm_recap_poster (unit)
# ---------------------------------------------------------------------------

def test_recap_poster_r2_keys_match_ensure_recap_poster_scheme():
    recap_key, poster_key = poster_mod.recap_poster_r2_keys(USER_ID, PROFILE_ID, 4242)
    assert recap_key.endswith(f"/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/4242.mp4")
    assert poster_key.endswith(f"/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/4242.jpg")


def test_warm_recap_poster_calls_ensure_recap_poster_with_scheme_keys():
    recap_key, poster_key = poster_mod.recap_poster_r2_keys(USER_ID, PROFILE_ID, 4242)
    with patch.object(poster_mod, "ensure_recap_poster", return_value=True) as gen:
        asyncio.run(poster_mod.warm_recap_poster(USER_ID, PROFILE_ID, 4242))
    gen.assert_called_once_with(recap_key, poster_key)


def test_warm_recap_poster_runs_off_the_event_loop():
    # ffmpeg work must not block the event loop -- verify it actually executes
    # on a worker thread, not the calling (main) thread.
    seen = {}

    def fake_ensure(recap_key, poster_key):
        seen["thread"] = threading.current_thread()
        return True

    with patch.object(poster_mod, "ensure_recap_poster", side_effect=fake_ensure):
        asyncio.run(poster_mod.warm_recap_poster(USER_ID, PROFILE_ID, 4242))
    assert seen["thread"] is not threading.main_thread()


def test_warm_recap_poster_never_raises_when_ensure_recap_poster_raises():
    with patch.object(poster_mod, "ensure_recap_poster", side_effect=RuntimeError("ffmpeg exploded")):
        asyncio.run(poster_mod.warm_recap_poster(USER_ID, PROFILE_ID, 4242))  # must not raise


# ---------------------------------------------------------------------------
# Router wiring: games.share_game / games.share_playback / clips.share_with_teammates
# ---------------------------------------------------------------------------

@pytest.fixture()
def db_env(tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        yield tmp_path


def _seed_game(user_id=USER_ID, profile_id=PROFILE_ID, blake3="abc123hash"):
    """Insert a minimal game row and return its id (real per-user SQLite --
    the recap-poster warming path this task adds has no Postgres dependency,
    so this avoids the pg_conn fixture entirely)."""
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(user_id)
    set_current_profile_id(profile_id)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("Test Game", blake3),
        )
        game_id = cursor.lastrowid
        conn.commit()
        return game_id


def _fake_jpeg_client():
    fake_resp = MagicMock(status_code=200, content=b"\xff\xd8jpegbytes")

    class _FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url): return fake_resp

    return _FakeClient


class _FakeR2:
    """In-memory R2 stand-in so ensure_recap_poster's real cache-HEAD logic
    runs unmodified against a fake object store."""

    def __init__(self):
        self.objects = {}
        self.extract_calls = 0

    def head(self, key):
        return {"ContentLength": len(self.objects[key])} if key in self.objects else None

    def upload(self, key, data, *, fast=False, content_type=None, metadata=None):
        self.objects[key] = data
        return True

    def presign(self, key, expires_in=3600):
        return f"https://fake-r2/{key}"


class TestShareGameWarmsPoster:
    def test_warms_before_response_returns(self, db_env):
        """Acceptance: creating a teammate share leaves the poster object in R2
        before the response returns (generation stubbed to a marker)."""
        from app.routers import games

        game_id = _seed_game()
        marker = {}

        def fake_ensure(recap_key, poster_key):
            marker["called"] = True
            marker["poster_key"] = poster_key
            return True

        with patch("app.services.sharing_db.create_game_share",
                   return_value={"share_token": "tok1", "recipient_email": "friend@example.com"}), \
             patch("app.services.email.send_game_share_email", new_callable=AsyncMock, return_value=True), \
             patch.object(poster_mod, "ensure_recap_poster", side_effect=fake_ensure):
            result = asyncio.run(games.share_game(game_id, games.ShareGameRequest(emails=["friend@example.com"])))

        assert result["all_sent"] is True
        # The marker was set INSIDE the awaited call -- proves the response
        # only returns after warming completed (not fire-and-forget).
        assert marker.get("called") is True
        assert marker["poster_key"].endswith(f"/recaps/posters/{game_id}.jpg")

    def test_not_called_when_no_share_was_created(self, db_env):
        from app.routers import games

        game_id = _seed_game()

        with patch("app.services.sharing_db.create_game_share", side_effect=RuntimeError("db down")), \
             patch("app.services.email.send_game_share_email", new_callable=AsyncMock, return_value=True), \
             patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock) as warm:
            result = asyncio.run(games.share_game(game_id, games.ShareGameRequest(emails=["friend@example.com"])))

        warm.assert_not_called()
        assert result["results"] == [{"email": "friend@example.com", "sent": True}]

    def test_poster_failure_never_fails_share_creation(self, db_env):
        """Acceptance: share creation still succeeds when poster warming fails."""
        from app.routers import games

        game_id = _seed_game()

        with patch("app.services.sharing_db.create_game_share",
                   return_value={"share_token": "tok1", "recipient_email": "friend@example.com"}), \
             patch("app.services.email.send_game_share_email", new_callable=AsyncMock, return_value=True), \
             patch.object(poster_mod, "ensure_recap_poster", side_effect=RuntimeError("ffmpeg exploded")):
            result = asyncio.run(games.share_game(game_id, games.ShareGameRequest(emails=["friend@example.com"])))

        assert result["all_sent"] is True


class TestSharePlaybackWarmsPoster:
    def test_warms_once_after_share_created(self, db_env):
        from app.routers import games

        game_id = _seed_game()

        with patch("app.services.sharing_db.create_game_share",
                   return_value={"share_token": "tok2", "recipient_email": "friend@example.com"}), \
             patch("app.services.email.send_playback_share_email", new_callable=AsyncMock, return_value=True), \
             patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock) as warm:
            result = asyncio.run(games.share_playback(game_id, games.SharePlaybackRequest(emails=["friend@example.com"])))

        assert result["all_sent"] is True
        warm.assert_awaited_once_with(USER_ID, PROFILE_ID, game_id)


class TestShareWithTeammatesWarmsPoster:
    def test_warms_once_per_game_across_recipients(self, db_env):
        from app.routers import clips

        game_id = _seed_game()
        body = clips.ShareWithTeammatesRequest(
            game_id=game_id,
            recipients=[
                clips.TeammateShareRecipient(tag_name="Jake", emails=["jake@example.com"]),
                clips.TeammateShareRecipient(tag_name="Sam", emails=["sam@example.com"]),
            ],
        )

        with patch("app.services.sharing_db.create_game_share",
                   return_value={"share_token": "tok3", "recipient_email": "x@example.com"}), \
             patch("app.services.email.send_teammate_share_email", new_callable=AsyncMock, return_value=True), \
             patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock) as warm:
            result = asyncio.run(clips.share_with_teammates(body))

        assert result["sent_tags"] == ["Jake", "Sam"]
        # One game -> one warm call, regardless of how many tags/recipients.
        warm.assert_awaited_once_with(USER_ID, PROFILE_ID, game_id)

    def test_not_called_when_no_tag_sent(self, db_env):
        from app.routers import clips

        game_id = _seed_game()
        body = clips.ShareWithTeammatesRequest(
            game_id=game_id,
            recipients=[clips.TeammateShareRecipient(tag_name="Jake", emails=["jake@example.com"])],
        )

        with patch("app.services.sharing_db.create_game_share",
                   return_value={"share_token": "tok4", "recipient_email": "x@example.com"}), \
             patch("app.services.email.send_teammate_share_email", new_callable=AsyncMock, return_value=False), \
             patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock) as warm:
            result = asyncio.run(clips.share_with_teammates(body))

        assert result["sent_tags"] == []
        warm.assert_not_called()


# ---------------------------------------------------------------------------
# End-to-end: warm-at-creation makes the first GET a pure cache read
# ---------------------------------------------------------------------------

def test_first_get_after_creation_does_not_reencode(db_env):
    """Acceptance: first GET .../poster.jpg after share creation is a pure
    cache read (no ffmpeg invocation)."""
    from app.routers import games, shares

    game_id = _seed_game()
    fake_r2 = _FakeR2()
    recap_key, poster_key = poster_mod.recap_poster_r2_keys(USER_ID, PROFILE_ID, game_id)
    fake_r2.objects[recap_key] = b"fake-recap-bytes"  # recap source exists

    def fake_extract(source, output_path, window=None):
        fake_r2.extract_calls += 1
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8jpegbytes")
        return True

    game_share_row = {
        "share_token": "tok5",
        "share_type": "game",
        "sharer_user_id": USER_ID,
        "sharer_profile_id": PROFILE_ID,
        "game_id": game_id,
        "revoked_at": None,
    }

    # Storage-level patches stay active across BOTH calls: ensure_recap_poster
    # (used by warm-at-creation) and get_shared_teammate_poster's own HEAD/
    # presign calls all resolve through app.storage's lazy imports.
    with patch("app.services.sharing_db.create_game_share",
               return_value={"share_token": "tok5", "recipient_email": "friend@example.com"}), \
         patch("app.services.email.send_game_share_email", new_callable=AsyncMock, return_value=True), \
         patch("app.storage.r2_head_object_global", side_effect=fake_r2.head), \
         patch("app.storage.upload_bytes_to_r2_global", side_effect=fake_r2.upload), \
         patch("app.storage.generate_presigned_url_global", side_effect=fake_r2.presign), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg", side_effect=fake_extract), \
         patch.object(poster_mod, "_jpeg_dimensions", return_value=(100, 100)), \
         patch.object(shares, "r2_head_object_global", side_effect=fake_r2.head), \
         patch.object(shares, "generate_presigned_url_global", side_effect=fake_r2.presign):
        result = asyncio.run(games.share_game(game_id, games.ShareGameRequest(emails=["friend@example.com"])))

        assert result["all_sent"] is True
        assert fake_r2.extract_calls == 1  # generated exactly once, at share-creation time
        assert poster_key in fake_r2.objects  # object exists BEFORE any GET

        with patch.object(shares, "get_game_share_by_token", return_value=game_share_row), \
             patch("httpx.AsyncClient", _fake_jpeg_client()):
            resp = asyncio.run(shares.get_shared_teammate_poster("tok5"))

    assert resp.media_type == "image/jpeg"
    assert fake_r2.extract_calls == 1  # unchanged -- the GET was a pure cache read
