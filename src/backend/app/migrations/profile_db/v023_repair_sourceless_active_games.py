"""v023: Repair games showing 'active' whose R2 source is absent (bug 27p/29p).

Root cause: two classes of bad state in game_storage:

1. FUTURE expiry + deleted R2 source — the game uploaded fine, got a storage ref
   with a future expiry, but later its R2 source was deleted (another profile's
   ref expired, all grace-period copies deleted) while this profile still had a
   future-expiry ref.  _compute_storage_status sees a future expires_at → 'active'.

2. NO game_storage row at all + deleted R2 source — the 'never-tracked' case
   (e.g. a game whose storage ref was never written due to a prior bug).
   _compute_storage_status(None, None) → 'active' (no ref, no auto_export_status).

Fix: for every game that currently shows 'active', collect its source hashes
(game_videos.blake3_hash for multi-video games, else games.blake3_hash), issue a
direct HEAD for each.  Only a CONFIRMED-absent response (HTTP 404 / NoSuchKey
ClientError) triggers a repair.  Any other error is indeterminate — skip that
game and log a warning (fail visibly, never silently produce wrong results).

Expire rules (per game):
  - ANY source check errored ambiguously → SKIP game entirely; log warning.
  - At least one source CONFIRMED-absent AND no indeterminate errors → expire all
    related game_storage rows (UPDATE existing / INSERT missing).

This is sticky (re-run skips already-past rows), so false positives from transient
errors are NEVER written.

Row-factory note: the migration runner hands up(conn) a PLAIN sqlite3 connection
(default tuple row factory).  Index all rows POSITIONALLY (r[0], r[1] …) — string
key access raises TypeError on prod (T4110 class of bug).  Tests reproduce this
exact environment: sqlite3.connect() with no row_factory override.

Idempotent: re-running finds no 'active' games with missing sources (already past).
"""

import logging
from datetime import datetime

from app.storage import R2_BUCKET, get_r2_client

from ..base import BaseMigration

logger = logging.getLogger(__name__)

# Well in the past — any fromisoformat parse returns an expired datetime.
_PAST_SENTINEL = "2000-01-01T00:00:00+00:00"

# Sentinel values returned by _check_source.
_PRESENT = "present"
_ABSENT = "absent"   # Confirmed 404 / NoSuchKey
_ERROR = "error"     # Indeterminate — do not act on this


def _compute_status(expires_at_val, auto_export_status) -> str:
    """Mirror of games.py:_compute_storage_status (kept local to avoid import)."""
    if expires_at_val:
        try:
            exp_dt = (
                expires_at_val
                if isinstance(expires_at_val, datetime)
                else datetime.fromisoformat(expires_at_val)
            )
            return "expired" if exp_dt.replace(tzinfo=None) < datetime.utcnow() else "active"
        except (ValueError, TypeError):
            return "active"
    if auto_export_status:
        return "expired"
    return "active"


def _check_source(client, key: str) -> str:
    """HEAD one R2 key and classify the result.

    Returns:
        _PRESENT  — object confirmed present (HEAD succeeded)
        _ABSENT   — object confirmed absent (HTTP 404 / NoSuchKey ClientError)
        _ERROR    — indeterminate: transient error, throttle, permission, network, etc.

    Never returns _ABSENT on ambiguous failures; callers must treat _ERROR as
    "skip, do not expire" to prevent false-positive expirations.
    """
    try:
        client.head_object(Bucket=R2_BUCKET, Key=key)
        return _PRESENT
    except Exception as exc:
        # Detect a confirmed-absent response from a botocore ClientError.
        # HEAD on a missing S3/R2 key raises ClientError with Code "404" or "NoSuchKey".
        try:
            code = exc.response["Error"]["Code"]  # type: ignore[attr-defined]
            if code in ("404", "NoSuchKey"):
                return _ABSENT
        except (AttributeError, KeyError, TypeError):
            pass
        logger.warning(
            "[v023] R2 HEAD %r returned indeterminate error — skipping: %r", key, exc
        )
        return _ERROR


