"""
Quest Configuration — single source of truth for quest definitions (T1000).

All quest IDs, step IDs, titles, and rewards live here. Both quests.py and
admin.py import from this module. The frontend fetches definitions via
GET /api/quests/definitions.
"""

QUEST_DEFINITIONS = [
    {
        "id": "quest_1",
        "title": "Get Started",
        "reward": 15,
        "step_ids": [
            "upload_game",
            "annotate_brilliant",
            "playback_annotations",
        ],
    },
    {
        "id": "quest_2",
        "title": "Export Highlights",
        "reward": 25,
        "step_ids": [
            "open_framing",
            "export_framing",
            "wait_for_export",
            "export_overlay",
            "view_gallery_video",
        ],
    },
    {
        "id": "quest_3",
        "title": "Annotate More Clips",
        "reward": 40,
        "step_ids": [
            "annotate_second_5_star",
            "annotate_5_more",
            "export_second_highlight",
            "wait_for_export_2",
            "overlay_second_highlight",
            "watch_second_highlight",
        ],
    },
    {
        "id": "quest_4",
        "title": "Highlight Reel",
        "reward": 45,
        "step_ids": [
            "upload_game_2",
            "annotate_game_2",
            "create_reel",
            "export_reel",
            "wait_for_reel",
            "overlay_reel",
            "watch_reel",
        ],
    },
]

QUEST_BY_ID = {q["id"]: q for q in QUEST_DEFINITIONS}
ALL_STEP_IDS = [s for q in QUEST_DEFINITIONS for s in q["step_ids"]]
