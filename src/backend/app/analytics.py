import logging

from app.services.pg import get_pg

logger = logging.getLogger(__name__)

FLOW_EVENTS = {
    # Original events (T3010)
    "game_created":         {"label": "Uploaded",           "daily_col": "games_created"},
    "clip_created":         {"label": "Clipped",            "daily_col": "clips_created"},
    "export_completed":     {"label": "Exported",           "daily_col": "exports_completed"},
    "export_failed":        {"label": None,                 "daily_col": "exports_failed"},
    "share_completed":      {"label": "Shared",             "daily_col": "shares_completed"},
    "credit_purchased":     {"label": "Purchased",          "daily_col": "credit_purchases"},
    "credits_consumed":     {"label": None,                 "daily_col": "credits_consumed"},
    "pwa_installed":        {"label": "PWA Installed",      "daily_col": None},
    # New flow events (T3040)
    "annotation_completed": {"label": "Annotation Done",    "daily_col": "annotations_completed"},
    "framing_opened":       {"label": "Framing Opened",     "daily_col": None},
    "framing_exported":     {"label": "Framing Exported",   "daily_col": "framing_exports"},
    "overlay_exported":     {"label": "Overlay Exported",   "daily_col": "overlay_exports"},
    "gallery_viewed":       {"label": "Gallery Viewed",     "daily_col": None},
    "video_downloaded":     {"label": "Downloaded",         "daily_col": "video_downloads"},
}

FUNNEL_STEPS = [
    "game_created",
    "clip_created",
    "annotation_completed",
    "framing_opened",
    "framing_exported",
    "overlay_exported",
    "gallery_viewed",
    "video_downloaded",
    "share_completed",
    "credit_purchased",
]

_EXPORT_EVENTS = {"export_completed", "framing_exported", "overlay_exported"}


def _upsert_daily_counter(cur, origin_type: str, column: str):
    sql = f"""
        INSERT INTO daily_counters (counter_date, origin_type, {column})
        VALUES (CURRENT_DATE, %s, 1)
        ON CONFLICT (counter_date, origin_type)
        DO UPDATE SET {column} = daily_counters.{column} + 1
    """
    cur.execute(sql, (origin_type,))


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
            _upsert_daily_counter(cur, origin_type, "signups")
            _upsert_daily_counter(cur, "all", "signups")
        logger.info("[Analytics] Created milestones: user=%s origin=%s channel=%s method=%s", user_id, origin_type, origin_channel, signup_method)
    except Exception:
        logger.exception("[Analytics] Failed to create milestones for %s", user_id)

    try:
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(user_id) as conn:
            conn.execute(
                """INSERT OR IGNORE INTO user_activity (user_id)
                   VALUES (?)""",
                (user_id,),
            )
            conn.commit()
    except Exception:
        logger.warning("[Analytics] SQLite sync failed for create_user_milestones user=%s", user_id)


def record_milestone(user_id: str, event: str):
    try:
        cfg = FLOW_EVENTS.get(event)
        if not cfg:
            logger.warning("[Analytics] Unknown event: %s", event)
            return

        with get_pg() as conn:
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO user_flow_events (user_id, event)
                VALUES (%s, %s)
                ON CONFLICT (user_id, event)
                DO UPDATE SET count = user_flow_events.count + 1
            """, (user_id, event))

            set_clauses = ["last_active_at = now()"]
            if event in _EXPORT_EVENTS:
                set_clauses.append("last_export_at = now()")
            cur.execute(
                f"UPDATE user_milestones SET {', '.join(set_clauses)} WHERE user_id = %s RETURNING origin_type",
                (user_id,),
            )
            row = cur.fetchone()

            daily_col = cfg["daily_col"]
            if daily_col and row:
                origin = row["origin_type"]
                _upsert_daily_counter(cur, origin, daily_col)
                _upsert_daily_counter(cur, "all", daily_col)

        logger.info("[Analytics] Recorded: event=%s user=%s", event, user_id)
    except Exception:
        logger.exception("[Analytics] Failed to record %s for %s", event, user_id)
        return

    try:
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(user_id) as conn:
            conn.execute(
                """INSERT INTO user_activity_events (event, count, first_at)
                   VALUES (?, 1, datetime('now'))
                   ON CONFLICT(event) DO UPDATE SET
                       count = count + 1,
                       updated_at = datetime('now')""",
                (event,),
            )
            set_parts = ["last_active_at = datetime('now')", "updated_at = datetime('now')"]
            if event in _EXPORT_EVENTS:
                set_parts.append("last_export_at = datetime('now')")
            conn.execute(
                f"""INSERT INTO user_activity (user_id, last_active_at, updated_at)
                    VALUES (?, datetime('now'), datetime('now'))
                    ON CONFLICT(user_id) DO UPDATE SET {', '.join(set_parts)}""",
                (user_id,),
            )
            conn.commit()
    except Exception:
        logger.warning("[Analytics] SQLite sync failed for record_milestone user=%s event=%s", user_id, event)


def update_session(user_id: str, is_pwa: bool = False):
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_milestones
                   SET session_count = CASE
                           WHEN last_active_at < now() - INTERVAL '30 minutes' THEN session_count + 1
                           ELSE session_count
                       END,
                       pwa_session_count = CASE
                           WHEN %s AND last_active_at < now() - INTERVAL '30 minutes' THEN pwa_session_count + 1
                           ELSE pwa_session_count
                       END,
                       last_active_at = now()
                   WHERE user_id = %s
                   RETURNING session_count, pwa_session_count, last_active_at""",
                (is_pwa, user_id),
            )
            row = cur.fetchone()
            if row:
                pwa_info = f" pwa_sessions={row['pwa_session_count']}" if is_pwa else ""
                logger.info("[Analytics] Session update: user=%s session_count=%s%s", user_id, row["session_count"], pwa_info)
    except Exception:
        logger.exception("[Analytics] Failed to update session for %s", user_id)
        return

    if row:
        try:
            from app.services.user_db import get_user_db_connection
            with get_user_db_connection(user_id) as conn:
                conn.execute(
                    """INSERT INTO user_activity (user_id, session_count, pwa_session_count, last_active_at, updated_at)
                       VALUES (?, ?, ?, datetime('now'), datetime('now'))
                       ON CONFLICT(user_id) DO UPDATE SET
                           session_count = ?,
                           pwa_session_count = ?,
                           last_active_at = datetime('now'),
                           updated_at = datetime('now')""",
                    (user_id, row["session_count"], row["pwa_session_count"],
                     row["session_count"], row["pwa_session_count"]),
                )
                conn.commit()
        except Exception:
            logger.warning("[Analytics] SQLite sync failed for update_session user=%s", user_id)
