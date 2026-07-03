"""v019: Heal sweep stream-copy reel metadata (aspect_ratio + fallback names).

The game-expiry sweep (auto_export._export_brilliant_clip) published raw
1920x1080 stream-copy reels as `final_videos` rows with `source_type='brilliant_clip'`
and filenames `auto_{game_id}_{clip_id}_{hex}.mp4`, but with wrong stored metadata:

  - `aspect_ratio='9:16'` while the files are 16:9 game footage. A stream copy
    always carries the source-video ratio, so the stored 9:16 is simply wrong and
    the clip is served (mis-scaled) into the 9:16 ranking game and collections.
  - when the source clip was unnamed, a `Clip N` fallback name instead of a real
    derived one (e.g. fv 20 on sarkarati prod = "Clip 5").

Root cause is fixed code-side in the companion T4160; this migration heals rows
already written. Generic across all profile DBs -- any user may hold sweep
artifacts. No R2/ffprobe: the `auto_` filename prefix uniquely marks the
stream-copy path, so 16:9 can be asserted from the prefix alone.

Idempotent: the aspect_ratio UPDATE is gated on `aspect_ratio='9:16'` so a re-run
matches nothing; the name derivation only touches NULL/empty/`Clip N` fallback
names, so once a real name is written the row no longer qualifies. User renames
(anything not matching the fallback pattern) are never touched -- frozen-names rule.
"""

import logging
import re

from ..base import BaseMigration

logger = logging.getLogger(__name__)

# The exact fallback the annotation UI assigns to an unnamed clip: "Clip <n>".
_FALLBACK_NAME_RE = re.compile(r"^Clip \d+$")


class V019HealSweepReelMetadata(BaseMigration):
    version = 19
    description = "T4170: heal sweep reel metadata (aspect_ratio 9:16->16:9 + derive fallback names)"

    def up(self, conn) -> None:
        # Guard: required tables may be absent on a fresh/empty profile DB.
        for table in ("final_videos", "raw_clips"):
            if not conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone():
                return

        # 1. aspect_ratio heal. `_` is a LIKE wildcard, so escape it: only a literal
        # `auto_` prefix (the stream-copy path) may match, never `automatic...`.
        cur = conn.execute(
            r"""
            UPDATE final_videos
            SET aspect_ratio = '16:9'
            WHERE source_type = 'brilliant_clip'
              AND filename LIKE 'auto\_%' ESCAPE '\'
              AND aspect_ratio = '9:16'
            """
        )
        if cur.rowcount:
            logger.info(f"[v019] flipped aspect_ratio 9:16->16:9 on {cur.rowcount} sweep reel(s)")

        # 2. Name derivation for fallback-named sweep rows. The JOIN drops rows whose
        # source raw_clip is gone (name kept as-is). GLOB is a broad SQL pre-filter;
        # the strict regex below is the authority on the fallback pattern.
        #
        # The runner hands up(conn) a TUPLE row factory, not sqlite3.Row -- read
        # every column positionally (r[0], r[1], ...), never by name.
        from ...queries import derive_clip_name
        from ...utils.encoding import decode_data

        rows = conn.execute(
            r"""
            SELECT fv.id, fv.name, rc.name, rc.rating, rc.tags, rc.notes
            FROM final_videos fv
            JOIN raw_clips rc ON rc.id = fv.source_clip_id
            WHERE fv.source_type = 'brilliant_clip'
              AND fv.filename LIKE 'auto\_%' ESCAPE '\'
              AND (fv.name IS NULL OR fv.name = '' OR fv.name GLOB 'Clip [0-9]*')
            """
        ).fetchall()

        renamed = 0
        for fv_id, fv_name, rc_name, rc_rating, rc_tags, rc_notes in rows:
            # A non-empty name must strictly match "Clip <n>" to be treated as the
            # fallback; GLOB can over-match (e.g. "Clip 5 final"), so confirm here.
            if fv_name and not _FALLBACK_NAME_RE.match(fv_name):
                continue
            tags = decode_data(rc_tags) or []
            derived = derive_clip_name(rc_name, rc_rating or 0, tags, rc_notes or "")
            if derived and derived != fv_name:
                conn.execute(
                    "UPDATE final_videos SET name = ? WHERE id = ?",
                    (derived, fv_id),
                )
                renamed += 1

        if renamed:
            logger.info(f"[v019] derived names for {renamed} fallback-named sweep reel(s)")
