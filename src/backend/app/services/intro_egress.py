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

import json
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from app.migrations import MigrationBlocked
from app.services.db_refresh import RefreshFailed
from app.services.intro_cards import resolve_intro_card
from app.services.intro_media import presign_intro_image
from app.services.materialization import open_profile_db_readonly
from app.services.user_db import (
    ensure_user_database_fresh,
    get_all_intro_facts,
    get_all_intro_full_names,
)
from app.storage import download_from_r2_global
from app.utils.encoding import decode_data

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
    per T6620's existing per-slot omission).

    T6860 (round 2): the card ROW is read restore-if-newer (the caller opens it
    via `open_profile_db_readonly` -> `ensure_profile_db_local`), so read the
    FACTS with the SAME freshness -- otherwise a Fly machine holding a stale
    local `user.sqlite` (owner reads are restore-if-ABSENT, so a materialized
    file is never re-pulled) burns an OLD `full_name`/facts into the DOWNLOAD's
    cached card while in-app PLAYBACK, resolved on a different (fresh) machine,
    shows the current name -- the exact "same reel, right card, WRONG athlete
    name at only one egress" divergence this ONE shared seam exists to prevent.
    Restore-if-newer is READ-ONLY (pulls R2's newer copy into the local cache,
    never writes user data / never uploads) and WAL-safe (the sidecar guard in
    `ensure_user_database_fresh` refuses to swap a live-held file). If R2 is
    unreachable we log and fall back to the local copy -- an intro must never
    break a download (epic decision 9)."""
    try:
        ensure_user_database_fresh(user_id)
    except RefreshFailed:
        logger.warning(
            f"[intro_egress] could not confirm user.sqlite is current for "
            f"user_id={user_id}; resolving intro facts from the local copy"
        )
    except MigrationBlocked as e:
        # T5085: ensure_user_database_fresh now runs (and can re-run) the JIT
        # seam and can raise -- this function's contract is "an intro must
        # never break a download" (epic decision 9), same degrade-to-local
        # treatment as RefreshFailed above.
        logger.warning(
            f"[intro_egress] user.sqlite blocked at migration seam ({e.reason}) for "
            f"user_id={user_id}; resolving intro facts from the local copy"
        )
    facts = get_all_intro_facts(user_id).get(profile_id, {})
    full_name = get_all_intro_full_names(user_id).get(profile_id)
    values = dict(facts)
    if full_name:
        values["full_name"] = full_name
    return values


def _download_card_image(card: dict, user_id: str, profile_id: str, tempdir: str) -> str | None:
    """Download the card's image from its GLOBAL R2 key to a local path under
    `tempdir`. Returns None when the card has no photo. Raises on a download
    failure (the caller degrades non-fatally). ONE image rule (T6950):
    `image_key` everywhere — editor preview, playback, and burn must resolve
    the same photo (image_cutout_key is dead; T5200 never shipped)."""
    key = card.get("image_key")
    if not key:
        return None
    ext = Path(key).suffix or ".png"
    local_path = Path(tempdir) / f"card_image{ext}"
    if not download_from_r2_global(key, local_path):
        raise RuntimeError(f"could not download intro card image {key!r} from R2")
    return str(local_path)


def _presign_card_image(card: dict) -> str | None:
    """Presigned URL for the card's image, or None when the card has no photo.
    Never downloads -- for the playback (DOM pre-roll) path. Same ONE image
    rule as `_download_card_image` (T6950): `image_key` only. T6960: uses the
    CACHED presign so replays/reopens hit the browser cache instead of
    re-downloading the photo behind a fresh signature."""
    key = card.get("image_key")
    if not key:
        return None
    return presign_intro_image(key)


def build_intro_playback_payload(card: dict, field_values: dict) -> dict | None:
    """Serialize an already-resolved card + field_values into the
    `{card, previewUrl, field_values, profile}` shape `MotionPreview`/
    `resolveFraming`/`useCardPreviewElements` already consume (design §5.4).

    The ONE place both LIVE playback resolution (this module's own
    `resolve_intro_for_reel(mode="playback")`, single-reel shares) and FROZEN
    playback resolution (`routers/collections.py::resolve_collection_share`,
    which already has its resolved card row and never re-resolves it) build
    this payload, so the two never diverge in shape.

    Non-fatal: returns None on a presign failure, logged.
    """
    try:
        preview_url = _presign_card_image(dict(card))
    except Exception as e:
        logger.error(f"[intro_egress] playback presign failed: {e}", exc_info=True)
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


def resolve_intro_for_reel(
    user_id: str,
    profile_id: str,
    intro_card_id: int | None,
    reel_duration: float | None,
    reel_id: int | None,
    *,
    mode: str = "burn",
    profile_conn=None,
) -> IntroSpec | dict | None:
    """Resolve the LIVE intro attachment for one reel, cross-DB assembled.

    `profile_conn`: an already-open connection to the reel's profile.sqlite
    (the caller's live connection for downloads, or a readonly one it already
    opened for a share). When omitted, this helper opens ITS OWN read-only
    connection via `open_profile_db_readonly(user_id, profile_id)` -- keyed
    on the EXPLICIT `user_id`/`profile_id` arguments, never the ambient
    request's ContextVar, since the share paths resolve the SHARER's profile
    from a request that carries a different (or no) user context. Closed
    before returning either way.

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
    owned_conn = None
    try:
        if profile_conn is not None:
            conn = profile_conn
        else:
            # No caller-supplied connection: open the profile DB explicitly by
            # (user_id, profile_id) -- NEVER the ambient get_db_connection(),
            # which resolves the CURRENT REQUEST's user context and would
            # silently resolve the wrong profile (or raise) for the share
            # paths, which are resolving the SHARER's profile from a request
            # that carries no (or a different) user context. Read-only: this
            # helper never needs to write the resolved profile's data.
            owned_conn = open_profile_db_readonly(user_id, profile_id)
            conn = owned_conn
        card = resolve_intro_card(intro_card_id, reel_duration, conn, reel_id=reel_id)
    except Exception as e:
        logger.error(f"[intro_egress] card resolution failed for reel_id={reel_id}: {e}", exc_info=True)
        return None
    finally:
        if owned_conn is not None:
            owned_conn.close()

    if card is None:
        return None

    card = dict(card)
    # `shown_fields` is stored as a JSON TEXT column (json.dumps on write,
    # routers/intro_cards.py) and `text_elements` as a msgpack BLOB
    # (encode_data on write) -- a REAL `SELECT *` row carries both raw and
    # they must be decoded HERE, once, mirroring routers/intro_cards.py's own
    # serializer exactly, or every consumer downstream (this function's own
    # facts-check below, _card_payload's playback JSON) either silently
    # iterates JSON-string characters instead of field names, or -- for
    # text_elements -- crashes FastAPI's response serialization with a
    # UnicodeDecodeError on the raw msgpack bytes (found live, T5220 QA).
    # Defensive isinstance checks (not unconditional decode): tests construct
    # `card` as a plain dict with these fields ALREADY decoded (a real list /
    # real dict), and re-decoding an already-native value throws TypeError.
    raw_shown_fields = card.get("shown_fields")
    if isinstance(raw_shown_fields, (str, bytes)):
        card["shown_fields"] = json.loads(raw_shown_fields) if raw_shown_fields else []
    else:
        card["shown_fields"] = raw_shown_fields or []

    raw_text_elements = card.get("text_elements")
    if isinstance(raw_text_elements, bytes):
        card["text_elements"] = decode_data(raw_text_elements) or {}
    else:
        card["text_elements"] = raw_text_elements or {}

    field_values = _load_field_values(user_id, profile_id)
    shown_fields = card.get("shown_fields") or []
    if shown_fields and not any(field_values.get(f) for f in shown_fields):
        logger.info(
            f"[intro_egress] profile_id={profile_id} has no facts set for card's "
            f"shown_fields={shown_fields!r} (reel_id={reel_id}) -- card will render title-only"
        )

    if mode == "playback":
        return build_intro_playback_payload(card, field_values)

    # mode == "burn"
    tempdir = tempfile.mkdtemp(prefix="rb_intro_egress_")
    try:
        image_path = _download_card_image(card, user_id, profile_id, tempdir)
    except Exception as e:
        logger.error(f"[intro_egress] card image download failed for reel_id={reel_id}: {e}", exc_info=True)
        import shutil
        shutil.rmtree(tempdir, ignore_errors=True)
        return None

    return IntroSpec(card=dict(card), field_values=field_values, image_path=image_path, tempdir=tempdir)


