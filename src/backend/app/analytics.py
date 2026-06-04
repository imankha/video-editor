import json
import logging
import re

from app.services.pg import get_pg

logger = logging.getLogger(__name__)

INVITE_CODE_RE = re.compile(r'^[0-9a-f]{8}$')

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
    # Tracking gap events (T3470)
    "session_started":      {"label": "Session",            "daily_col": "sessions_started"},
    "quest_completed":      {"label": "Quest Done",         "daily_col": None},
    "invite_sent":          {"label": "Invited",            "daily_col": "invites_sent"},
    "share_viewed":         {"label": "Share Viewed",       "daily_col": "shares_viewed"},
    "payment_started":      {"label": "Payment Started",    "daily_col": None},
    "payment_completed":    {"label": "Payment Done",       "daily_col": None},
    "export_started":       {"label": "Export Started",     "daily_col": "exports_started"},
}

FUNNEL_STEPS = [
    "session_started",
    "game_created",
    "clip_created",
    "annotation_completed",
    "framing_opened",
    "framing_exported",
    "overlay_exported",
    "export_started",
    "export_completed",
    "gallery_viewed",
    "video_downloaded",
    "share_completed",
    "invite_sent",
    "share_viewed",
    "credit_purchased",
]

_EXPORT_EVENTS = {"export_completed", "framing_exported", "overlay_exported"}

CREDIT_AMOUNT_TO_CENTS = {
    120: 499,
    400: 1299,
    1000: 2499,
}


def _upsert_daily_counter(cur, origin: str, column: str):
    sql = f"""
        INSERT INTO daily_counters (counter_date, origin_type, {column})
        VALUES (CURRENT_DATE, %s, 1)
        ON CONFLICT (counter_date, origin_type)
        DO UPDATE SET {column} = daily_counters.{column} + 1
    """
    cur.execute(sql, (origin,))


def _get_user_origin(user_id: str) -> str:
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT origin FROM user_segments WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    return row["origin"] if row else "organic"


def _determine_origin(
    user_id: str,
    ref: str | None,
    utm_campaign: str | None = None,
    click_source: str | None = None,
) -> tuple[str, str | None]:
    """Determine origin and referrer_id for a new user.

    Priority: ref invite code -> ref campaign ID -> utm_campaign ->
    share-based -> click_source fallback -> organic.
    """
    from app.services.sharing_db import resolve_invite_code

    if ref:
        if INVITE_CODE_RE.match(ref):
            referrer_id = resolve_invite_code(ref)
            if referrer_id:
                inviter_origin = _get_user_origin(referrer_id)
                return inviter_origin, referrer_id
        else:
            return ref, None

    if utm_campaign:
        return utm_campaign, None

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT sharer_user_id FROM shares
               WHERE recipient_email = (SELECT email FROM users WHERE user_id = %s)
                 AND sharer_user_id != %s
               ORDER BY shared_at ASC LIMIT 1""",
            (user_id, user_id),
        )
        row = cur.fetchone()
    if row:
        sharer_origin = _get_user_origin(row["sharer_user_id"])
        return sharer_origin, row["sharer_user_id"]

    if click_source:
        return f"{click_source}_unknown", None

    return "organic", None


def create_user_segment(
    user_id: str, origin: str, referrer_id: str | None, signup_method: str,
    *,
    utm_source: str | None = None,
    utm_medium: str | None = None,
    utm_campaign: str | None = None,
    utm_content: str | None = None,
    utm_term: str | None = None,
    click_source: str | None = None,
):
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO user_segments
                   (user_id, origin, referrer_id, signup_method,
                    utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_source)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (user_id) DO NOTHING""",
                (user_id, origin, referrer_id, signup_method,
                 utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_source),
            )
            _upsert_daily_counter(cur, origin, "signups")
            _upsert_daily_counter(cur, "all", "signups")
        logger.info("[Analytics] Created segment: user=%s origin=%s referrer=%s method=%s", user_id, origin, referrer_id, signup_method)
    except Exception:
        logger.exception("[Analytics] Failed to create segment for %s", user_id)

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
        logger.warning("[Analytics] SQLite sync failed for create_user_segment user=%s", user_id)


