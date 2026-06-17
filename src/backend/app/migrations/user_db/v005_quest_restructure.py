from ..base import BaseMigration


class V005QuestRestructure(BaseMigration):
    """T3700: reconcile existing users to the Framing/Overlay quest split.

    The quest set was restructured (quest_config.py):

        OLD                                  NEW
        quest_1 Get Started            ==    quest_1 Get Started        (unchanged)
        quest_2 Export Highlights      -->   quest_2 Frame Your Highlight
          (framing AND overlay)          +   quest_3 Spotlight Your Player
        quest_3 Annotate More Clips    -->   (removed)

    Old quest_2 bundled framing + overlay, which is now split into the new quest_2
    (Frame) and quest_3 (Spotlight). So a user who completed old quest_2 has also
    satisfied the new quest_3 — mark it complete so they aren't asked to redo the
    overlay flow they already did.

    The old "Annotate More Clips" quest_3 was removed (it just repeated the flow).
    Its completed_quests entry, if present, coincides with the new quest_3 id and is
    harmless — any user who finished old quest_3 also finished old quest_2 (sequential),
    so the new quest_3 (Spotlight) is legitimately complete for them either way.

    Idempotent. No new credits are granted (the bundled old quest_2 reward already
    paid the user); the progress endpoint reports reward_claimed=True for any
    completed quest, so no Claim button reappears.
    """

    version = 5
    description = "T3700: mark new quest_3 (Spotlight) complete for users who did the old bundled quest_2"

    def up(self, conn) -> None:
        cur = conn.cursor()

        old_q2_completed = cur.execute(
            "SELECT 1 FROM completed_quests WHERE quest_id = 'quest_2'"
        ).fetchone() is not None

        # Old quest_2 (Export Highlights) also satisfied the new overlay quest_3
        # (Spotlight Your Player). Mark quest_3 complete; no credit row.
        if old_q2_completed:
            cur.execute("INSERT OR IGNORE INTO completed_quests (quest_id) VALUES ('quest_3')")
