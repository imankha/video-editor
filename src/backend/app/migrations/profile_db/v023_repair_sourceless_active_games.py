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
(game_videos.blake3_hash for multi-video games, else games.blake3_hash), issue an
R2 head_object for each.  If any source is absent:
  - UPDATE game_storage SET storage_expires_at = <past sentinel> for known rows.
  - INSERT a past-expiry row for game_storage rows that don't exist yet (case 2).

The past sentinel is 2000-01-01T00:00:00 — well before any real upload.

Row-factory note: the migration runner hands up(conn) a PLAIN sqlite3 connection
(default tuple row factory).  Index all rows POSITIONALLY (r[0], r[1] …) — string
key access raises TypeError on prod (T4110 class of bug).  Tests reproduce this
exact environment: sqlite3.connect() with no row_factory override.

Idempotent: re-running finds no 'active' games with missing sources (already past).
"""

import logging
from datetime import datetime, timezone

from ..base import BaseMigration
from app.storage import r2_head_object_global

logger = logging.getLogger(__name__)

# Well in the past — any fromisoformat parse returns an expired datetime.
_PAST_SENTINEL = "2000-01-01T00:00:00+00:00"


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


class V023RepairSourcelessActiveGames(BaseMigration):
    version = 23
    description = (
        "Repair games showing 'active' whose R2 source is absent (bug 27p/29p)"
    )

    def up(self, conn) -> None:
        cursor = conn.cursor()

        # Guard: required tables — absent on fresh / empty profile DBs.
        tables = {
            r[0]
            for r in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if not {"games", "game_storage"} <= tables:
            logger.info("[v023] games/game_storage absent; nothing to repair")
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

            # Check R2 for each source — any missing → force expired.
            any_missing = False
            for h in source_hashes:
                result = r2_head_object_global(f"games/{h}.mp4")
                if result is None:
                    any_missing = True
                    break

            if not any_missing:
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

        from app.user_context import get_current_user_id
        from app.profile_context import get_current_profile_id
        try:
            uid = get_current_user_id()[:8]
            pid = get_current_profile_id()[:8]
        except Exception:
            uid = pid = "?"

        logger.info(
            f"[v023] repaired {repaired} game(s) with absent R2 source "
            f"user={uid} profile={pid}"
        )
