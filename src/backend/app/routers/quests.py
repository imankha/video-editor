"""
Quests Router - Quest progress, achievements, and reward claiming (T540).

Quest steps are derived from existing data where possible (games, clips, exports, auth).
Only 2 steps use an achievements table for non-derivable actions.
Reward claiming is idempotent — credits are only granted once per quest.
"""

import logging
import os
import time

from fastapi import APIRouter, HTTPException

from ..database import column_exists, get_db_connection
from ..quest_config import QUEST_DEFINITIONS
from ..services.credit_ledger import get_credit_balance
from ..services.user_db import (
    get_completed_and_claimed_quest_ids,
    mark_quest_completed,
    set_quest_panel_collapsed,
)
from ..user_context import get_current_user_id

logger = logging.getLogger(__name__)

PROFILING_ENABLED = os.getenv("PROFILING_ENABLED", "false").lower() == "true"

router = APIRouter(prefix="/quests", tags=["quests"])

# Known achievement keys — only these can be recorded.
# T3700: added the per-step framing/overlay events so quest drop-off is measurable.
KNOWN_ACHIEVEMENT_KEYS = {
    # T7890: pre-upload funnel beacons — analytics-only (NOT quest steps, so they
    # are absent from _STEP_ACHIEVEMENT_KEYS). They ride the achievement POST purely
    # to bridge into record_milestone (impersonation-guarded) via ACHIEVEMENT_TO_MILESTONE.
    "add_game_opened",
    "upload_file_selected",
    "add_clip_opened",
    "opened_framing_editor",
    "opened_overlay_editor",
    "viewed_gallery_video",
    "viewed_custom_project_video",
    "played_annotations",
    "watched_gallery_video_1s",
    "watched_gallery_video_after_2_overlays",
    # T3700 framing-step events
    "crop_adjusted",
    "speed_segment_created",
    # T3700 overlay-step events
    "overlay_players_assigned",
    "overlay_color_set",
    "overlay_shape_set",
    # Publish-quest step events (Preview player + Move to My Reels button)
    "previewed_draft_reel_1s",  # T6840
    "moved_to_my_reels",
    # T5185: rate_clip step event — fires on the annotate gesture that leaves the
    # clip both rated AND tagged (not on save; see ClipDetailsEditor).
    "clip_rated",
    # T5195: return_home step event — fires when the user lands on the home
    # (games/drafts) screen; quest_2's first step guides them there to frame.
    "returned_home",
    # T4780: tutorial-watch step events (one per quest, fires at 80% watch or 10s+close)
    "watched_annotate_tutorial",
    "watched_framing_tutorial",
    "watched_overlay_tutorial",
    "watched_publish_tutorial",
}

ACHIEVEMENT_TO_MILESTONE = {
    # T7890: pre-upload funnel beacons (identity bridge — key == milestone name).
    "add_game_opened": "add_game_opened",
    "upload_file_selected": "upload_file_selected",
    "add_clip_opened": "add_clip_opened",
    "opened_framing_editor": "framing_opened",
    "opened_overlay_editor": "overlay_opened",
    "viewed_gallery_video": "gallery_viewed",
    "played_annotations": "annotations_played",
    "viewed_custom_project_video": "custom_project_viewed",
    "watched_gallery_video_1s": "gallery_watched_1s",
    "watched_gallery_video_after_2_overlays": "gallery_watched_after_overlays",
    # T3700 framing/overlay step events (bridged to analytics for drop-off funnels)
    "crop_adjusted": "crop_adjusted",
    "speed_segment_created": "speed_segment_created",
    "overlay_players_assigned": "overlay_players_assigned",
    "overlay_color_set": "overlay_color_set",
    "overlay_shape_set": "overlay_shape_set",
    "previewed_draft_reel_1s": "previewed_draft_reel_1s",  # T6840
    # T7510: `moved_to_my_reels` no longer bridges to a milestone — it emits
    # server-side as `move_succeeded` from downloads.py:move_reels_to_profile at
    # the durable point. Bridging here too would double-count the content outcome.
    # (Kept in KNOWN_ACHIEVEMENT_KEYS + _STEP_ACHIEVEMENT_KEYS for quest steps.)
    # T4780: tutorial-watch milestones (bridge to analytics for funnel tracking)
    "watched_annotate_tutorial": "watched_annotate_tutorial",
    "watched_framing_tutorial": "watched_framing_tutorial",
    "watched_overlay_tutorial": "watched_overlay_tutorial",
    "watched_publish_tutorial": "watched_publish_tutorial",
}

