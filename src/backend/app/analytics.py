import logging

from app.services.pg import get_pg

logger = logging.getLogger(__name__)

MILESTONE_EVENTS = {
    "game_created":     ("first_game_created_at",     "game_created_count"),
    "clip_created":     ("first_clip_created_at",     "clip_created_count"),
    "export_completed": ("first_export_completed_at", "export_completed_count"),
    "export_failed":    (None,                        "export_failed_count"),
    "share_completed":  ("first_share_completed_at",  "share_completed_count"),
    "credit_purchased": ("first_credit_purchase_at",  "credit_purchase_count"),
    "credits_consumed": (None,                        "credits_consumed_count"),
}


def create_user_milestones(user_id: str, origin_type: str, origin_channel: str | None, signup_method: str):
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO user_milestones (user_id, origin_type, origin_channel, signup_method)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (user_id) DO NOTHING""",
                (user_id, origin_type, origin_channel, signup_method),
            )
    except Exception:
        logger.exception("[Analytics] Failed to create milestones for %s", user_id)


def record_milestone(user_id: str, event: str):
    try:
        entry = MILESTONE_EVENTS.get(event)
        if not entry:
            logger.warning("[Analytics] Unknown event: %s", event)
            return

        first_col, count_col = entry

        set_clauses = []
        if first_col:
            set_clauses.append(f"{first_col} = COALESCE({first_col}, now())")
        set_clauses.append(f"{count_col} = {count_col} + 1")
        set_clauses.append("last_active_at = now()")
        if event == "export_completed":
            set_clauses.append("last_export_at = now()")

        sql = f"UPDATE user_milestones SET {', '.join(set_clauses)} WHERE user_id = %s"

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(sql, (user_id,))
    except Exception:
        logger.exception("[Analytics] Failed to record %s for %s", event, user_id)


def update_session(user_id: str):
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_milestones
                   SET session_count = CASE
                           WHEN last_active_at < now() - INTERVAL '30 minutes' THEN session_count + 1
                           ELSE session_count
                       END,
                       last_active_at = now()
                   WHERE user_id = %s""",
                (user_id,),
            )
    except Exception:
        logger.exception("[Analytics] Failed to update session for %s", user_id)
