"""Cross-DB intro resolution for egress (T5220 design §3, §4.1).

The ONE seam that assembles a resolvable intro attachment (a T5215
`intro_cards` row from profile.sqlite + the profile's fact VALUES from
user.sqlite + an R2 image) for the THREE live-resolving egress paths --
owner download, single-reel share playback, single-reel share download --
so they never diverge in how they read facts (design §3's "Cross-DB
assembly" seam).

Deliberately excludes the COLLECTION path: a collection share resolves its
intro from the ALREADY-FROZEN value on the share definition
(`routers/collections.py::_evaluated_share_members`, T5215) -- that is a
serialization concern (design §3 row 4), not a live resolution, so it does
NOT call this module.

Two modes, matching the two shapes egress needs:
  - "burn"     -- downloads the card image (cutout-preferred) to a LOCAL temp
                  path, for `player_intro.build_intro_card` (needs image
                  BYTES to hash + composite). Returns an `IntroSpec`.
  - "playback" -- presigns the image URL (no download), for the DOM pre-roll
                  payload (`MotionPreview` reads a URL, not a local file).
                  Returns a plain serializable dict, or None.

NON-FATAL, ALWAYS: any failure (missing card, missing image, download error)
degrades to "no intro" (None) and logs -- this must never fail a download,
share resolve, or export (epic decision 9, design §11 R2/R3).
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from app.services.intro_cards import resolve_intro_card
from app.services.user_db import get_all_intro_facts, get_all_intro_full_names
from app.storage import download_from_r2_global, generate_presigned_url_global

logger = logging.getLogger(__name__)


@dataclass
class IntroSpec:
    """A resolved, ready-to-render intro: the card row, the profile's fact
    VALUES (cross-DB assembled), and -- for the "burn" variant -- a LOCAL
    image path under an owning tempdir the caller must `.cleanup()`.

    `image_path` is None when the card has no photo (title-only) -- a valid,
    non-error state, not a failure.
    """

    card: dict
    field_values: dict
    image_path: str | None = None
    tempdir: str | None = None
    _cleaned: bool = field(default=False, repr=False, compare=False)

    def cleanup(self) -> None:
        """Remove the owning tempdir (the downloaded card image), if any.
        Idempotent -- safe to call more than once, and safe to call when no
        tempdir was ever created (title-only card, or a caller that never
        downloaded an image)."""
        if self._cleaned or not self.tempdir:
            return
        import shutil
        shutil.rmtree(self.tempdir, ignore_errors=True)
        self._cleaned = True


def _load_field_values(user_id: str, profile_id: str) -> dict:
    """Cross-DB assembly: `full_name` + the fact fields (position/class/team)
    for ONE profile, from user.sqlite. Missing profile key -> {} (title still
    renders from full_name when present; facts simply omit+log downstream,
    per T6620's existing per-slot omission)."""
    facts = get_all_intro_facts(user_id).get(profile_id, {})
    full_name = get_all_intro_full_names(user_id).get(profile_id)
    values = dict(facts)
    if full_name:
        values["full_name"] = full_name
    return values


def _download_card_image(card: dict, user_id: str, profile_id: str, tempdir: str) -> str | None:
    """Download the card's image (cutout-preferred) from its GLOBAL R2 key to
    a local path under `tempdir`. Returns None when the card has no photo.
    Raises on a download failure (the caller degrades non-fatally)."""
    key = card.get("image_cutout_key") or card.get("image_key")
    if not key:
        return None
    ext = Path(key).suffix or ".png"
    local_path = Path(tempdir) / f"card_image{ext}"
    if not download_from_r2_global(key, local_path):
        raise RuntimeError(f"could not download intro card image {key!r} from R2")
    return str(local_path)


def _presign_card_image(card: dict) -> str | None:
    """Presigned URL for the card's image (cutout-preferred), or None when the
    card has no photo. Never downloads -- for the playback (DOM pre-roll) path."""
    key = card.get("image_cutout_key") or card.get("image_key")
    if not key:
        return None
    return generate_presigned_url_global(key)


def resolve_intro_for_reel(
    user_id: str,
    profile_id: str,
    intro_card_id: int | None,
    reel_duration: float | None,
    reel_id: int | None,
    *,
    mode: str = "burn",
    profile_conn=None,
) -> "IntroSpec | dict | None":
    """Resolve the LIVE intro attachment for one reel, cross-DB assembled.

    `profile_conn`: an already-open connection to the reel's profile.sqlite
    (read-only for shares, the owner's live connection for downloads). When
    omitted, opens the profile owner's own DB via `get_db_connection()` (the
    request-scoped ambient connection) -- used by the owner-download path,
    which already runs inside that request context.

    mode="burn": downloads the card image (cutout-preferred) to a temp path
      under a NEW owning tempdir; returns an `IntroSpec` the caller MUST
      `.cleanup()` (or None when nothing resolves / the download fails).
    mode="playback": presigns the image URL (no download); returns a plain
      serializable payload dict `{card, previewUrl, field_values, profile}`
      (or None).

    NEVER raises: every failure (no card, DB error, download error) degrades
    to None and logs. This governs owner download (paths 1) and single-reel
    share playback/download (paths 2/3) -- design §3's asymmetric-by-design
    LIVE resolution (vs. the collection's FROZEN resolution, T5215).
    """
    try:
        if profile_conn is not None:
            card = resolve_intro_card(intro_card_id, reel_duration, profile_conn, reel_id=reel_id)
        else:
            from app.database import get_db_connection
            with get_db_connection() as conn:
                card = resolve_intro_card(intro_card_id, reel_duration, conn, reel_id=reel_id)
    except Exception as e:
        logger.error(f"[intro_egress] card resolution failed for reel_id={reel_id}: {e}", exc_info=True)
        return None

    if card is None:
        return None

    field_values = _load_field_values(user_id, profile_id)
    shown_fields = card.get("shown_fields") or []
    if shown_fields and not any(field_values.get(f) for f in shown_fields):
        logger.info(
            f"[intro_egress] profile_id={profile_id} has no facts set for card's "
            f"shown_fields={shown_fields!r} (reel_id={reel_id}) -- card will render title-only"
        )

    if mode == "playback":
        try:
            preview_url = _presign_card_image(dict(card))
        except Exception as e:
            logger.error(f"[intro_egress] playback presign failed for reel_id={reel_id}: {e}", exc_info=True)
            return None
        return {
            "card": _card_payload(card),
            "previewUrl": preview_url,
            "field_values": field_values,
            # Minimal framing profile MotionPreview/resolveFraming fall back to
            # when the card's own focal_x/focal_y/zoom are unset (design §5.4) --
            # there is no backend `profiles` framing column to synthesize this
            # from, so an empty object is the honest "no profile-level override"
            # shape; the card's own stored framing is authoritative either way.
            "profile": {},
        }

    # mode == "burn"
    tempdir = tempfile.mkdtemp(prefix="rb_intro_egress_")
    try:
        image_path = _download_card_image(dict(card), user_id, profile_id, tempdir)
    except Exception as e:
        logger.error(f"[intro_egress] card image download failed for reel_id={reel_id}: {e}", exc_info=True)
        import shutil
        shutil.rmtree(tempdir, ignore_errors=True)
        return None

    return IntroSpec(card=dict(card), field_values=field_values, image_path=image_path, tempdir=tempdir)


def _card_payload(card) -> dict:
    """The subset of a card row MotionPreview/resolveFraming/
    useCardPreviewElements already consume (design §5.4): image_key,
    treatment, shown_fields, text_elements, focal_x/y, zoom, duration --
    plus `id`/`name` for identification. `card` may be a sqlite3.Row or a
    plain dict (tests pass dicts directly)."""
    def g(key, default=None):
        try:
            return card[key]
        except (KeyError, IndexError):
            return default

    return {
        "id": g("id"),
        "name": g("name"),
        "image_key": g("image_key"),
        "image_cutout_key": g("image_cutout_key"),
        "treatment": g("treatment"),
        "shown_fields": g("shown_fields") or [],
        "text_elements": g("text_elements") or {},
        "focal_x": g("focal_x"),
        "focal_y": g("focal_y"),
        "zoom": g("zoom"),
        "duration": g("duration"),
    }