# All achievement keys consumed by quest-step computation (batched in one query).
_STEP_ACHIEVEMENT_KEYS = [
    "add_clip_opened",
    "played_annotations",
    "opened_framing_editor",
    "opened_overlay_editor",
    "crop_adjusted",
    "speed_segment_created",
    "overlay_players_assigned",
    "overlay_color_set",
    "overlay_shape_set",
    "previewed_draft_reel_1s",  # T6840
    "moved_to_my_reels",
    "clip_rated",
    "returned_home",
    "watched_gallery_video_1s",
    # T4780: tutorial-watch steps (ride the same batched IN query — no new DB queries)
    "watched_annotate_tutorial",
    "watched_framing_tutorial",
    "watched_overlay_tutorial",
    "watched_publish_tutorial",
]

# Map step_id -> quest_id for skip lookups
_STEP_TO_QUEST = {}
for _q in QUEST_DEFINITIONS:
    for _s in _q["step_ids"]:
        _STEP_TO_QUEST[_s] = _q["id"]


def _check_all_steps(user_id: str, conn, skip_quest_ids: set | None = None) -> dict:
    """Compute every quest-step boolean from per-profile data.

    Steps derive from four cheap, batched sources: the games table, a raw_clips
    aggregate, an export_jobs aggregate, and the achievements table. Each step
    completes via exactly one hard trigger (T3700) — a DB condition or a recorded
    achievement event. No step depends on an optional/skippable state.

    skip_quest_ids is accepted for caller compatibility but all steps are always
    computed (the work is four queries); the caller overrides steps for already-
    claimed quests with True.
    """
    cursor = conn.cursor()
    if PROFILING_ENABLED:
        _t = time.perf_counter()

    # --- Achievements (one batched query) ---
    cursor.execute(
        f"SELECT key FROM achievements WHERE key IN ({','.join('?' * len(_STEP_ACHIEVEMENT_KEYS))})",
        _STEP_ACHIEVEMENT_KEYS,
    )
    achieved = {row['key'] for row in cursor.fetchall()}

    # --- export_jobs aggregate (one query) ---
    cursor.execute("SELECT type, status, count(*) as cnt FROM export_jobs GROUP BY type, status")
    export_counts = {}
    export_type_totals = {}
    for row in cursor.fetchall():
        export_counts[(row['type'], row['status'])] = row['cnt']
        export_type_totals[row['type']] = export_type_totals.get(row['type'], 0) + row['cnt']
    framing_total = export_type_totals.get('framing', 0)
    framing_done = export_counts.get(('framing', 'complete'), 0)
    overlay_total = export_type_totals.get('overlay', 0)
    overlay_done = export_counts.get(('overlay', 'complete'), 0)

    # --- raw_clips aggregate (one query) ---
    # NOTE: 'reels' deliberately counts auto_project_id regardless of the
    # project's archived state — quest steps are LIFETIME achievements, and a
    # published (archived) reel still counts. Do not add an archived_at gate
    # here (it would un-complete quests on publish); drafts-list semantics
    # live in projects.py/games.py instead.
    # T5330: onboarding is a function of the user's OWN content only. Content
    # materialized from a teammate share carries shared_by (set at
    # materialization); exclude it so a shared game/clip/auto-reel never
    # pre-completes add_clip/rate_clip/annotate_brilliant. The 5-star
    # auto-draft-reel is excluded transitively: its auto_project_id sits on the
    # shared raw_clip row, which has shared_by set. Own content (shared_by NULL)
    # still counts, so pre-existing-user backfills are unaffected.
    rc = cursor.execute(
        "SELECT count(*) as total, count(CASE WHEN auto_project_id IS NOT NULL THEN 1 END) as reels "
        "FROM raw_clips WHERE shared_by IS NULL"
    ).fetchone()

    steps = {}

    # --- Quest 1: Get Started ---
    # T4780: tutorial-watch steps — derived purely from their achievement keys
    steps["watch_annotate_tutorial"] = 'watched_annotate_tutorial' in achieved
    steps["watch_framing_tutorial"]  = 'watched_framing_tutorial' in achieved
    steps["watch_overlay_tutorial"]  = 'watched_overlay_tutorial' in achieved
    steps["watch_publish_tutorial"]  = 'watched_publish_tutorial' in achieved

    # T5330: exclude games materialized from a share (games.shared_by set at
    # materialization). Own games have shared_by NULL, so a genuine upload still
    # completes this step.
    # T5970: games.shared_by arrives with v026, which runs manually (not on
    # deploy/startup). _check_all_steps runs on the bootstrap (app-load) path, so a
    # below-v026 profile DB would 500 every user's load with "no such column:
    # shared_by". Probe the column and, during the window, fall back to "any game
    # exists" — the column's own default is NULL (own upload), and nothing could
    # have set it to non-NULL yet since materialization is what adds/sets it, so a
    # bare `SELECT 1 FROM games` is the correct shared_by-IS-NULL result.
    if column_exists(cursor, "games", "shared_by"):
        steps["upload_game"] = cursor.execute(
            "SELECT 1 FROM games WHERE shared_by IS NULL LIMIT 1"
        ).fetchone() is not None
    else:
        steps["upload_game"] = cursor.execute(
            "SELECT 1 FROM games LIMIT 1"
        ).fetchone() is not None
    # add_clip: completed when the user opens the Add Clip form (achievement). Backfilled
    # by "any clip exists" so it auto-completes on save and for users who clipped before
    # this step existed (you can't have a clip without having opened the form).
    steps["add_clip"] = 'add_clip_opened' in achieved or rc["total"] >= 1
    # T5185: rate_clip ("Rate & Tag the Play") — completed when the `clip_rated`
    # achievement fires. That achievement now fires ONLY when a clip is both rated
    # (>=1 star) AND tagged (>=1 tag), from whichever annotate gesture completes the
    # pair (ClipDetailsEditor) — not on save. Backfilled by "any reel exists" so it
    # auto-completes for users who saved a reel before this step existed: you can't
    # save a reel without rating a clip, so a reel is proof the step was satisfied.
    steps["rate_clip"] = 'clip_rated' in achieved or rc["reels"] >= 1
    steps["annotate_brilliant"] = rc["reels"] >= 1
    steps["playback_annotations"] = 'played_annotations' in achieved

    # --- Quest 2: Frame Your Highlight ---
    # T5195: return_home — completed when the user lands on the home (games) screen
    # (achievement fired on arrival). Backfilled by "any framing export started": a
    # user who has begun framing was necessarily home first, mirroring add_clip's
    # backfill, so the new step auto-completes for mid-quest_2 users.
    steps["return_home"] = 'returned_home' in achieved or framing_total >= 1
    steps["open_framing"] = 'opened_framing_editor' in achieved
    steps["position_crop"] = 'crop_adjusted' in achieved
    steps["add_slowmo"] = 'speed_segment_created' in achieved
    steps["export_framing"] = framing_total >= 1
    steps["wait_for_export"] = framing_done >= 1

    # --- Quest 3: Configure Your Spotlight ---
    steps["open_overlay"] = 'opened_overlay_editor' in achieved
    steps["select_players"] = 'overlay_players_assigned' in achieved
    steps["choose_color"] = 'overlay_color_set' in achieved
    steps["choose_shape"] = 'overlay_shape_set' in achieved

    # --- Quest 4: Publish Your Reel ---
    # Mirrors the framing split: "Add the Spotlight" completes when the render
    # STARTS (job created), the wait step when it COMPLETES.
    steps["export_overlay"] = overlay_total >= 1
    steps["wait_for_overlay"] = overlay_done >= 1
    # T6840: "Watch Your Preview" completes after ~1s of preview playback. The
    # `moved_to_my_reels` OR is the backward-compat guarantee: users who already
    # published (or already finished quest_4 before this step existed) can't have
    # the quest reopen with a new unchecked step.
    steps["preview_draft"] = 'previewed_draft_reel_1s' in achieved or 'moved_to_my_reels' in achieved
    steps["move_to_my_reels"] = 'moved_to_my_reels' in achieved
    steps["view_gallery_video"] = 'watched_gallery_video_1s' in achieved

    if PROFILING_ENABLED:
        logger.info(f"[PROFILE] _check_all_steps: {(time.perf_counter() - _t) * 1000:.0f}ms")

    return steps


