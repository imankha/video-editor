"""Player-intro card image storage (T5190).

Owns the R2 OBJECT for an intro card's image, not any DB row — the returned key
is written onto an `intro_cards` row by T5195. Two responsibilities:

- decode-verify + re-encode an uploaded still (reject non-images by DECODING,
  never by extension or declared content type), capped to a ~1440px long edge,
  alpha preserved when the source has it (a cut-out PNG from T5200 lands here);
- store it under the PER-PROFILE R2 prefix
  ``{APP_ENV}/users/{uid}/profiles/{pid}/intro/{uuid}.{ext}`` and expose a
  callable delete so T5230's compliance purge can remove it.

Per-profile is mandatory: an intro asset under any other prefix 404s
cross-profile (epic decision 7 — a known persistence-sync landmine). We build
the key for an EXPLICIT profile id via ``profile_r2_key`` (never the request
ContextVar), so an upload for a profile that is not the current request profile
still lands correctly.

The re-encode shape mirrors ``routers/export/overlay.py``'s poster upload, the
closest precedent in the codebase.

NO BIOMETRICS (T5230 compliance): this module decode-verifies and re-encodes an
image — it MUST NEVER run face recognition, facial templating, landmarking, or
any biometric identifier extraction on the photo (2025 COPPA amendment +
BIPA/CCPA; the subject is a minor). The only image analysis permitted anywhere
in the intro pipeline is background SEGMENTATION for the T5200 cut-out, which is
not recognition. Enforced by the static guardrail test
``tests/test_t5230_intro_compliance.py::test_no_face_recognition_in_intro_pipeline``.
"""

import logging
import time
import uuid

from app.storage import (
    delete_profile_object,
    generate_presigned_url_global,
    profile_r2_key,
    upload_bytes_to_r2_global,
)

logger = logging.getLogger(__name__)

# T6960: presign MEMOIZATION for intro images. A fresh presigned URL has fresh
# signature query params, so every play/reopen was a browser-cache MISS and
# re-downloaded the photo — the card lost the race and played photoless.
# Serving the SAME URL for a while makes the second and later loads instant
# cache hits. TTL is far below the presign's own 4h expiry (storage.py default
# 14400s), so a cached URL always has hours of validity left when handed out.
# In-process only (per machine) — a different machine just presigns again,
# which is exactly today's behavior, never an error.
_PRESIGN_TTL_SECONDS = 600
_presign_cache: dict[str, tuple[float, str]] = {}


def presign_intro_image(key: str) -> str:
    """Presigned GET URL for an intro image key, stable for ~10 minutes.

    Every surface that hands an intro image URL to a browser (card API
    previewUrl, playback payload, share payload) must use THIS, not a raw
    generate_presigned_url_global, or the browser cache is defeated by
    per-request signatures."""
    now = time.monotonic()
    hit = _presign_cache.get(key)
    if hit and now - hit[0] < _PRESIGN_TTL_SECONDS:
        return hit[1]
    url = generate_presigned_url_global(key)
    if len(_presign_cache) > 512:  # bound: a profile has ~a handful of keys
        _presign_cache.clear()
    _presign_cache[key] = (now, url)
    return url

# Relative prefix (under the per-profile R2 namespace) that all intro images
# live under. The delete path validates a key against this before removing it.
INTRO_PREFIX = "intro"

# Re-encode ceiling: the longer image edge is capped here (aspect preserved, no
# forced crop). Matches the poster upload.
MAX_LONG_EDGE = 1440

# JPEG quality for opaque images (alpha images are stored lossless PNG).
JPEG_QUALITY = 90


class InvalidImageError(ValueError):
    """The uploaded bytes are not a decodable image (caller -> HTTP 400)."""


