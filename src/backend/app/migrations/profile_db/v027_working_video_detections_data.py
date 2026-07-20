"""
v027: Add working_videos.detections_data -- video-level player-detection store (T5600).

Player-detection "tracking squares" used to live ONLY inside each highlight
region's `detections` array within `working_videos.highlights_data`. Deleting
a region (`del highlights[idx]`, overlay.py) destroyed that region's
detections along with its spotlight span, even though tracking is a separate
concern from the spotlight editing UI. `detections_data` decouples the two:
a flat, whole-timeline payload `{videoWidth, videoHeight, fps,
detections:[{timestamp,frame,boxes}]}` that region delete/create never touch
(`/overlay-data` projects a read-time slice per region instead).

BACKFILL: for every already-exported working_video with a NULL
detections_data, hoist the union of its regions' embedded detections up to
the video level (the data still exists in highlights_data today) via the
SAME `hoist_video_detections` helper the `/overlay-data` read-time fallback
uses (`app/services/video_detections.py`) -- one implementation, two callers.
Idempotent (only fills where NULL), best-effort per row: a row whose
highlights_data blob won't decode, or that hoists to nothing (no detections
embedded, or no region carries videoWidth/videoHeight/fps), is logged and
left NULL -- never aborts the run.

Row-factory note (v017 landmine): up(conn) receives a TUPLE row factory --
the backfill SELECT indexes rows positionally (r[0], r[1]), never r['col'].
Tested WITH data (test_t5600_detections_data_migration.py), not just the
empty case.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V027WorkingVideoDetectionsData(BaseMigration):
    version = 27
    description = "Add working_videos.detections_data + backfill from region detections (T5600)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(working_videos)").fetchall()}
        if "detections_data" not in cols:
            conn.execute("ALTER TABLE working_videos ADD COLUMN detections_data BLOB")
            logger.info("[v027] added working_videos.detections_data")

        self._backfill_from_regions(conn)

    def _backfill_from_regions(self, conn) -> None:
        from ...services.video_detections import hoist_video_detections
        from ...utils.encoding import decode_data, encode_data

        rows = conn.execute(
            "SELECT id, highlights_data FROM working_videos "
            "WHERE highlights_data IS NOT NULL AND detections_data IS NULL"
        ).fetchall()

        hoisted = decode_failed = nothing_to_hoist = 0
        for r in rows:
            wv_id, highlights_blob = r[0], r[1]  # TUPLE row factory (v017 landmine)
            try:
                regions = decode_data(highlights_blob)
            except Exception as e:
                logger.warning(f"[v027] working_video {wv_id}: highlights_data decode failed, skipping: {e}")
                decode_failed += 1
                continue

            if not regions:
                nothing_to_hoist += 1
                continue

            video_detections = hoist_video_detections(regions)
            if video_detections is None:
                nothing_to_hoist += 1
                continue

            conn.execute(
                "UPDATE working_videos SET detections_data = ? "
                "WHERE id = ? AND detections_data IS NULL",
                (encode_data(video_detections), wv_id),
            )
            hoisted += 1

        if rows:
            logger.info(
                f"[v027] backfill: {hoisted} hoisted, {nothing_to_hoist} nothing-to-hoist, "
                f"{decode_failed} decode-failed (of {len(rows)} candidates)"
            )