def _assemble_quests(all_steps: dict, completed_quest_ids: set, claimed_quest_ids: set) -> list:
    """Build the per-quest progress list from derived steps + user-scoped state.

    Shared by GET /progress and the achievements POST (T6270) so both return an
    identical `quests` shape. A quest in the user-scoped completed set renders all
    of ITS CURRENT step_ids True (self-heal — adding a step can't un-complete a
    quest already finished); otherwise steps derive from the active profile.
    """
    quests = []
    for qdef in QUEST_DEFINITIONS:
        quest_id = qdef["id"]

        if quest_id in completed_quest_ids:
            # Quest already completed (user-scoped) — all steps true, reward claimed
            quests.append({
                "id": quest_id,
                "steps": {sid: True for sid in qdef["step_ids"]},
                "completed": True,
                "reward_claimed": True,
            })
        else:
            quest_steps = {sid: all_steps.get(sid, False) for sid in qdef["step_ids"]}
            quests.append({
                "id": quest_id,
                "steps": quest_steps,
                "completed": all(quest_steps.values()),
                "reward_claimed": quest_id in claimed_quest_ids,
            })

    return quests


@router.get("/definitions")
async def get_definitions():
    """Return quest structure for the frontend. No auth required."""
    return [
        {
            "id": q["id"],
            "title": q["title"],
            "reward": q["reward"],
            "step_ids": q["step_ids"],
        }
        for q in QUEST_DEFINITIONS
    ]


