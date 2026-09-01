"""
v045: Rewrite existing working_clips.segments_data.boundaries rows from
splits-only to the canonical full-list format [0, ...splits, duration]
(T4340).

Background: the gesture path (POST /clips/{id}/actions -> split_segment)
used to persist splits-only boundaries (no leading 0, no trailing duration);
the PUT path (saveCurrentClipState) already persists full-list. segmentSpeeds
is ALWAYS keyed by interval index over the FULL list, so a reader walking a
splits-only row shifts every speed one interval over (Bug 20p). T4340 made
the gesture write path canonicalize at save time (clips.py
_save_clip_framing_data); this migration heals rows written BEFORE that
code shipped.

Duration source: JOINed live from raw_clips (end_time - start_time) --
design docs/plans/tasks/T4340-design.md Sec 2.2 Option B, the SAME source
the write path and every export reader already use. There is no
working_clips.duration column (deliberately not added -- one canonical
datum, no drift risk).

Reuses canonicalize_segments_data (app.highlight_transform) -- the identical
transform the write path and every export reader call -- rather than a
second implementation (design Q2, user-approved).

Row-factory discipline (v017-class prod-crash guard): up(conn) receives
TUPLE rows under the real migration runner's connection -- index
positionally (r[0]), never row['col']. PRAGMA table_info rows are tuples
too (row[1] == column name).

Idempotent: rows already full-list (boundaries[0] <= 0.01) are skipped.
Rows with no raw_duration derivable (orphan/uploaded clips, no raw_clip_id)
are left splits-only and logged -- never guess a duration (CLAUDE.md
no-silent-fallback). Readers keep defensively canonicalizing until the
reader-cleanup follow-up task, so an un-migrated or un-derivable row is no
worse than today.

Applies automatically at the per-user JIT seam on next access (T5083/T5085,
hardened by T8190) -- profile_db migrations no longer require a manual admin
trigger (T5087 deleted the old bulk-sweep endpoint).
"""

import logging

from ...highlight_transform import canonicalize_segments_data
from ...utils.encoding import decode_data, encode_data
from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V045CanonicalizeWorkingClipSegments(BaseMigration):
    version = 45
    description = "Rewrite working_clips.segments_data.boundaries to canonical full-list format (T4340)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_clips'"
        ).fetchone()
        if not has_table:
            return

        rows = conn.execute("""
            SELECT wc.id, wc.segments_data, rc.start_time, rc.end_time
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON rc.id = wc.raw_clip_id
        """).fetchall()

        rewritten = 0
        skipped_orphan = 0
        for row in rows:
            # Tuple row -- positional access only (v017 landmine).
            clip_id = row[0]
            blob = row[1]
            raw_start = row[2]
            raw_end = row[3]

            if not blob:
                continue

            segments_data = decode_data(blob)
            if not segments_data or not segments_data.get('boundaries'):
                continue

            boundaries = segments_data['boundaries']
            if boundaries[0] <= 0.01:
                # Already full-list -- idempotent no-op.
                continue

            if raw_start is None or raw_end is None:
                logger.warning(
                    "[v045] working_clips.id=%s has splits-only boundaries %s "
                    "but no derivable raw_duration (orphan/uploaded clip) -- "
                    "leaving splits-only, not guessing a duration",
                    clip_id, boundaries,
                )
                skipped_orphan += 1
                continue

            raw_duration = raw_end - raw_start
            canonical = canonicalize_segments_data(segments_data, raw_duration)
            conn.execute(
                "UPDATE working_clips SET segments_data = ? WHERE id = ?",
                (encode_data(canonical), clip_id),
            )
            rewritten += 1

        logger.info(
            "[v045] canonicalized %s working_clips row(s), skipped %s orphan row(s) with no raw_duration",
            rewritten, skipped_orphan,
        )
