from ..base import BaseMigration


class V006SplitOverlayQuest(BaseMigration):
    """Reconcile existing users to the overlay-quest split.

    The single overlay quest was bifurcated (quest_config.py):

        OLD                                  NEW
        quest_3 Spotlight Your Player  -->   quest_3 Configure Your Spotlight
          (configure + publish)          +   quest_4 Publish Your Reel

    A user who finished the old bundled overlay flow (old quest_2 "Export
    Highlights", which v005 already used to mark the new quest_3 complete) also
    rendered the overlay, moved the reel to My Reels, and watched it — so the
    new quest_4 (Publish) is legitimately complete for them. Mark it so they
    aren't asked to redo a flow they already did.

    Keyed on old quest_2 (same signal v005 used for quest_3) so the two
    migrations stay consistent. Idempotent. No new credits are granted — the
    bundled old reward already paid out, and the progress endpoint reports
    reward_claimed=True for any completed quest, so no Claim button reappears.
    """

    version = 6
    description = "Mark new quest_4 (Publish) complete for users who did the old bundled overlay flow"

    def up(self, conn) -> None:
        cur = conn.cursor()

        # T11185: completed_quests is dropped at v008 and no longer in the fresh
        # schema, so a DB that lacks it has nothing to reconcile.
        if cur.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='completed_quests'"
        ).fetchone() is None:
            return

        old_q2_completed = cur.execute(
            "SELECT 1 FROM completed_quests WHERE quest_id = 'quest_2'"
        ).fetchone() is not None

        if old_q2_completed:
            cur.execute("INSERT OR IGNORE INTO completed_quests (quest_id) VALUES ('quest_4')")
