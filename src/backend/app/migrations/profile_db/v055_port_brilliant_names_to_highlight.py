"""v055: Port persisted "Brilliant ..." derived names to "Highlight ..." (T11110).

T11110 renamed the 5-star adjective shown in the UI from "Brilliant" to
"Highlight" (the 5-star rating is the gesture that makes a highlight). The rating
itself is an integer, so no rating data needs migrating -- but the DERIVED name
was persisted at creation for two stores, so old auto-created highlights still
read "Brilliant Goal" on disk. Owner ruling H10 (2026-09-24): "port previous
brilliants to highlight."

We rewrite ONLY names whose origin is PROVABLE as the old rating-5 derived form,
never a name the user could have typed:

  - projects: `is_auto_created = 1`, the linked raw_clip (raw_clips.auto_project_id
    = projects.id) has an empty/NULL name (so the project name was derived, not
    copied from a stored clip name), and `projects.name` equals exactly
    "Brilliant " + tag_part(rc.tags) using the SAME join logic as
    queries.derive_clip_name (queries.py:56-59).
  - final_videos: same test through `source_clip_id`, only
    `source_type = 'brilliant_clip'`, the linked raw_clip has an empty/NULL name,
    and `final_videos.name` equals exactly the old derived form.

Deliberately LEFT ALONE (cannot prove origin, or ruled out of scope):
  - `raw_clips.name` (the upload-modal auto-fill looks identical to a typed name),
    collection names, Postgres share titles, R2 archives -- QB1/QB2, owner
    2026-09-24.
  - Notes-derived names (no adjective, so they never match "Brilliant ...").
  - A clip whose tags changed after creation (the exact-name test won't match --
    accepted: origin unprovable).

The old adjective is FROZEN as a literal here ("Brilliant"); we must NOT import
the live constant (RATING_ADJECTIVES / get_rating_adjective), which now returns
"Highlight" and would make this migration a no-op the moment it ships.

Idempotent: after a rewrite the name reads "Highlight ..." and no longer matches
"Brilliant " + tag_part, so a re-run matches nothing.

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so every row is indexed POSITIONALLY (``row[0]``), never by
column name.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)

# Frozen at this migration's authorship. NEVER import the live adjective: it now
# says "Highlight", which would make the "Brilliant " prefix below never match.
_OLD_ADJECTIVE = "Brilliant"
_NEW_ADJECTIVE = "Highlight"


def _tag_part(tags) -> str:
    """The tag portion of a derived name, matching queries.derive_clip_name
    (queries.py:56-59) exactly. Returns '' when there are no tags (such a clip
    never produced an adjective-prefixed derived name)."""
    if not tags:
        return ""
    if len(tags) == 1:
        return tags[0]
    return ", ".join(tags[:-1]) + " and " + tags[-1]


class V055PortBrilliantNamesToHighlight(BaseMigration):
    version = 55
    description = "T11110: port persisted 'Brilliant ...' derived names to 'Highlight ...'"

    def up(self, conn) -> None:
        # decode_data imported lazily (mirrors v019) so the migration module has
        # no import-time dependency on app internals beyond BaseMigration.
        from ...utils.encoding import decode_data

        def _has_table(name: str) -> bool:
            return conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (name,),
            ).fetchone() is not None

        if not _has_table("raw_clips"):
            return

        def _new_name(old_name: str, tags_blob) -> str | None:
            """Return the ported name IFF `old_name` is exactly the old rating-5
            derived form for `tags_blob`, else None (leave the row untouched)."""
            if not old_name or not old_name.startswith(_OLD_ADJECTIVE + " "):
                return None
            tags = decode_data(tags_blob) or []
            tag_part = _tag_part(tags)
            if not tag_part:
                return None
            if old_name != f"{_OLD_ADJECTIVE} {tag_part}":
                return None
            return f"{_NEW_ADJECTIVE} {tag_part}"

        # --- projects -------------------------------------------------------
        # Link is raw_clips.auto_project_id -> projects.id. The provenance filter
        # requires the linked raw_clip's stored name to be empty/NULL, so the
        # project name can only have come from rating+tags derivation.
        if _has_table("projects"):
            rows = conn.execute(
                """
                SELECT p.id, p.name, rc.tags
                FROM projects p
                JOIN raw_clips rc ON rc.auto_project_id = p.id
                WHERE p.is_auto_created = 1
                  AND (rc.name IS NULL OR rc.name = '')
                """
            ).fetchall()
            renamed = 0
            for p_id, p_name, tags_blob in rows:
                new_name = _new_name(p_name, tags_blob)
                if new_name is not None:
                    conn.execute(
                        "UPDATE projects SET name = ? WHERE id = ?",
                        (new_name, p_id),
                    )
                    renamed += 1
            if renamed:
                logger.info(f"[v055] ported {renamed} auto-project name(s) Brilliant -> Highlight")

        # --- final_videos ---------------------------------------------------
        if _has_table("final_videos"):
            rows = conn.execute(
                """
                SELECT fv.id, fv.name, rc.tags
                FROM final_videos fv
                JOIN raw_clips rc ON rc.id = fv.source_clip_id
                WHERE fv.source_type = 'brilliant_clip'
                  AND (rc.name IS NULL OR rc.name = '')
                """
            ).fetchall()
            renamed = 0
            for fv_id, fv_name, tags_blob in rows:
                new_name = _new_name(fv_name, tags_blob)
                if new_name is not None:
                    conn.execute(
                        "UPDATE final_videos SET name = ? WHERE id = ?",
                        (new_name, fv_id),
                    )
                    renamed += 1
            if renamed:
                logger.info(f"[v055] ported {renamed} final_video name(s) Brilliant -> Highlight")
