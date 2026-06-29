import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)

# T4110: imankh@gmail.com — the ONLY account with the stranded reel.
_TARGET_USER_ID = "3ed03fb5-949d-4cfd-b708-0c758ea68ef3"

# The exact stranded row (prod ground truth, project 41 / final 36). This tuple is
# globally unique: no other user's profile.sqlite contains a final_videos row with
# this (id, project_id, version, filename), so the heal is a strict no-op
# everywhere else — even without the user_id gate below.
_FINAL_ID = 36
_PROJECT_ID = 41
_VERSION = 1
_FILENAME = "final_41_997d773b.mp4"


class V018HealLostPublishProj41(BaseMigration):
    """T4110: re-publish + archive imankh's project 41, whose "Move to My Reels"
    was lost to a pre-T4050 fire-and-forget publish (published_at + archived_at
    were committed locally but never reached R2, then a machine cycle reverted them).

    This is a TARGETED one-row repair, NOT a general heal. The stranded signature
    (project not archived + latest final unpublished) is indistinguishable from a
    normal unpublished draft or a mid-edit restored project — Step-1 confirmed this —
    so any broad predicate would either miss project 41 or wrongly publish real
    drafts. We therefore match one exact (id, project_id, version, filename) tuple.

    Mirrors publish_to_my_reels (downloads.py): set published_at on the latest final,
    then archive_project() (uploads archive/{id}.msgpack to R2, removes working data,
    sets projects.archived_at).

    Idempotent: gated on published_at IS NULL, so a re-run finds nothing. The runner
    also bumps PRAGMA user_version, so it only executes once per DB regardless.
    Strict no-op for every other user/DB: the UPDATE/archive are gated behind the
    exact-row match, which no one else has.
    """

    version = 18
    description = "T4110: re-publish+archive stranded reel (imankh project 41 / final 36)"

    def up(self, conn) -> None:
        # Guard: required tables may not exist on a brand-new/empty profile DB.
        for table in ("final_videos", "projects"):
            if not conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone():
                return

        # Exact-signature + stranded-state match. The filename tuple is the safety
        # discriminator; published_at IS NULL / archived_at IS NULL make it a no-op
        # on an already-healed (or never-stranded) DB.
        match = conn.execute(
            """
            SELECT fv.id
            FROM final_videos fv
            JOIN projects p ON p.id = fv.project_id
            WHERE fv.id = ? AND fv.project_id = ? AND fv.version = ?
              AND fv.filename = ? AND fv.published_at IS NULL
              AND p.archived_at IS NULL
            """,
            (_FINAL_ID, _PROJECT_ID, _VERSION, _FILENAME),
        ).fetchone()
        if not match:
            return

        # Belt-and-suspenders: confirm this is imankh's DB when the runner exposes
        # the user (it sets the context var before running). The filename tuple is
        # the real guard; this just refuses the (impossible) cross-user case loudly.
        from ...user_context import get_current_user_id
        user_id = get_current_user_id()
        if user_id and user_id != _TARGET_USER_ID:
            logger.warning(
                f"[Migration v018] exact signature matched under unexpected user={user_id}; "
                f"skipping (expected {_TARGET_USER_ID})"
            )
            return

        # Mirror publish_to_my_reels: set published_at on the final, commit so the
        # separate archive connection sees it, then archive the project.
        conn.execute(
            "UPDATE final_videos SET published_at = CURRENT_TIMESTAMP, watched_at = NULL WHERE id = ?",
            (_FINAL_ID,),
        )
        conn.commit()

        from ...services.project_archive import archive_project
        archived = archive_project(_PROJECT_ID, user_id)
        logger.info(
            f"[Migration v018] healed stranded reel: final={_FINAL_ID} project={_PROJECT_ID} "
            f"user={user_id} -> republished, archived={archived}"
        )
