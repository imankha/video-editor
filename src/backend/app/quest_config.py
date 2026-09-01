"""
Quest Configuration — single source of truth for quest definitions (T1000, T3700).

All quest IDs, step IDs, titles, and rewards live here. Both quests.py and
admin.py import from this module. The frontend fetches definitions via
GET /api/quests/definitions.

T3700: Framing and Overlay are split into separate quests and each is decomposed
into small, individually-triggered steps so per-step drop-off is measurable. Every
step completes via a hard trigger (a derived DB condition or a recorded achievement
event); there are no optional/skippable steps.

T8120: per-quest credit rewards are RETIRED. The full quest-chain credit total is
granted UPFRONT (at signup for new users, as a remainder on next login for existing
mid-quest users) via credit_ledger.grant_quest_chain_credits, so the quests no
longer drip credits on claim. `reward` is 0 on every quest (claim grants nothing);
QUEST_CHAIN_CREDIT_TOTAL below is the single source of truth for the upfront amount
and is deliberately the historical sum of what the four quests used to award
(15+25+25+15), NOT derived from the now-zeroed `reward` fields.
"""

# T8120: the upfront credit grant. Kept as an explicit constant (not summed from
# the zeroed `reward` fields) so retiring the drip did not silently zero the grant.
QUEST_CHAIN_CREDIT_TOTAL = 80

QUEST_DEFINITIONS = [
    {
        "id": "quest_1",
        "title": "Get Started",
        "reward": 0,  # T8120: retired — credits granted upfront (QUEST_CHAIN_CREDIT_TOTAL)
        "step_ids": [
            "watch_annotate_tutorial",
            "upload_game",
            "add_clip",
            "rate_clip",
            "annotate_brilliant",
            "playback_annotations",
        ],
    },
    {
        "id": "quest_2",
        "title": "Frame Your Highlight",
        "reward": 0,  # T8120: retired — credits granted upfront
        "step_ids": [
            # T5195: guide the first-run user back to the home (games) screen after
            # saving their first reel in Annotate, so they can pick it and start
            # framing. This is quest_2's first step, before the framing tutorial.
            "return_home",
            "watch_framing_tutorial",
            "open_framing",
            "position_crop",
            "add_slowmo",
            "export_framing",
            "wait_for_export",
        ],
    },
    {
        "id": "quest_3",
        "title": "Configure Your Spotlight",
        "reward": 0,  # T8120: retired — credits granted upfront
        "step_ids": [
            "watch_overlay_tutorial",
            "open_overlay",
            "select_players",
            "choose_color",
            "choose_shape",
            # T5170: rendering the spotlight belongs with configuring it — the
            # user adds AND renders the spotlight in one sitting, so these two
            # render steps live at the end of the overlay quest, not in Publish.
            "export_overlay",
            "wait_for_overlay",
        ],
    },
    {
        "id": "quest_4",
        "title": "Publish Your Reel",
        "reward": 0,  # T8120: retired — credits granted upfront
        "step_ids": [
            "watch_publish_tutorial",
            # T6840: preview the finished draft before publishing (kept in sync
            # with questDefinitions.js). Completes when the user plays a draft's
            # preview for ~1s; backfilled by move_to_my_reels for existing users.
            "preview_draft",
            "move_to_my_reels",
            "view_gallery_video",
        ],
    },
]

QUEST_BY_ID = {q["id"]: q for q in QUEST_DEFINITIONS}
ALL_STEP_IDS = [s for q in QUEST_DEFINITIONS for s in q["step_ids"]]
