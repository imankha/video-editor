"""
Quests Router - Quest progress, achievements, and reward claiming (T540).

Quest steps are derived from existing data where possible (games, clips, exports, auth).
Only 2 steps use an achievements table for non-derivable actions.
Reward claiming is idempotent — credits are only granted once per quest.
"""

import logging
import os
import sqlite3
import time

from fastapi import APIRouter, HTTPException

from ..database import get_db_connection
from ..quest_config import QUEST_DEFINITIONS
from ..services.user_db import (
    get_completed_and_claimed_quest_ids,
    get_credit_balance,
    grant_credits,
    mark_quest_completed,
)
from ..user_context import get_current_user_id

logger = logging.getLogger(__name__)

PROFILING_ENABLED = os.getenv("PROFILING_ENABLED", "false").lower() == "true"

router = APIRouter(prefix="/quests", tags=["quests"])

# Known achievement keys — only these can be recorded.
# T3700: added the per-step framing/overlay events so quest drop-off is measurable.
KNOWN_ACHIEVEMENT_KEYS = {
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
    # Publish-quest step event (Move to My Reels button)
    "moved_to_my_reels",
    # T4780: tutorial-watch step events (one per quest, fires at 80% watch or 10s+close)
    "watched_annotate_tutorial",
    "watched_framing_tutorial",
    "watched_overlay_tutorial",
    "watched_publish_tutorial",
}

ACHIEVEMENT_TO_MILESTONE = {
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
    "moved_to_my_reels": "moved_to_my_reels",
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
    "moved_to_my_reels",
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
    rc = cursor.execute(
        "SELECT count(*) as total, count(CASE WHEN auto_project_id IS NOT NULL THEN 1 END) as reels FROM raw_clips"
    ).fetchone()

    steps = {}

    # --- Quest 1: Get Started ---
    # T4780: tutorial-watch steps — derived purely from their achievement keys
    steps["watch_annotate_tutorial"] = 'watched_annotate_tutorial' in achieved
    steps["watch_framing_tutorial"]  = 'watched_framing_tutorial' in achieved
    steps["watch_overlay_tutorial"]  = 'watched_overlay_tutorial' in achieved
    steps["watch_publish_tutorial"]  = 'watched_publish_tutorial' in achieved

    steps["upload_game"] = cursor.execute("SELECT 1 FROM games LIMIT 1").fetchone() is not None
    # add_clip: completed when the user opens the Add Clip form (achievement). Backfilled
    # by "any clip exists" so it auto-completes on save and for users who clipped before
    # this step existed (you can't have a clip without having opened the form).
    steps["add_clip"] = 'add_clip_opened' in achieved or rc["total"] >= 1
    steps["annotate_brilliant"] = rc["reels"] >= 1
    steps["playback_annotations"] = 'played_annotations' in achieved

    # --- Quest 2: Frame Your Highlight ---
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
    steps["move_to_my_reels"] = 'moved_to_my_reels' in achieved
    steps["view_gallery_video"] = 'watched_gallery_video_1s' in achieved

    if PROFILING_ENABLED:
        logger.info(f"[PROFILE] _check_all_steps: {(time.perf_counter() - _t) * 1000:.0f}ms")

    return steps


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

    quests = []
    for qdef in QUEST_DEFINITIONS:
        quest_id = qdef["id"]

        if quest_id in completed_quest_ids:
            # Quest already completed (user-scoped) — all steps true, reward claimed
            quest_steps = {sid: True for sid in qdef["step_ids"]}
            quests.append({
                "id": quest_id,
                "steps": quest_steps,
                "completed": True,
                "reward_claimed": True,
            })
        else:
            quest_steps = {sid: all_steps.get(sid, False) for sid in qdef["step_ids"]}
            completed = all(quest_steps.values())
            reward_claimed = quest_id in claimed_quest_ids

            quests.append({
                "id": quest_id,
                "steps": quest_steps,
                "completed": completed,
                "reward_claimed": reward_claimed,
            })

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
    Claim credits for completing a quest. Idempotent — returns current balance
    if already claimed.
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

    # Grant reward — UNIQUE index on (user_id, source, reference_id) prevents double-grant
    try:
        new_balance = grant_credits(user_id, qdef["reward"], "quest_reward", quest_id)
    except sqlite3.IntegrityError:
        # UNIQUE constraint violation — already claimed (race condition or retry)
        # Still mark completed in user.sqlite in case backfill missed it.
        # Wrap in try/except: if a concurrent request holds the DB lock (race),
        # the quest is already fully claimed — return success regardless.
        try:
            mark_quest_completed(user_id, quest_id)
            balance = get_credit_balance(user_id)
            return {"credits_granted": 0, "new_balance": balance["balance"], "already_claimed": True}
        except sqlite3.OperationalError:
            logger.warning(f"[Quests] DB locked during already-claimed handling for {quest_id}, returning success")
            return {"credits_granted": 0, "new_balance": 0, "already_claimed": True}

    # T970: Mark quest as completed in user.sqlite (user-scoped, survives profile switch)
    mark_quest_completed(user_id, quest_id)

    from ..analytics import record_milestone
    record_milestone(user_id, "quest_completed", {"quest_id": quest_id, "quest_name": qdef["title"]})

    logger.info(f"[Quests] Granted {qdef['reward']} credits for {quest_id} to {user_id}, balance={new_balance}")

    return {"credits_granted": qdef["reward"], "new_balance": new_balance, "already_claimed": False}


@router.post("/achievements/{key}")
async def record_achievement(key: str):
    """
    Record a non-derivable achievement. Idempotent — INSERT OR IGNORE.
    """
    if key not in KNOWN_ACHIEVEMENT_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown achievement key: {key}")

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
        record_milestone(get_current_user_id(), milestone_event, {})

    logger.info(f"[Quests] Achievement recorded: {key} ({total_ms:.0f}ms)")
    return {"key": row["key"], "achieved_at": row["achieved_at"]}
