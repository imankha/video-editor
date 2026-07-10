"""Tests for export_helpers.resolve_clip_source (T4175 shared source resolver).

Resolution order (first hit wins): game video -> preserved per-clip extract
(raw_clips.filename) -> recap (T4140 stub) -> raise SourceUnavailable.
"""

import json
from pathlib import Path
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
    """A normal game clip returns the game video with full trim flexibility.

    T4140: the game is HEAD-probed even without a preserved extract, because the
    recap is now a universal fallback for any reclaimed game clip. HEAD confirms
    present -> game wins."""
    with patch("app.storage.generate_presigned_url_global", return_value="GAME_URL") as gp, \
         patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1}) as head, \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, in_off, out_off, flexible = resolve_clip_source(_clip())

    assert (url, in_off, out_off, flexible) == ("GAME_URL", 10.0, 15.0, True)
    gp.assert_called_once_with("games/deadbeef.mp4")
    head.assert_called_once_with("games/deadbeef.mp4")  # T4140: always probe game clips


def test_game_gone_no_extract_falls_to_recap():
    """T4140 money path: game reclaimed (HEAD miss) + no preserved extract +
    recap present -> the recap segment at its frozen bounds (flexible=False).

    This is the Create-Clip (T4130) draft re-export after the game video is
    deleted: the draft has no extract, only the recap survives."""
    mapping = [
        {"id": 7, "recap_start": 12.5, "recap_end": 18.0, "name": "goal"},
        {"id": 99, "recap_start": 0.0, "recap_end": 4.0},
    ]

    def _fake_download(user_id, rel_path, local_path, *a, **k):
        assert rel_path == "recaps/3_clips.json"
        Path(local_path).write_text(json.dumps(mapping))
        return True

    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.storage.download_from_r2", side_effect=_fake_download) as dl, \
         patch("app.storage.generate_presigned_url", return_value="RECAP_URL") as gp, \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, in_off, out_off, flexible = resolve_clip_source(_clip(raw_filename=""))

    assert (url, in_off, out_off, flexible) == ("RECAP_URL", 12.5, 18.0, False)
    dl.assert_called_once()
    gp.assert_called_once_with(USER_ID, "recaps/3.mp4")


def test_recap_matches_raw_clip_id_over_working_clip_id():
    """The recap mapping is keyed by the RAW clip id, so the resolver matches on
    raw_clip_id (not the working_clip `id`) when both are present."""
    mapping = [{"id": 55, "recap_start": 1.0, "recap_end": 2.0}]

    def _fake_download(user_id, rel_path, local_path, *a, **k):
        Path(local_path).write_text(json.dumps(mapping))
        return True

    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.storage.download_from_r2", side_effect=_fake_download), \
         patch("app.storage.generate_presigned_url", return_value="RECAP_URL"), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, in_off, out_off, flexible = resolve_clip_source(
            _clip(id=900, raw_clip_id=55, raw_filename="")
        )

    assert (url, in_off, out_off, flexible) == ("RECAP_URL", 1.0, 2.0, False)


def test_recap_missing_entry_falls_through_to_source_unavailable():
    """Recap mapping exists but has no entry for this clip -> visible failure
    (no silent fallback), not a wrong segment."""
    mapping = [{"id": 12345, "recap_start": 0.0, "recap_end": 3.0}]

    def _fake_download(user_id, rel_path, local_path, *a, **k):
        Path(local_path).write_text(json.dumps(mapping))
        return True

    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.storage.download_from_r2", side_effect=_fake_download), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        with pytest.raises(SourceUnavailable):
            resolve_clip_source(_clip(raw_filename=""))


def test_recap_mapping_absent_falls_through_to_source_unavailable():
    """Game gone, no extract, and no recap mapping in R2 -> SourceUnavailable."""
    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.storage.download_from_r2", return_value=False), \
         patch("app.user_context.get_current_user_id", return_value=USER_ID):
        with pytest.raises(SourceUnavailable):
            resolve_clip_source(_clip(raw_filename=""))


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
         patch("app.storage.download_from_r2", return_value=False), \
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
