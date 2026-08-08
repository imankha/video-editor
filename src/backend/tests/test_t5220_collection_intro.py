"""
T5220 -- collection SHARE playback pre-roll payload (design §3 row 4, §5.4,
§9's `routers/collections.py` change).

Distinct from `test_t5215_collection_intro.py` (the collection's OWN
attachment resolution / storage, already shipped) and from
`_evaluated_share_members` (already resolves the FROZEN intro row, T5215).
This task extends `resolve_collection_share`'s `intro_fields` block (currently
just `{intro_card_id, intro_card_name}`, collections.py:932-936, with the
literal comment "T5215: id + name now; T5220 adds the presigned pre-roll
payload.") to serialize the FULL pre-roll payload MotionPreview needs:
`{card, previewUrl, field_values, profile}` under a single `intro` key.

Key semantics under test (design §3 row 4 + §12):
  - a frozen intro serializes the payload ONCE under a single `intro` key at
    the top of the collection payload -- NOT once per member (first-segment
    semantics at the payload level)
  - a legacy share whose `collection_definition` has no `intro_card_id` key
    at all carries NO `intro` field (matches `_evaluated_share_members`'
    existing `.get("intro_card_id", 0)` default-to-none-intro behavior)

`resolve_collection_share` does not yet emit `intro` (only `intro_card_id`/
`intro_card_name`) -- these tests are RED until Stage 4 wires the payload.
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SHARER_ID = "t5220-coll-sharer"
SHARER_PROFILE = "t5220collprof"


def _share_row(definition: dict, *, is_public=True) -> dict:
    return {
        "share_token": "tok-t5220-coll",
        "sharer_user_id": SHARER_ID,
        "sharer_profile_id": SHARER_PROFILE,
        "collection_definition": json.dumps(definition),
        "collection_is_public": is_public,
        "revoked_at": None,
    }


def _card_row(card_id=5, name="Hero Card", image_key="k.png"):
    return {
        "id": card_id, "name": name, "shown_fields": ["position"],
        "treatment": "gold", "title_text": None, "image_key": image_key,
        "image_cutout_key": None, "focal_x": 0.5, "focal_y": 0.3, "zoom": 1.1,
        "text_elements": {}, "duration": 4.0, "is_default": False,
    }


def _members(n=2):
    return [
        {"id": i, "name": f"Member {i}", "duration": 10.0, "filename": f"m{i}.mp4"}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def _patch_shared_deps():
    # A real `open_profile_db_readonly` return is a `conn` the caller always
    # `.close()`s in a `finally` -- a bare `object()` stand-in can't support
    # that real contract, so this needs a MagicMock (conn itself is never
    # otherwise touched: `evaluate_collection_members`/`resolve_intro_card`
    # are both mocked below and ignore it).
    with patch("app.routers.collections.open_profile_db_readonly", return_value=MagicMock()), \
         patch("app.routers.collections.evaluate_collection_members", return_value=_members()), \
         patch("app.routers.collections.select_within_budget", side_effect=lambda members, budget: members), \
         patch("app.routers.collections.generate_presigned_url_global", return_value="https://r2.example/vid.mp4"), \
         patch("app.routers.collections.r2_head_object_global", return_value=None):
        yield


def test_frozen_intro_serializes_pre_roll_payload_once_under_intro_key():
    from app.routers.collections import resolve_collection_share

    definition = {
        "title": "Top Goals", "aspect_ratio": "9:16", "scope": {"type": "mixes"},
        "intro_card_id": 5,
    }
    share = _share_row(definition)

    with patch("app.routers.collections.resolve_intro_card", return_value=_card_row(card_id=5)):
        payload = resolve_collection_share(share)

    assert "intro" in payload, "a frozen intro must serialize under a single top-level 'intro' key"
    intro = payload["intro"]
    assert intro["card"]["id"] == 5
    assert "previewUrl" in intro
    assert "field_values" in intro
    assert "profile" in intro

    # First-segment semantics: exactly ONE intro key at the payload level --
    # members must carry NO per-member intro field.
    assert "intro" not in json.dumps(payload["members"]), \
        "members must not carry their own intro -- pre-roll is once, before the first member"
    for m in payload["members"]:
        assert "intro" not in m


def test_legacy_share_with_no_intro_card_id_key_carries_no_intro():
    from app.routers.collections import resolve_collection_share

    # No "intro_card_id" key at all -- pre-dates T5215's field.
    definition = {"title": "Old Share", "aspect_ratio": "9:16", "scope": {"type": "mixes"}}
    share = _share_row(definition)

    with patch("app.routers.collections.resolve_intro_card", return_value=None) as mock_resolve:
        payload = resolve_collection_share(share)

    # Legacy default is 0 (no intro), matching _evaluated_share_members'
    # `.get("intro_card_id", 0)`.
    assert mock_resolve.call_args.args[0] == 0 or mock_resolve.call_args.kwargs.get("intro_card_id") == 0
    assert "intro" not in payload
    assert payload.get("intro_card_id") is None
    assert payload.get("intro_card_name") is None


def test_zero_intro_card_id_explicit_opt_out_carries_no_intro():
    from app.routers.collections import resolve_collection_share

    definition = {"title": "No Intro Wanted", "aspect_ratio": "9:16",
                  "scope": {"type": "mixes"}, "intro_card_id": 0}
    share = _share_row(definition)

    with patch("app.routers.collections.resolve_intro_card", return_value=None):
        payload = resolve_collection_share(share)

    assert "intro" not in payload


def test_intro_payload_shape_matches_motion_preview_contract():
    """The serialized `intro.card` carries the fields MotionPreview/
    resolveFraming/useCardPreviewElements already consume (design §5.4) --
    image_key, treatment, shown_fields, text_elements, focal_x/y, zoom,
    duration."""
    from app.routers.collections import resolve_collection_share

    definition = {"title": "Hero", "aspect_ratio": "9:16", "scope": {"type": "mixes"},
                  "intro_card_id": 5}
    share = _share_row(definition)

    with patch("app.routers.collections.resolve_intro_card", return_value=_card_row(card_id=5)):
        payload = resolve_collection_share(share)

    card = payload["intro"]["card"]
    for field in ("image_key", "treatment", "shown_fields", "text_elements",
                  "focal_x", "focal_y", "zoom", "duration"):
        assert field in card, f"intro.card missing '{field}' MotionPreview needs"