class V023RepairSourcelessActiveGames(BaseMigration):
    version = 23
    description = (
        "Repair games showing 'active' whose R2 source is absent (bug 27p/29p)"
    )

    def up(self, conn) -> None:
        cursor = conn.cursor()

        # Guard: required tables — absent on fresh / empty profile DBs.
        # Check tables BEFORE R2 to avoid unnecessary client initialisation.
        tables = {
            r[0]
            for r in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if not {"games", "game_storage"} <= tables:
            logger.info("[v023] games/game_storage absent; nothing to repair")
            return

        # Guard: R2 must be configured — never mass-expire when R2 is unavailable.
        client = get_r2_client()
        if not client:
            logger.info("[v023] R2 not configured; skipping source checks")
            return

        has_game_videos = "game_videos" in tables

        # Load existing storage expiries (positional: 0=blake3_hash, 1=expires_at).
        storage_rows = cursor.execute(
            "SELECT blake3_hash, storage_expires_at FROM game_storage"
        ).fetchall()
        expiry_by_hash: dict[str, str] = {r[0]: r[1] for r in storage_rows}

        # Load all games (positional: 0=id, 1=blake3_hash, 2=auto_export_status).
        games = cursor.execute(
            "SELECT id, blake3_hash, auto_export_status FROM games"
        ).fetchall()

        if not games:
            logger.info("[v023] no games; nothing to repair")
            return

        repaired = 0

        for game_row in games:
            game_id = game_row[0]
            game_blake3_hash = game_row[1]  # may be None for multi-video games
            auto_export_status = game_row[2]

            # Compute current storage status (mirroring list_games / load_game).
            expires_at_val = expiry_by_hash.get(game_blake3_hash)
            storage_status = _compute_status(expires_at_val, auto_export_status)

            if storage_status != "active":
                continue  # Already known expired; skip R2 check.

            # Collect source hashes: game_videos rows if present, else games.blake3_hash.
            source_hashes: list[str] = []
            if has_game_videos:
                video_rows = cursor.execute(
                    "SELECT blake3_hash FROM game_videos "
                    "WHERE game_id = ? AND blake3_hash IS NOT NULL",
                    (game_id,),
                ).fetchall()
                source_hashes = [r[0] for r in video_rows]

            if not source_hashes and game_blake3_hash:
                source_hashes = [game_blake3_hash]

            if not source_hashes:
                continue  # No trackable source; skip.

            # Check R2 for each source, distinguishing 404 from other errors.
            #
            # Rules (per game):
            #   _ERROR on any source  → skip the whole game (do NOT expire).
            #   _ABSENT on any source → expire (once all checks pass cleanly).
            #   All _PRESENT          → no repair needed.
            any_absent = False
            skip_game = False
            for h in source_hashes:
                result = _check_source(client, f"games/{h}.mp4")
                if result == _ERROR:
                    skip_game = True
                    break  # No point checking more — we will skip this game.
                if result == _ABSENT:
                    any_absent = True
                # _PRESENT: continue checking remaining sources.

            if skip_game:
                logger.warning(
                    "[v023] skipping game_id=%s — indeterminate R2 check", game_id
                )
                continue

            if not any_absent:
                continue  # All sources present; no repair needed.

            # Force expired for all relevant game_storage rows.
            # Primary: the row that list_games/load_game reads (keyed by games.blake3_hash).
            if game_blake3_hash:
                if game_blake3_hash in expiry_by_hash:
                    cursor.execute(
                        "UPDATE game_storage SET storage_expires_at = ? "
                        "WHERE blake3_hash = ?",
                        (_PAST_SENTINEL, game_blake3_hash),
                    )
                else:
                    # Never-tracked case: INSERT a past-expiry sentinel row so
                    # _compute_storage_status can see the expiry and return 'expired'.
                    cursor.execute(
                        "INSERT OR IGNORE INTO game_storage "
                        "(blake3_hash, game_size_bytes, storage_expires_at) "
                        "VALUES (?, 0, ?)",
                        (game_blake3_hash, _PAST_SENTINEL),
                    )
                expiry_by_hash[game_blake3_hash] = _PAST_SENTINEL  # update local cache

            # Secondary: also expire any game_videos hash rows in game_storage.
            # This ensures the sweep's Phase 1 picks them up for multi-video games
            # (whose games.blake3_hash is null and list_games uses auto_export_status
            # to derive 'expired' only after sweep runs auto_export_game).
            for h in source_hashes:
                if h != game_blake3_hash and h in expiry_by_hash:
                    cursor.execute(
                        "UPDATE game_storage SET storage_expires_at = ? "
                        "WHERE blake3_hash = ?",
                        (_PAST_SENTINEL, h),
                    )
                    expiry_by_hash[h] = _PAST_SENTINEL

            repaired += 1

        conn.commit()

        from app.profile_context import get_current_profile_id
        from app.user_context import get_current_user_id
        try:
            uid = get_current_user_id()[:8]
            pid = get_current_profile_id()[:8]
        except Exception:
            uid = pid = "?"

        logger.info(
            "[v023] repaired %d game(s) with absent R2 source user=%s profile=%s",
            repaired, uid, pid,
        )
