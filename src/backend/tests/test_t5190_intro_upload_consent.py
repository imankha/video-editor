"""T5190 — Card image upload + parental-consent attestation.

Covers the backend halves:
- decode-verify + alpha-preserving re-encode + long-edge cap (_reencode);
- the per-profile R2 key SHAPE (must include profiles/{pid}/intro/ — the
  cross-profile 404 landmine, epic decision 7);
- upload / replace / delete of the intro object, and delete refusing a foreign
  key (the callable T5230 will reuse);
- consent recorded once per profile, exposed on GET /api/profiles, gating (null
  when absent), revoked, and isolated between profiles.

R2 is stubbed with an in-memory dict so the object round-trip is asserted
without a live bucket (mirrors test_t5410_poster_selection.py's patch pattern).

Run with: pytest tests/test_t5190_intro_upload_consent.py -v
"""

import sys
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.main import app
from app.services import intro_media
from app.services.user_db import (
    create_profile,
    ensure_user_database,
    set_selected_profile_id,
)


def _uid(prefix: str = "t5190") -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def _jpeg_bytes(w: int = 64, h: int = 48) -> bytes:
    img = np.full((h, w, 3), 128, dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def _png_with_alpha(w: int = 64, h: int = 48) -> bytes:
    # 4-channel BGRA with a non-trivial alpha ramp so we can prove it survived.
    img = np.zeros((h, w, 4), dtype=np.uint8)
    img[:, :, :3] = 200
    img[:, :, 3] = np.tile(np.linspace(0, 255, w, dtype=np.uint8), (h, 1))
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


class _FakeR2:
    """In-memory stand-in for the global R2 object helpers."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def upload(self, key, data, *, content_type=None, metadata=None):
        self.objects[key] = data
        return True

    def presign(self, key, expires_in=14400):
        return f"https://fake-r2/{key}" if key in self.objects else None

    def delete_profile(self, user_id, profile_id, relative_path):
        from app.storage import profile_r2_key
        key = profile_r2_key(user_id, profile_id, relative_path)
        existed = self.objects.pop(key, None)
        return existed is not None or True  # delete_profile_object returns True on success


@pytest.fixture
def fake_r2():
    fake = _FakeR2()
    with patch.object(intro_media, "upload_bytes_to_r2_global", side_effect=fake.upload), \
         patch.object(intro_media, "generate_presigned_url_global", side_effect=fake.presign), \
         patch.object(intro_media, "delete_profile_object", side_effect=fake.delete_profile):
        yield fake


@pytest.fixture
def user_with_two_profiles():
    uid = _uid()
    p1, p2 = uuid4().hex[:8], uuid4().hex[:8]
    ensure_user_database(uid)
    create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
    create_profile(uid, p2, "Jordan", "#10B981")
    set_selected_profile_id(uid, p1)
    return uid, p1, p2


def _headers(uid, pid):
    return {"X-User-ID": uid, "X-Profile-ID": pid}


# ---------------------------------------------------------------------------
# _reencode — decode-verify, alpha, size cap
# ---------------------------------------------------------------------------

class TestReencode:
    def test_valid_jpeg_reencodes_to_jpeg(self):
        data, ext, ct = intro_media._reencode(_jpeg_bytes())
        assert ext == "jpg"
        assert ct == "image/jpeg"
        assert cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED) is not None

    def test_png_with_alpha_preserves_alpha(self):
        data, ext, ct = intro_media._reencode(_png_with_alpha())
        assert ext == "png"
        assert ct == "image/png"
        decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
        assert decoded.shape[2] == 4, "alpha channel must survive re-encode"

    def test_text_file_rejected_by_decoding(self):
        with pytest.raises(intro_media.InvalidImageError):
            intro_media._reencode(b"this is definitely not an image, even named .jpg")

    def test_oversized_image_is_reencoded_not_rejected(self):
        data, _ext, _ = intro_media._reencode(_jpeg_bytes(w=4000, h=2000))
        decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
        assert max(decoded.shape[:2]) <= intro_media.MAX_LONG_EDGE
        assert max(decoded.shape[:2]) == intro_media.MAX_LONG_EDGE  # long edge hit the cap


# ---------------------------------------------------------------------------
# store_intro_image / delete_intro_image — key shape + object lifecycle
# ---------------------------------------------------------------------------

class TestStoreAndDelete:
    def test_key_shape_includes_profile_id(self, fake_r2):
        uid, pid = _uid(), uuid4().hex[:8]
        result = intro_media.store_intro_image(uid, pid, _jpeg_bytes())
        assert result is not None
        # THE 404 landmine assertion: the key must be under this profile's prefix.
        assert f"/users/{uid}/profiles/{pid}/intro/" in result["key"]
        assert result["key"].endswith(".jpg")
        assert result["previewUrl"].startswith("https://fake-r2/")
        assert result["key"] in fake_r2.objects

    def test_upload_returns_none_when_r2_fails(self):
        with patch.object(intro_media, "upload_bytes_to_r2_global", return_value=False):
            assert intro_media.store_intro_image(_uid(), "pid1234", _jpeg_bytes()) is None

    def test_delete_removes_the_object(self, fake_r2):
        uid, pid = _uid(), uuid4().hex[:8]
        result = intro_media.store_intro_image(uid, pid, _jpeg_bytes())
        assert result["key"] in fake_r2.objects
        assert intro_media.delete_intro_image(uid, pid, result["key"]) is True
        assert result["key"] not in fake_r2.objects

    def test_delete_refuses_foreign_profile_key(self, fake_r2):
        uid = _uid()
        # A key under a DIFFERENT profile must be refused, never deleted.
        from app.storage import profile_r2_key
        foreign = profile_r2_key(uid, "otherpid", "intro/abc.jpg")
        with pytest.raises(ValueError):
            intro_media.delete_intro_image(uid, "mypid123", foreign)

    def test_delete_refuses_key_outside_intro_prefix(self, fake_r2):
        uid, pid = _uid(), "pid99999"
        from app.storage import profile_r2_key
        outside = profile_r2_key(uid, pid, "final_videos/x.mp4")
        with pytest.raises(ValueError):
            intro_media.delete_intro_image(uid, pid, outside)


# ---------------------------------------------------------------------------
# Endpoints — upload, per-profile isolation, non-image rejection
# ---------------------------------------------------------------------------

class TestUploadEndpoint:
    def test_upload_valid_image(self, fake_r2, user_with_two_profiles):
        uid, p1, _ = user_with_two_profiles
        client = TestClient(app)
        resp = client.post(
            f"/api/profiles/{p1}/intro/image",
            headers=_headers(uid, p1),
            files={"image": ("photo.jpg", _jpeg_bytes(), "image/jpeg")},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["success"] is True
        assert f"/profiles/{p1}/intro/" in body["key"]
        assert body["previewUrl"]

    def test_non_image_rejected_400(self, fake_r2, user_with_two_profiles):
        uid, p1, _ = user_with_two_profiles
        client = TestClient(app)
        resp = client.post(
            f"/api/profiles/{p1}/intro/image",
            headers=_headers(uid, p1),
            # A text file renamed .jpg with an image content type — still rejected.
            files={"image": ("evil.jpg", b"not an image at all", "image/jpeg")},
        )
        assert resp.status_code == 400

    def test_second_profile_gets_its_own_prefix(self, fake_r2, user_with_two_profiles):
        uid, p1, p2 = user_with_two_profiles
        client = TestClient(app)
        r1 = client.post(
            f"/api/profiles/{p1}/intro/image",
            headers=_headers(uid, p1),
            files={"image": ("a.jpg", _jpeg_bytes(), "image/jpeg")},
        ).json()
        r2 = client.post(
            f"/api/profiles/{p2}/intro/image",
            headers=_headers(uid, p1),  # request profile is p1, URL targets p2
            files={"image": ("b.jpg", _jpeg_bytes(), "image/jpeg")},
        ).json()
        assert f"/profiles/{p1}/intro/" in r1["key"]
        assert f"/profiles/{p2}/intro/" in r2["key"]
        assert r1["key"] != r2["key"]

    def test_upload_to_unknown_profile_404(self, fake_r2, user_with_two_profiles):
        uid, p1, _ = user_with_two_profiles
        client = TestClient(app)
        resp = client.post(
            "/api/profiles/deadbeef/intro/image",
            headers=_headers(uid, p1),
            files={"image": ("a.jpg", _jpeg_bytes(), "image/jpeg")},
        )
        assert resp.status_code == 404

    def test_delete_via_endpoint(self, fake_r2, user_with_two_profiles):
        uid, p1, _ = user_with_two_profiles
        client = TestClient(app)
        key = client.post(
            f"/api/profiles/{p1}/intro/image",
            headers=_headers(uid, p1),
            files={"image": ("a.jpg", _jpeg_bytes(), "image/jpeg")},
        ).json()["key"]
        assert key in fake_r2.objects
        resp = client.request(
            "DELETE",
            f"/api/profiles/{p1}/intro/image",
            headers=_headers(uid, p1),
            json={"key": key},
        )
        assert resp.status_code == 200, resp.text
        assert key not in fake_r2.objects


# ---------------------------------------------------------------------------
# Consent — record once, expose on payload, gate, revoke, isolate
# ---------------------------------------------------------------------------

class TestConsent:
    def test_consent_absent_by_default(self, user_with_two_profiles):
        uid, p1, _ = user_with_two_profiles
        client = TestClient(app)
        profiles = client.get("/api/profiles", headers=_headers(uid, p1)).json()["profiles"]
        assert all(p["introConsentAt"] is None for p in profiles)

    def test_record_and_expose_consent(self, user_with_two_profiles):
        uid, p1, p2 = user_with_two_profiles
        client = TestClient(app)
        resp = client.post(f"/api/profiles/{p1}/intro/consent", headers=_headers(uid, p1))
        assert resp.status_code == 200
        ts = resp.json()["introConsentAt"]
        assert ts

        profiles = {
            p["id"]: p
            for p in client.get("/api/profiles", headers=_headers(uid, p1)).json()["profiles"]
        }
        assert profiles[p1]["introConsentAt"] == ts
        # Consent is per profile — the OTHER profile is still ungated.
        assert profiles[p2]["introConsentAt"] is None

    def test_revoke_consent(self, user_with_two_profiles):
        uid, p1, _ = user_with_two_profiles
        client = TestClient(app)
        client.post(f"/api/profiles/{p1}/intro/consent", headers=_headers(uid, p1))
        resp = client.request(
            "DELETE", f"/api/profiles/{p1}/intro/consent", headers=_headers(uid, p1)
        )
        assert resp.status_code == 200
        assert resp.json()["introConsentAt"] is None
        profiles = {
            p["id"]: p
            for p in client.get("/api/profiles", headers=_headers(uid, p1)).json()["profiles"]
        }
        assert profiles[p1]["introConsentAt"] is None

    def test_consent_on_unknown_profile_404(self, user_with_two_profiles):
        uid, p1, _ = user_with_two_profiles
        client = TestClient(app)
        resp = client.post("/api/profiles/deadbeef/intro/consent", headers=_headers(uid, p1))
        assert resp.status_code == 404