def _card_payload(card) -> dict:
    """The subset of a card row MotionPreview/resolveFraming/
    useCardPreviewElements already consume (design §5.4): image_key,
    treatment, shown_fields, text_elements, subtitle_text, focal_x/y, zoom,
    duration -- plus `id`/`name` for identification. `card` may be a
    sqlite3.Row or a plain dict (tests pass dicts directly), and its
    `shown_fields`/`text_elements` may be RAW (a fresh `SELECT *` row --
    e.g. `routers/collections.py::_evaluated_share_members`'s frozen
    resolution, which never routes through this module's own
    `resolve_intro_for_reel` normalization) or already-decoded (a caller
    that pre-normalized). Decode defensively at this actual serialization
    boundary rather than trusting every caller to remember to: `shown_fields`
    is `json.dumps`-stored TEXT (routers/intro_cards.py), `text_elements` is
    an `encode_data` msgpack BLOB -- passing either through raw crashed
    FastAPI's response serialization with a UnicodeDecodeError on the raw
    msgpack bytes (found live, T5220 QA, single-reel share path; the
    collection-share path shares this exact function and was equally
    exposed, just not yet hit).

    `subtitle_text` (Reviewer finding, T5220 Stage 4.5): the burn path
    (`player_intro.build_intro_card`) renders it from the full card row, and
    the DOM preview (`introCardPreviewElements.js`) reads `card.subtitle_text`
    directly -- omitting it here would have silently dropped a user-set
    subtitle from every playback surface while still showing it on download,
    exactly the download-vs-playback divergence the "one preview component"
    architecture exists to prevent.
    """
    def g(key, default=None):
        try:
            return card[key]
        except (KeyError, IndexError):
            return default

    shown_fields = g("shown_fields") or []
    if isinstance(shown_fields, (str, bytes)):
        shown_fields = json.loads(shown_fields) if shown_fields else []

    text_elements = g("text_elements") or {}
    if isinstance(text_elements, bytes):
        text_elements = decode_data(text_elements) or {}

    return {
        "id": g("id"),
        "name": g("name"),
        "image_key": g("image_key"),
        "treatment": g("treatment"),
        "shown_fields": shown_fields,
        "text_elements": text_elements,
        "subtitle_text": g("subtitle_text"),
        "focal_x": g("focal_x"),
        "focal_y": g("focal_y"),
        "zoom": g("zoom"),
        "duration": g("duration"),
    }
