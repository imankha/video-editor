"""T5180: Real recap footage on game/teammate share links.

Covers:
- ensure_recap_poster: reuse-if-cached (no re-encode), generate-on-first-request,
  missing-recap -> False (edge falls back to branded card)
- recap key scheme (recaps/{game_id}.mp4 -> recaps/posters/{game_id}.jpg)
- _resolve_recap_poster_url: URL only when a recap/poster exists, else None
- GET /api/shared/teammate/{token}/poster.jpg: 404 (no share/revoked/wrong type/
  no game_id/no recap); image/jpeg + 24h cache when it resolves
- recap poster uses the WHOLE-CLIP helper (no window) -- not the reel slow-mo policy
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.services import poster as poster_mod

USER_ID = "test-user-t5180"
PROFILE_ID = "t5180prof"
GAME_ID = 4242


def _game_share(**over):
    base = {
        "share_token": "gtok",
        "share_type": "game",
        "sharer_user_id": USER_ID,
        "sharer_profile_id": PROFILE_ID,
        "game_id": GAME_ID,
        "revoked_at": None,
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# Recap key scheme
# ---------------------------------------------------------------------------

def test_recap_key_scheme():
    from app.routers import shares
    share = _game_share()
    assert shares._recap_r2_key(share).endswith(
        f"/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/{GAME_ID}.mp4"
    )
    assert shares._recap_poster_r2_key(share).endswith(
        f"/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/{GAME_ID}.jpg"
    )


# ---------------------------------------------------------------------------
# ensure_recap_poster
# ---------------------------------------------------------------------------

RECAP_KEY = f"dev/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/{GAME_ID}.mp4"
POSTER_KEY = f"dev/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/{GAME_ID}.jpg"


def test_ensure_recap_poster_reuses_cache_no_reencode():
    # Poster already present -> True, and extract/upload never run.
    with patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1}) as head, \
         patch.object(poster_mod, "extract_clearest_frame_jpeg") as ex, \
         patch("app.storage.upload_bytes_to_r2_global") as up:
        assert poster_mod.ensure_recap_poster(RECAP_KEY, POSTER_KEY) is True
    head.assert_called_once_with(POSTER_KEY)  # short-circuits on the poster HEAD
    ex.assert_not_called()
    up.assert_not_called()


def test_ensure_recap_poster_missing_recap_returns_false():
    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg") as ex:
        assert poster_mod.ensure_recap_poster(RECAP_KEY, POSTER_KEY) is False
    ex.assert_not_called()


def test_ensure_recap_poster_generates_whole_clip(tmp_path):
    def head(key):
        return None if key == POSTER_KEY else {"ContentLength": 999}  # recap present

    captured = {}

    def fake_extract(source, output_path, window=None):
        captured["window"] = window
        captured["source"] = source
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8jpegbytes")
        return True

    def fake_upload(key, data, *, fast=False, content_type=None, metadata=None):
        captured.update(up_key=key, content_type=content_type, metadata=metadata, size=len(data))
        return True

    with patch("app.storage.r2_head_object_global", side_effect=head), \
         patch("app.storage.generate_presigned_url_global", return_value="https://r2/recap.mp4?sig=1"), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg", side_effect=fake_extract), \
         patch.object(poster_mod, "_jpeg_dimensions", return_value=(1280, 720)), \
         patch("app.storage.upload_bytes_to_r2_global", side_effect=fake_upload):
        assert poster_mod.ensure_recap_poster(RECAP_KEY, POSTER_KEY) is True

    # Whole-clip policy: NO window (reel slow-mo policy must not apply to recaps).
    assert captured["window"] is None
    assert captured["source"] == "https://r2/recap.mp4?sig=1"
    assert captured["up_key"] == POSTER_KEY
    assert captured["content_type"] == "image/jpeg"
    assert captured["metadata"] == {"width": 1280, "height": 720}


def test_ensure_recap_poster_never_raises():
    with patch("app.storage.r2_head_object_global", side_effect=RuntimeError("r2 down")):
        assert poster_mod.ensure_recap_poster(RECAP_KEY, POSTER_KEY) is False


# ---------------------------------------------------------------------------
# _resolve_recap_poster_url
# ---------------------------------------------------------------------------

def test_resolve_recap_poster_url_present():
    from app.routers import shares
    # Recap source exists (poster HEAD None, recap HEAD present).
    def head(key):
        return {"x": 1} if key.endswith(f"recaps/{GAME_ID}.mp4") else None
    with patch.object(shares, "r2_head_object_global", side_effect=head):
        url = shares._resolve_recap_poster_url(_game_share())
    assert url == "/api/shared/teammate/gtok/poster.jpg"


def test_resolve_recap_poster_url_absent():
    from app.routers import shares
    with patch.object(shares, "r2_head_object_global", return_value=None):
        assert shares._resolve_recap_poster_url(_game_share()) is None


def test_resolve_recap_poster_url_no_game_id():
    from app.routers import shares
    # No game_id -> None without any R2 call.
    with patch.object(shares, "r2_head_object_global") as head:
        assert shares._resolve_recap_poster_url(_game_share(game_id=None)) is None
    head.assert_not_called()


# ---------------------------------------------------------------------------
# GET /api/shared/teammate/{token}/poster.jpg
# ---------------------------------------------------------------------------

def _fake_jpeg_client():
    fake_resp = MagicMock(status_code=200, content=b"\xff\xd8jpegbytes")

    class _FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url): return fake_resp

    return _FakeClient


def test_teammate_poster_serves_jpeg_and_generates():
    import httpx

    from app.routers import shares

    share = _game_share()
    with patch.object(shares, "get_game_share_by_token", return_value=share), \
         patch("app.services.poster.ensure_recap_poster", return_value=True) as gen, \
         patch.object(shares, "r2_head_object_global", return_value={"Metadata": {}}), \
         patch.object(shares, "generate_presigned_url_global", return_value="https://r2/p.jpg?sig=1"), \
         patch.object(httpx, "AsyncClient", _fake_jpeg_client()):
        resp = asyncio.run(shares.get_shared_teammate_poster("gtok"))

    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "public, max-age=86400"
    assert resp.body == b"\xff\xd8jpegbytes"
    # Generated against the recap key under the sharer's prefix.
    gen.assert_called_once_with(shares._recap_r2_key(share), shares._recap_poster_r2_key(share))


def test_teammate_poster_404_when_no_recap():
    from app.routers import shares
    share = _game_share()
    with patch.object(shares, "get_game_share_by_token", return_value=share), \
         patch("app.services.poster.ensure_recap_poster", return_value=False):
        with pytest.raises(HTTPException) as e:
            asyncio.run(shares.get_shared_teammate_poster("gtok"))
    assert e.value.status_code == 404


@pytest.mark.parametrize("share", [
    None,
    _game_share(revoked_at="2026-07-16"),
    _game_share(share_type="video"),
    _game_share(game_id=None),
])
def test_teammate_poster_404_guards(share):
    from app.routers import shares
    with patch.object(shares, "get_game_share_by_token", return_value=share):
        with pytest.raises(HTTPException) as e:
            asyncio.run(shares.get_shared_teammate_poster("gtok"))
    assert e.value.status_code == 404
