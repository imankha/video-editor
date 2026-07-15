"""
Quest Configuration — single source of truth for quest definitions (T1000, T3700).

All quest IDs, step IDs, titles, and rewards live here. Both quests.py and
admin.py import from this module. The frontend fetches definitions via
GET /api/quests/definitions.

T3700: Framing and Overlay are split into separate quests and each is decomposed
into small, individually-triggered steps so per-step drop-off is measurable. Every
step completes via a hard trigger (a derived DB condition or a recorded achievement
event); there are no optional/skippable steps.
"""

QUEST_DEFINITIONS = [
    {
        "id": "quest_1",
        "title": "Get Started",
        "reward": 15,
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
        "reward": 25,
        "step_ids": [
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
        "reward": 25,
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
        "reward": 15,
        "step_ids": [
            "watch_publish_tutorial",
            "move_to_my_reels",
            "view_gallery_video",
        ],
    },
]

QUEST_BY_ID = {q["id"]: q for q in QUEST_DEFINITIONS}
ALL_STEP_IDS = [s for q in QUEST_DEFINITIONS for s in q["step_ids"]]
