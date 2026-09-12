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

# T9410: server-side mirror of the frontend TUTORIAL_VIDEOS_ENABLED gate
# (src/frontend/src/config/questDefinitions.jsx). T8690 turned the tutorial videos
# off and hid the four `watch_*_tutorial` step CTAs from the checklist, but left
# those steps in the quest_config step_ids below — so a genuinely fresh account
# could never fire the `watched_*_tutorial` achievement (no CTA to click) yet
# claim_reward still gated on it, producing "step 'watch_annotate_tutorial' is
# incomplete" 400s under a panel showing 5/5 (T9410).
#
# The fix lives in quests._check_all_steps, the SINGLE source of truth every quest
# read shares: while videos are off, the four watch steps are treated as satisfied
# (there is no video to watch, so the requirement is vacuously met). Because
# /progress, /claim-reward, and /bootstrap all derive from that one function, a
# displayed-complete quest and a rejected claim can no longer disagree — and the
# guarantee holds regardless of what the frontend chooses to render, so it does not
# depend on this flag and the frontend one staying in lockstep. Flip to True (in
# BOTH places) to bring the tutorial steps back as real, user-completable gates.
# The four gated steps (one per quest) are spelled out explicitly at the
# quests._check_all_steps seam.
TUTORIAL_VIDEOS_ENABLED = False

QUEST_DEFINITIONS = [
    {
        "id": "quest_1",
        "title": "Getting started",  # T9560 (N38/N39): one onboarding name across guide/action/error
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
        "title": "Publish your clip",  # T9575: single-clip onboarding object is a clip, not a "reel"
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

# T9560 (Shared Vocabulary epic, N39/N40): human-readable step titles for the one
# piece of backend copy that names a step — the claim-reward "Step not complete"
# error. It must name the VISIBLE task, never the raw internal step id (which stays
# in the structured `step_id` field for support diagnostics). Internal ids (the dict
# KEYS) are unchanged. This mirrors the frontend STEP_TITLES
# (src/frontend/src/config/questDefinitions.jsx) plain-string labels and must stay in
# sync with it, exactly like the quest titles/step_ids already duplicated across the
# two layers. N40: `playback_annotations` uses the one established action label
# "Preview plays" (displayNames.ANNOTATE.PREVIEW_PLAYS) so guide, action, and error agree.
STEP_TITLES = {
    # T9575: sentence case across the whole checklist, mirroring the frontend
    # STEP_TITLES exactly (pinned by questDefinitions.test.jsx "FE/BE STEP_TITLES
    # sync"). Mode/feature proper nouns (Annotate, AI Focus, Spotlight, Publish,
    # Highlight Reels) keep their capitals; the "spotlight" EFFECT stays lowercase.
    "watch_annotate_tutorial": "Watch Annotate tutorial",
    "watch_framing_tutorial": "Watch AI Focus tutorial",
    "watch_overlay_tutorial": "Watch Spotlight tutorial",
    "watch_publish_tutorial": "Watch Publish tutorial",
    "upload_game": "Upload your first game",
    "add_clip": "Mark an amazing play",
    "rate_clip": "Rate & tag the play",
    "annotate_brilliant": "Save your play",
    "playback_annotations": "Preview plays",  # N40
    "return_home": "Head back home",
    "open_framing": "Open your clip",
    "position_crop": "Keep your player in frame",
    "add_slowmo": "Add a slow-mo moment",
    "export_framing": "Export your highlight",
    "wait_for_export": "Crisp it up to 1080p",
    "open_overlay": "Open in Spotlight",
    "select_players": "Pick your player",
    "choose_color": "Pick your spotlight color",
    "choose_shape": "Choose the spotlight shape",
    "export_overlay": "Export clip with effects",
    "wait_for_overlay": "Render the spotlight",
    "preview_draft": "Watch your preview",
    # T9575 residual #2: this title hardcodes the FE-derived `Move to
    # ${SECTION_NAMES.LIBRARY}` string. They agree by COINCIDENCE across the
    # JS/Python boundary (no shared constant), so a future `LIBRARY` rename would
    # silently drift this backend error copy. The FE/BE agreement is pinned by
    # questDefinitions.test.jsx ("FE/BE move_to_my_reels title sync") — update
    # both together if the destination noun changes.
    "move_to_my_reels": "Move to Highlight Reels",
    "view_gallery_video": "Watch your clip",
}