@router.get("/progress")
async def get_progress():
    """Get quest progress for the current user.

    Completed quests are read from user.sqlite (user-scoped, T970).
    Step progress for uncompleted quests is derived from the active profile.

    Allowlisted pre-login: if no user context is set, return an all-incomplete
    shape so the onboarding quest panel can render without a 401.
    """
    try:
        user_id = get_current_user_id()
    except RuntimeError:
        return {
            "quests": [
                {
                    "id": qdef["id"],
                    "steps": {sid: False for sid in qdef["step_ids"]},
                    "completed": False,
                    "reward_claimed": False,
                }
                for qdef in QUEST_DEFINITIONS
            ]
        }

    if PROFILING_ENABLED:
        _t_total = time.perf_counter()
        _t = time.perf_counter()

    # T1536: completed + claimed read on a SINGLE user.sqlite connection (was two
    # separate opens, each a potential cold R2 restore).
    completed_quest_ids, claimed_quest_ids = get_completed_and_claimed_quest_ids(user_id)

    if PROFILING_ENABLED:
        _t_user_read = time.perf_counter() - _t

    with get_db_connection() as conn:
        if PROFILING_ENABLED:
            _t = time.perf_counter()
        all_steps = _check_all_steps(user_id, conn, skip_quest_ids=completed_quest_ids)
        if PROFILING_ENABLED:
            _t_check_steps = time.perf_counter() - _t

    quests = _assemble_quests(all_steps, completed_quest_ids, claimed_quest_ids)

    if PROFILING_ENABLED:
        total_ms = (time.perf_counter() - _t_total) * 1000
        logger.info(
            f"[PROFILE] GET /quests/progress: {total_ms:.0f}ms "
            f"(user_read: {_t_user_read*1000:.0f}ms [completed+claimed, 1 open], "
            f"check_steps: {_t_check_steps*1000:.0f}ms)"
        )

    return {"quests": quests}


@router.post("/{quest_id}/claim-reward")
async def claim_reward(quest_id: str):
    """
    Mark a completed quest as claimed to advance the panel to the next quest.
    T8120: credits are no longer granted per-quest here — the whole chain total
    is granted upfront at signup/next login (credit_ledger.grant_quest_chain_credits).
    Idempotent — returns current balance (unchanged by this call) if already claimed.
    """
    user_id = get_current_user_id()

    # Find quest definition
    qdef = next((q for q in QUEST_DEFINITIONS if q["id"] == quest_id), None)
    if not qdef:
        raise HTTPException(status_code=404, detail="Quest not found")

    # Progress/claim consistency (bugs 34p/35p): GET /progress reports a quest complete when
    # it is in the user-scoped completed/claimed set (T970 — this survives profile switches),
    # WITHOUT re-deriving steps from the active profile. claim-reward must honor that SAME
    # source BEFORE re-checking steps; otherwise the two endpoints disagree — a quest the panel
    # shows as complete 400s here when the active profile lacks the step data (a resurrected
    # account, or simply a different selected profile). This is idempotency, not a loosened
    # gate: a quest only enters completed/claimed via a prior legitimate grant, so returning
    # already_claimed never hands out unearned credits — an unclaimed quest still faces the
    # full step check below.
    completed_ids, claimed_ids = get_completed_and_claimed_quest_ids(user_id)
    if quest_id in completed_ids or quest_id in claimed_ids:
        mark_quest_completed(user_id, quest_id)  # keep the completed set in sync with claimed
        balance = get_credit_balance(user_id)
        return {"credits_granted": 0, "new_balance": balance["balance"], "already_claimed": True}

    # Verify all steps complete (unclaimed quest — the full gate applies unchanged)
    with get_db_connection() as conn:
        all_steps = _check_all_steps(user_id, conn)

    for sid in qdef["step_ids"]:
        if not all_steps.get(sid, False):
            raise HTTPException(status_code=400, detail=f"Quest not complete: step '{sid}' is incomplete")

    # T8120: per-quest credit rewards are RETIRED — the whole chain total is
    # granted upfront (credit_ledger.grant_quest_chain_credits, at signup / next
    # login), so "claiming" a quest now only marks it complete for progression
    # (advances the panel to the next quest) and grants nothing. `reward` is 0 on
    # every quest; do NOT call credit_ledger.grant here (it rejects amount<=0).
    # Kept as an idempotent no-op grant path so the frontend claim gesture and the
    # completed/claimed bookkeeping (mark_quest_completed) stay intact.
    mark_quest_completed(user_id, quest_id)

    from ..analytics import record_milestone
    record_milestone(user_id, "quest_completed", {"quest_id": quest_id, "quest_name": qdef["title"]})

    balance = get_credit_balance(user_id)["balance"]
    logger.info(f"[Quests] Marked {quest_id} complete for {user_id} (credits granted upfront, none on claim)")

    return {"credits_granted": 0, "new_balance": balance, "already_claimed": False}


