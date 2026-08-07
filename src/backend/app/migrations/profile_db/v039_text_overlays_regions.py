"""
v039: text_overlays: flat per-block records -> REGIONS containing ELEMENTS (T6630 round 4).

Verified 2026-08-07: master profile_db head is v036
(v036_null_dead_intro_card_title_text.py). Two sibling branches already claim
the next two numbers -- feature/T5215-intro-attachment claims v037
(v037_intro_min_duration.py), feature/T6640-cards-cannot-be-ugly claims v038
(v038_null_dead_intro_card_text_elements.py) -- so this migration takes v039.
The runner only applies versions GREATER than the DB's current user_version, so
a duplicate/lower number would be silently skipped (the T6340 class of bug);
RE-VERIFY this against master at merge time, since these three branches may
land in any order.

MODEL REFRAME (T6630 round 4, user direction 2026-08-07): "Adding a text
element is not adding a text region. A text region can have multiple text
elements." A REGION is a time span (startTime, endTime); it CONTAINS N
elements, each with its own TextSpec, that all render SIMULTANEOUSLY during
the region's span. Before this migration, `working_videos.text_overlays` was
a flat list of standalone blocks -- one block = one time span = one element --
so two "elements" added at different times could never render together (the
literal bug report: "only the second one showed up").

TRANSFORM: each existing flat block

    {id, spec, startTime, endTime, enabled}

becomes a region with EXACTLY ONE element:

    {id, startTime, endTime, elements: [{id, spec, enabled}]}

The REGION keeps the block's OLD id (any stored/cached reference to that id --
e.g. a client mid-drag, an in-flight action queued before reload -- keeps
pointing at the same timeline entity). The ELEMENT gets a freshly DERIVED id
(f"{region_id}_el0") since "element" is a brand-new addressable unit that
never existed before this migration; there is no prior id to preserve.

No other data changes: spec/startTime/endTime/enabled values are carried over
verbatim, nothing is recomputed, nothing is dropped.

Idempotent: a working_video whose text_overlays already look like the new
shape (every item already has an "elements" key) is left untouched, so
re-running this migration (or a retried admin migrate call) is a no-op the
second time. Best-effort per row, matching v027's backfill discipline: a row
whose text_overlays blob won't decode is logged and skipped, never aborts the
run for other rows/other users.

Schema: this is NOT a column change (text_overlays stays the same BLOB column)
-- only the JSON/msgpack shape INSIDE that blob changes. Guarded by a
`PRAGMA table_info` column-existence check anyway: `text_overlays` was added
directly in ensure_database()'s fresh CREATE TABLE (never through a versioned
migration, see backend-services.md), so a pre-T5225 DB has no such column at
all -- this migration is a true no-op for that DB, exactly like every other
read/write site already assumes.

Row-factory note (v017/v027 landmine): up(conn) receives a TUPLE row factory,
never sqlite3.Row -- rows are indexed positionally (row[0], row[1]).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V039TextOverlaysRegions(BaseMigration):
    version = 39
    description = "Migrate working_videos.text_overlays: flat blocks -> regions containing elements (T6630 round 4)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name), v017 landmine.
        cols = {row[1] for row in conn.execute("PRAGMA table_info(working_videos)").fetchall()}
        if "text_overlays" not in cols:
            return

        self._migrate_rows(conn)

    def _migrate_rows(self, conn) -> None:
        from ...utils.encoding import decode_data, encode_data

        rows = conn.execute(
            "SELECT id, text_overlays FROM working_videos WHERE text_overlays IS NOT NULL"
        ).fetchall()

        migrated = already_new = decode_failed = empty = 0
        for r in rows:
            wv_id, blob = r[0], r[1]  # TUPLE row factory (v017 landmine)
            try:
                items = decode_data(blob)
            except Exception as e:
                logger.warning(f"[v039] working_video {wv_id}: text_overlays decode failed, skipping: {e}")
                decode_failed += 1
                continue

            if not items:
                empty += 1
                continue

            if all(isinstance(it, dict) and "elements" in it for it in items):
                already_new += 1
                continue

            regions = []
            for block in items:
                if isinstance(block, dict) and "elements" in block:
                    # Defensive: don't drop a record already in the new shape
                    # if a row somehow mixes old and new items.
                    regions.append(block)
                    continue
                region_id = block["id"]
                regions.append({
                    "id": region_id,
                    "startTime": block["startTime"],
                    "endTime": block["endTime"],
                    "elements": [{
                        "id": f"{region_id}_el0",
                        "spec": block["spec"],
                        "enabled": block.get("enabled", True),
                    }],
                })

            conn.execute(
                "UPDATE working_videos SET text_overlays = ? WHERE id = ?",
                (encode_data(regions), wv_id),
            )
            migrated += 1

        if rows:
            logger.info(
                f"[v039] text_overlays: {migrated} migrated, {already_new} already new-shape, "
                f"{empty} empty, {decode_failed} decode-failed (of {len(rows)} candidates)"
            )