def record_milestone(user_id: str, event: str, context: dict | None = None):
    try:
        cfg = FLOW_EVENTS.get(event)
        if not cfg:
            logger.warning("[Analytics] Unknown event: %s", event)
            return

        with get_pg() as conn:
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO user_actions (user_id, action)
                VALUES (%s, %s)
                ON CONFLICT (user_id, action)
                DO UPDATE SET count = user_actions.count + 1
            """, (user_id, event))

            cur.execute(
                "SELECT origin FROM user_segments WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()

            daily_col = cfg["daily_col"]
            if daily_col and row:
                origin = row["origin"]
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
                "INSERT INTO user_action_log (action, context) VALUES (?, ?)",
                (event, json.dumps(context) if context else None),
            )
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

            # Check gap before updating last_active_at
            cur.execute(
                """SELECT last_active_at < now() - INTERVAL '30 minutes' AS is_new_session
                   FROM user_segments WHERE user_id = %s""",
                (user_id,),
            )
            seg_row = cur.fetchone()
            if not seg_row:
                return

            is_new_session = seg_row["is_new_session"]

            cur.execute(
                "UPDATE user_segments SET last_active_at = now() WHERE user_id = %s",
                (user_id,),
            )

            cur.execute("""
                INSERT INTO user_actions (user_id, action, count, first_at)
                VALUES (%s, 'session_started', 1, now())
                ON CONFLICT (user_id, action)
                DO UPDATE SET count = CASE
                    WHEN %s THEN user_actions.count + 1
                    ELSE user_actions.count
                END
            """, (user_id, is_new_session))

            if is_pwa:
                cur.execute("""
                    INSERT INTO user_actions (user_id, action, count, first_at)
                    VALUES (%s, 'pwa_session_started', 1, now())
                    ON CONFLICT (user_id, action)
                    DO UPDATE SET count = CASE
                        WHEN %s THEN user_actions.count + 1
                        ELSE user_actions.count
                    END
                """, (user_id, is_new_session))

            if is_new_session:
                cur.execute(
                    "SELECT origin FROM user_segments WHERE user_id = %s",
                    (user_id,),
                )
                origin_row = cur.fetchone()
                if origin_row:
                    _upsert_daily_counter(cur, origin_row["origin"], "sessions_started")
                    _upsert_daily_counter(cur, "all", "sessions_started")

            cur.execute(
                "SELECT action, count FROM user_actions WHERE user_id = %s AND action IN ('session_started', 'pwa_session_started')",
                (user_id,),
            )
            counts = {r["action"]: r["count"] for r in cur.fetchall()}
            session_count = counts.get("session_started", 0)
            pwa_session_count = counts.get("pwa_session_started", 0)

            pwa_info = f" pwa_sessions={pwa_session_count}" if is_pwa else ""
            logger.info("[Analytics] Session update: user=%s session_count=%s%s", user_id, session_count, pwa_info)
    except Exception:
        logger.exception("[Analytics] Failed to update session for %s", user_id)
        return

    try:
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(user_id) as conn:
            if is_new_session:
                conn.execute(
                    "INSERT INTO user_action_log (action, context) VALUES (?, ?)",
                    ("session_started", json.dumps({"is_pwa": is_pwa})),
                )
            conn.execute(
                """INSERT INTO user_activity (user_id, session_count, pwa_session_count, last_active_at, updated_at)
                   VALUES (?, ?, ?, datetime('now'), datetime('now'))
                   ON CONFLICT(user_id) DO UPDATE SET
                       session_count = ?,
                       pwa_session_count = ?,
                       last_active_at = datetime('now'),
                       updated_at = datetime('now')""",
                (user_id, session_count, pwa_session_count,
                 session_count, pwa_session_count),
            )
            conn.commit()
    except Exception:
        logger.warning("[Analytics] SQLite sync failed for update_session user=%s", user_id)


def increment_total_spent(user_id: str, amount_cents: int):
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE user_segments SET total_spent_cents = total_spent_cents + %s WHERE user_id = %s",
                (amount_cents, user_id),
            )
        logger.info("[Analytics] Incremented total_spent: user=%s amount_cents=%s", user_id, amount_cents)
    except Exception:
        logger.exception("[Analytics] Failed to increment total_spent for %s", user_id)
