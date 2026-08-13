"""T6950 — ONE rule for which image an intro card shows: `image_key`, everywhere.

Before this task the egress paths (burn + playback presign) resolved
cutout-first (`image_cutout_key or image_key`) while the card API's
`previewUrl` — what the editor/carousel/picker display — presigned
`image_key` only. `image_cutout_key` never had a live writer (T5200 never
shipped), so a set-but-stale value would make playback/downloads show a
DIFFERENT photo than the editor. These tests pin the single rule and the
removal of the dead write surface. The column itself stays (harmless dead
data), so rows carrying a legacy value must still resolve via image_key.
"""

import tempfile

from app.services import intro_egress

STALE_CUTOUT_CARD = {
    "id": 1,
    "image_key": "intro/real-photo.png",
    "image_cutout_key": "intro/stale-cutout.png",  # legacy row value, must be ignored
}


def test_presign_ignores_stale_cutout(monkeypatch):
    monkeypatch.setattr(
        intro_egress, "presign_intro_image", lambda key: f"URL:{key}"
    )
    assert intro_egress._presign_card_image(STALE_CUTOUT_CARD) == "URL:intro/real-photo.png"


def test_presign_no_photo_returns_none():
    assert intro_egress._presign_card_image({"image_cutout_key": "intro/stale.png"}) is None


def test_download_ignores_stale_cutout(monkeypatch):
    requested = []

    def fake_download(key, local_path):
        requested.append(key)
        return True

    monkeypatch.setattr(intro_egress, "download_from_r2_global", fake_download)
    with tempfile.TemporaryDirectory() as tmp:
        path = intro_egress._download_card_image(STALE_CUTOUT_CARD, "u", "p", tmp)
    assert requested == ["intro/real-photo.png"]
    assert path is not None


def test_download_no_photo_returns_none(monkeypatch):
    monkeypatch.setattr(
        intro_egress,
        "download_from_r2_global",
        lambda key, local_path: (_ for _ in ()).throw(AssertionError("must not download")),
    )
    with tempfile.TemporaryDirectory() as tmp:
        assert intro_egress._download_card_image({"image_cutout_key": "x.png"}, "u", "p", tmp) is None


def test_cutout_write_surface_removed():
    """create/patch no longer accept the field, and the PATCH field map no
    longer routes it — the API cannot (re)introduce a divergent image."""
    from app.routers.intro_cards import (
        _UPDATABLE_FIELDS,
        CreateIntroCardRequest,
        UpdateIntroCardRequest,
    )

    assert "image_cutout_key" not in CreateIntroCardRequest.model_fields
    assert "image_cutout_key" not in UpdateIntroCardRequest.model_fields
    assert "image_cutout_key" not in _UPDATABLE_FIELDS


def test_card_payload_omits_cutout_key():
    """The playback payload no longer carries the dead field (no consumer)."""
    import inspect

    src = inspect.getsource(intro_egress._card_payload)
    assert "image_cutout_key" not in src
