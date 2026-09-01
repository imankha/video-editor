"""v048: Delete sweep-signature orphan raw_clips/ extracts left by the T7600 bug.

T7830 shipped scripts/cleanup_orphan_raw_clips.py as a standalone, human-run
report/--apply tool for cleaning up R2 objects the pre-T7600 expiry sweep
orphaned (the sweep used to mint a fresh random filename and re-upload on every
retried export attempt, leaving 2-3x the storage per affected clip; T7600 fixed
the source). This migration packages the SAME reviewed logic to run through the
normal migration system, applying automatically to a profile as it reaches
schema head. **T5087 (2026-09-01): the bulk admin sweep this docstring
originally described (`POST /api/admin/migrate`) is deleted; `user_db`/
`profile_db` migrate ONLY just-in-time as each account is next touched (no
"admin triggers migrations" step exists anymore).** This is a real behavior
change for THIS migration specifically: it deletes R2 objects to reclaim
storage cost, not to fix data correctness, so an inactive account's orphaned
objects now stay un-reclaimed until that account is next active — see
CLAUDE.md § Migration System, "Long-tail property" exception.

The standalone script still exists and is still useful for a human-readable
dry-run report, and is now also the way to reach accounts that JIT alone may
leave un-swept for a long time; it is not being replaced, only given a
JIT-triggered counterpart for the common case.

Classification logic (is_sweep_orphan_name / classify_objects /
referenced_raw_clip_filenames) is imported from app/services/orphan_raw_clips.py
— the SAME module the standalone script now also imports from (T7830 follow-up
extraction) — so there is exactly ONE reviewed implementation of the
reference-set union and the sweep-signature gate, never a hand-copied second
version drifting out of sync.

DATA SAFETY (read before touching this file):
  - Only objects whose basename matches the sweep writer's `auto_{game}_{clip}
    _{hex}.mp4` naming are ever deletion candidates (is_sweep_orphan_name).
  - An object is a candidate ONLY if its basename is not referenced by EITHER
    raw_clips.filename OR working_clips.uploaded_filename in this profile's DB
    (referenced_raw_clip_filenames) — both columns point into raw_clips/ and
    must be treated as live.
  - Any other unreferenced object (non-`auto_` shape) is left untouched; this
    migration has no interactive confirmation step (unlike the script's --apply
    flow), so safety rests entirely on the sweep-signature gate being exactly
    as narrow as the reviewed script's, plus full logging of every delete for
    audit after the fact. Do not loosen either.
  - This is the FIRST migration to call delete_from_r2 — treat any future copy
    of this pattern with equal care; there is no dry-run step once wired as a
    migration.

Idempotent: a re-run finds no `auto_` objects left unreferenced (they were
deleted, or were never orphaned) and is a no-op. R2_ENABLED-guarded, mirroring
v021 (no-op in local dev without R2 configured). version = 48.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V048CleanupSweepOrphanRawClips(BaseMigration):
    version = 48
    description = "T7830: delete sweep-signature orphan raw_clips/ extracts"

    def up(self, conn) -> None:
        from ...storage import R2_ENABLED

        if not R2_ENABLED:
            logger.info("[v048] R2 disabled; nothing to clean up")
            return

        from ...services.orphan_raw_clips import (
            classify_objects,
            list_raw_clip_objects,
            referenced_raw_clip_filenames,
        )
        from ...storage import delete_from_r2
        from ...user_context import get_current_user_id

        user_id = get_current_user_id()
        if not user_id:
            logger.warning("[v048] no current user_id in context; skipping")
            return

        referenced = referenced_raw_clip_filenames(conn)
        objects = list_raw_clip_objects(user_id)
        sweep_orphans, other_unreferenced = classify_objects(referenced, objects)

        if other_unreferenced:
            logger.info(
                "[v048] %s/<profile>: %d unreferenced non-sweep object(s) left "
                "untouched (report-only, not deleted by this migration): %s",
                user_id[:8], len(other_unreferenced),
                ", ".join(p for p, _ in other_unreferenced),
            )

        if not sweep_orphans:
            logger.info("[v048] %s/<profile>: no sweep-signature orphans found", user_id[:8])
            return

        deleted = 0
        total_bytes = 0
        for rel_path, size in sweep_orphans:
            if delete_from_r2(user_id, rel_path):
                logger.info(
                    "[v048] DELETE %s/<profile> %s (%d bytes)",
                    user_id[:8], rel_path, size,
                )
                deleted += 1
                total_bytes += size
            else:
                logger.error(
                    "[v048] FAILED to delete %s/<profile> %s — leaving for retry",
                    user_id[:8], rel_path,
                )

        logger.info(
            "[v048] %s/<profile>: deleted %d/%d sweep orphan object(s), %d bytes reclaimed",
            user_id[:8], deleted, len(sweep_orphans), total_bytes,
        )