def _reencode(raw: bytes) -> tuple[bytes, str, str]:
    """Decode-verify and re-encode an uploaded still.

    Returns ``(data, ext, content_type)``. Raises :class:`InvalidImageError`
    when the bytes are not a real image or cannot be re-encoded.

    Alpha is preserved: a 4-channel source (a cut-out PNG) is re-encoded as PNG
    so transparency survives; everything else becomes JPEG.
    """
    import cv2
    import numpy as np

    # IMREAD_UNCHANGED (not IMREAD_COLOR) so a 4-channel PNG keeps its alpha.
    decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
    if decoded is None:
        raise InvalidImageError("Uploaded file is not a valid image")

    if decoded.ndim == 2:
        has_alpha = False  # grayscale
    elif decoded.ndim == 3:
        has_alpha = decoded.shape[2] == 4
        # T6960: a fully-OPAQUE alpha channel is not transparency — it is how
        # phone screenshots/exports commonly arrive. Keeping those as lossless
        # PNG produced multi-MB card photos (a real 2.2MB upload) that lose the
        # download race against the 4s card on every fresh presign. Only real
        # transparency (a future T5200 cut-out) earns PNG; everything else is
        # flattened to JPEG.
        if has_alpha and bool((decoded[:, :, 3] == 255).all()):
            decoded = decoded[:, :, :3]
            has_alpha = False
    else:
        raise InvalidImageError("Unsupported image shape")

    height, width = decoded.shape[:2]
    long_edge = max(height, width)
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / long_edge
        decoded = cv2.resize(
            decoded,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )

    if has_alpha:
        ok, buf = cv2.imencode(".png", decoded)
        ext, content_type = "png", "image/png"
    else:
        ok, buf = cv2.imencode(".jpg", decoded, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        ext, content_type = "jpg", "image/jpeg"
    if not ok:
        raise InvalidImageError("Could not re-encode the uploaded image")

    return buf.tobytes(), ext, content_type


def store_intro_image(user_id: str, profile_id: str, raw: bytes) -> dict | None:
    """Decode-verify, re-encode and store an intro image for a profile.

    Returns ``{"key", "previewUrl", "ext"}`` where ``key`` is the FULL per-profile
    R2 object key (includes ``profiles/{profile_id}/`` — the cross-profile 404
    guard), or ``None`` if the R2 upload failed. Raises
    :class:`InvalidImageError` on a non-image (caller maps to HTTP 400).
    """
    data, ext, content_type = _reencode(raw)

    relative_path = f"{INTRO_PREFIX}/{uuid.uuid4().hex}.{ext}"
    key = profile_r2_key(user_id, profile_id, relative_path)

    if not upload_bytes_to_r2_global(key, data, content_type=content_type):
        logger.error(
            f"[IntroMedia] R2 upload FAILED for user={user_id} profile={profile_id} key={key}"
        )
        return None

    preview_url = presign_intro_image(key)
    logger.info(f"[IntroMedia] stored intro image key={key} ({len(data)} bytes)")
    return {"key": key, "previewUrl": preview_url, "ext": ext}


def validate_intro_key(user_id: str, profile_id: str, key: str) -> str:
    """Assert ``key`` is a real per-profile intro object key; return its
    profile-relative path.

    Raises :class:`ValueError` for a key from another profile/prefix or one not
    under the ``intro/`` prefix — the single source of truth for "does this key
    belong to this profile's intro namespace", so a bad key can never touch an
    unrelated object. Callers map the ValueError to HTTP 400.
    """
    base = profile_r2_key(user_id, profile_id, "")
    if not key.startswith(base):
        raise ValueError("intro image key does not belong to this profile")
    relative_path = key[len(base):]
    if not relative_path.startswith(f"{INTRO_PREFIX}/"):
        raise ValueError("intro image key is not under the intro/ prefix")
    return relative_path


def delete_intro_image(user_id: str, profile_id: str, key: str) -> bool:
    """Delete a profile's intro image R2 object by its stored full key.

    Callable service (not only an HTTP handler) so it can be reused off the HTTP
    path. Validates the key belongs to THIS profile's intro prefix before
    deleting (via :func:`validate_intro_key`), refusing (ValueError) a key from
    another profile/prefix. Returns ``delete_profile_object``'s result (True on
    success or R2 disabled).
    """
    relative_path = validate_intro_key(user_id, profile_id, key)
    return delete_profile_object(user_id, profile_id, relative_path)
