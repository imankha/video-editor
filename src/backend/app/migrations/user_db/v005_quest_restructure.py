from ..base import BaseMigration


class V005QuestRestructure(BaseMigration):
    """T3700: reconcile existing users to the Framing/Overlay quest split.

    The quest set was restructured (quest_config.py):

        OLD                                  NEW
        quest_1 Get Started            ==    quest_1 Get Started        (unchanged)
        quest_2 Export Highlights      -->   quest_2 Frame Your Highlight
          (framing AND overlay)          +   quest_3 Spotlight Your Player
        quest_3 Annotate More Clips    ==    quest_4 Make More Highlights (same content)

    Quest IDs are reused with different content, so claimed/completed state stored
    by id (completed_quests, credit_transactions.reference_id) would land on the
    wrong new quest. This migration rekeys that state so existing users land
    correctly. App code never branches on legacy data — the data is migrated.

    Idempotent: safe to run more than once.

    Credits: no new credits are granted. Old quest_2 already paid the user for the
    bundled framing+overlay work, so the carried-over new quest_3 (Spotlight) is
    marked complete with no credit row. The progress endpoint reports
    reward_claimed=True for any completed quest, so no Claim button reappears.
    """

    version = 5
    description = "T3700: rekey completed/claimed quest state for the Framing/Overlay quest split"

    def up(self, conn) -> None:
        cur = conn.cursor()

        def is_completed(qid: str) -> bool:
            return cur.execute(
                "SELECT 1 FROM completed_quests WHERE quest_id = ?", (qid,)
            ).fetchone() is not None

        def is_claimed(qid: str) -> bool:
            return cur.execute(
                "SELECT 1 FROM credit_transactions WHERE source = 'quest_reward' AND reference_id = ?",
                (qid,),
            ).fetchone() is not None

        # Snapshot the OLD state before mutating.
        old_q2_completed = is_completed("quest_2")  # old "Export Highlights" (framing + overlay)
        old_q3_completed = is_completed("quest_3")  # old "Annotate More Clips"
        old_q3_claimed = is_claimed("quest_3")

        # 1) Old quest_3 (Annotate More) == new quest_4 (same content). Move it FIRST
        #    so the quest_3 id is freed for the new Spotlight quest.
        if old_q3_completed:
            if is_completed("quest_4"):
                cur.execute("DELETE FROM completed_quests WHERE quest_id = 'quest_3'")
            else:
                cur.execute("UPDATE completed_quests SET quest_id = 'quest_4' WHERE quest_id = 'quest_3'")
        if old_q3_claimed:
            # The idempotency index is UNIQUE(user_id, source, reference_id); if quest_4
            # is somehow already claimed, drop the old row instead of colliding.
            if is_claimed("quest_4"):
                cur.execute(
                    "DELETE FROM credit_transactions WHERE source = 'quest_reward' AND reference_id = 'quest_3'"
                )
            else:
                cur.execute(
                    "UPDATE credit_transactions SET reference_id = 'quest_4' "
                    "WHERE source = 'quest_reward' AND reference_id = 'quest_3'"
                )

        # 2) Old quest_2 (Export Highlights) also satisfied the new overlay quest_3
        #    (Spotlight Your Player). Mark quest_3 complete; no credit row (already
        #    paid via old quest_2 — no double-grant).
        if old_q2_completed:
            cur.execute("INSERT OR IGNORE INTO completed_quests (quest_id) VALUES ('quest_3')")