@router.post("/panel-collapsed")
async def set_panel_collapsed(payload: dict):
    """Persist the collapsed state of the onboarding quest (Help) panel (T8120).

    Gesture-driven: the frontend calls this from the collapse/expand click so the
    preference survives navigation and reload. Body: {"collapsed": bool}.
    """
    user_id = get_current_user_id()
    collapsed = bool(payload.get("collapsed"))
    set_quest_panel_collapsed(user_id, collapsed)
    return {"collapsed": collapsed}


@router.post("/achievements/{key}")
async def record_achievement(key: str):
    """
    Record a non-derivable achievement. Idempotent — INSERT OR IGNORE.
    """
    if key not in KNOWN_ACHIEVEMENT_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown achievement key: {key}")

    # user_id is required for the profile write below (get_db_connection resolves it)
    # and for reading the user-scoped completed/claimed sets when building progress.
    user_id = get_current_user_id()

    # T6270: this write mutates quest progress, and every client caller chased it
    # with a GET /quests/progress. Fold that read into this response so the caller
    # can update the quest UI from the POST alone (the follow-up GET disappears).
    completed_quest_ids, claimed_quest_ids = get_completed_and_claimed_quest_ids(user_id)

    # Per-step timing attributes conn vs write vs read. Full cProfile dump
    # is handled by the request middleware (see app/profiling.py) when
    # PROFILE_ON_BREACH_ENABLED=true — grep the matching [SLOW REQUEST] line
    # for the profile= path to open alongside this breakdown.
    t0 = time.perf_counter()
    with get_db_connection() as conn:
        t_conn = time.perf_counter()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO achievements (key) VALUES (?)",
            (key,),
        )
        conn.commit()
        t_write = time.perf_counter()

        row = cursor.execute(
            "SELECT key, achieved_at FROM achievements WHERE key = ?",
            (key,),
        ).fetchone()
        t_read = time.perf_counter()

        # Reuse the same profile connection to derive the updated step booleans.
        all_steps = _check_all_steps(user_id, conn, skip_quest_ids=completed_quest_ids)

    quests = _assemble_quests(all_steps, completed_quest_ids, claimed_quest_ids)

    conn_ms = (t_conn - t0) * 1000
    write_ms = (t_write - t_conn) * 1000
    read_ms = (t_read - t_write) * 1000
    total_ms = (t_read - t0) * 1000
    if total_ms > 500:
        logger.warning(
            f"[SLOW ACHIEVEMENT] key={key} total_ms={total_ms:.0f} "
            f"conn_ms={conn_ms:.0f} write_ms={write_ms:.0f} read_ms={read_ms:.0f}"
        )
    milestone_event = ACHIEVEMENT_TO_MILESTONE.get(key)
    if milestone_event:
        from ..analytics import record_milestone
        record_milestone(user_id, milestone_event, {})

    logger.info(f"[Quests] Achievement recorded: {key} ({total_ms:.0f}ms)")
    # T6270: `progress` is ADDITIVE — existing callers reading key/achieved_at are
    # unaffected; the client uses `progress` in place of a follow-up GET.
    return {"key": row["key"], "achieved_at": row["achieved_at"], "progress": {"quests": quests}}
