"""Tests for export_helpers.resolve_clip_source (T4175 shared source resolver).

Resolution order (first hit wins): game video -> preserved per-clip extract
(raw_clips.filename) -> recap (T4140 stub) -> raise SourceUnavailable.
"""

from unittest.mock import patch

import pytest

from app.services.export_helpers import resolve_clip_source, SourceUnavailable

USER_ID = "resolver-user"


def _clip(**overrides):
    base = {
        "id": 7,
        "game_id": 3,
        "game_blake3_hash": "deadbeef",
        "raw_start_time": 10.0,
        "raw_end_time": 15.0,
        "raw_duration": 5.0,
        "raw_filename": "",
    }
    base.update(overrides)
    return base


def test_game_present_no_fallback_returns_game_flexible():
    """A normal game clip (no preserved extract) returns the game video with full
    trim flexibility, and does NOT HEAD-probe (no fallback to protect)."""
    with patch("app.storage.generate_presigned_url_global", return_value="GAME_URL") as gp, \
         patch("app.storage.r2_head_object_global") as head, \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, in_off, out_off, flexible = resolve_clip_source(_clip())

    assert (url, in_off, out_off, flexible) == ("GAME_URL", 10.0, 15.0, True)
    gp.assert_called_once_with("games/deadbeef.mp4")
    head.assert_not_called()  # no extract fallback -> no HEAD probe


def test_game_present_with_extract_head_confirms_game():
    """When a preserved extract exists, the game object is HEAD-verified before
    being preferred (still returns the game while it's present)."""
    with patch("app.storage.generate_presigned_url_global", return_value="GAME_URL"), \
         patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1}), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        result = resolve_clip_source(_clip(raw_filename="auto_3_7_abcd.mp4"))

    assert result == ("GAME_URL", 10.0, 15.0, True)


def test_game_gone_falls_to_preserved_extract():
    """Game reclaimed (HEAD miss) -> the preserved extract at whole-file range,
    frozen bounds (flexible=False)."""
    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.storage.generate_presigned_url", return_value="EXTRACT_URL") as gp, \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, in_off, out_off, flexible = resolve_clip_source(
            _clip(raw_filename="auto_3_7_abcd.mp4")
        )

    assert (url, in_off, out_off, flexible) == ("EXTRACT_URL", 0.0, 5.0, False)
    gp.assert_called_once_with(USER_ID, "raw_clips/auto_3_7_abcd.mp4")


def test_no_game_id_uses_extract():
    """A clip with no game_id but a raw_filename resolves straight to the extract."""
    with patch("app.storage.generate_presigned_url", return_value="EXTRACT_URL"), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, in_off, out_off, flexible = resolve_clip_source(
            _clip(game_id=None, game_blake3_hash=None, raw_filename="auto_3_7.mp4")
        )

    assert (url, in_off, out_off, flexible) == ("EXTRACT_URL", 0.0, 5.0, False)


def test_extract_duration_from_start_end_when_no_raw_duration():
    """out_offset is raw_end - raw_start even when raw_duration is absent."""
    with patch("app.storage.generate_presigned_url", return_value="EXTRACT_URL"), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        _url, in_off, out_off, _flex = resolve_clip_source(
            _clip(game_id=None, game_blake3_hash=None, raw_filename="x.mp4",
                  raw_start_time=4.0, raw_end_time=9.0, raw_duration=None)
        )

    assert (in_off, out_off) == (0.0, 5.0)


def test_no_source_raises_source_unavailable():
    """Game gone, no extract, no recap -> visible failure (no silent fallback)."""
    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        with pytest.raises(SourceUnavailable):
            resolve_clip_source(_clip(raw_filename=""))


def test_game_presign_none_with_extract_falls_through():
    """Edge: game HEAD present but presign returns None -> falls to the extract
    rather than returning a null URL."""
    with patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1}), \
         patch("app.storage.generate_presigned_url_global", return_value=None), \
         patch("app.storage.generate_presigned_url", return_value="EXTRACT_URL"), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, in_off, out_off, flexible = resolve_clip_source(
            _clip(raw_filename="auto_3_7.mp4")
        )

    assert (url, in_off, out_off, flexible) == ("EXTRACT_URL", 0.0, 5.0, False)
