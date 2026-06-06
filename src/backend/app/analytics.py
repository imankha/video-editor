import atexit
import json
import logging
import re
import threading
from collections import defaultdict
from datetime import datetime, timezone

from app.services.pg import get_pg
from app.user_context import get_current_platform

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Buffered daily counters — collapse per-row upserts into periodic batch flush
# ---------------------------------------------------------------------------

class _DailyCounterBuffer:
    def __init__(self, flush_interval=15):
        self._buffer: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self._lock = threading.Lock()
        self._flush_interval = flush_interval
        self._timer: threading.Timer | None = None
        self._start_flush_timer()

    def increment(self, origin: str, column: str):
        with self._lock:
            self._buffer[origin][column] += 1

    def flush(self):
        with self._lock:
            if not self._buffer:
                return
            to_flush = dict(self._buffer)
            self._buffer = defaultdict(lambda: defaultdict(int))

        try:
            with get_pg() as conn:
                cur = conn.cursor()
                for origin, columns in to_flush.items():
                    set_clauses = ", ".join(
                        f"{col} = daily_counters.{col} + %s" for col in columns
                    )
                    col_names = ", ".join(columns.keys())
                    placeholders = ", ".join(["%s"] * len(columns))
                    counts = list(columns.values())

                    cur.execute(
                        f"INSERT INTO daily_counters (counter_date, origin_type, {col_names}) "
                        f"VALUES (CURRENT_DATE, %s, {placeholders}) "
                        f"ON CONFLICT (counter_date, origin_type) "
                        f"DO UPDATE SET {set_clauses}",
                        [origin] + counts + counts,
                    )
            logger.info("[Analytics] Flushed daily counters: %d origins", len(to_flush))
        except Exception:
            with self._lock:
                for origin, columns in to_flush.items():
                    for col, count in columns.items():
                        self._buffer[origin][col] += count
            logger.exception("[Analytics] Failed to flush daily counters, will retry")

    def _start_flush_timer(self):
        self._timer = threading.Timer(self._flush_interval, self._on_timer)
        self._timer.daemon = True
        self._timer.start()

    def _on_timer(self):
        self.flush()
        self._start_flush_timer()


_counter_buffer = _DailyCounterBuffer(flush_interval=15)
atexit.register(_counter_buffer.flush)

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
    # Achievement-bridged events (quest-tracked actions)
    "annotations_played":           {"label": "Annotations Played",         "daily_col": None},
    "custom_project_viewed":        {"label": "Custom Project Viewed",      "daily_col": None},
    "gallery_watched_1s":           {"label": "Gallery Watched 1s",         "daily_col": None},
    "gallery_watched_after_overlays": {"label": "Gallery Watched (Overlays)", "daily_col": None},
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

CREDIT_AMOUNT_TO_CENTS = {
    120: 499,
    400: 1299,
    1000: 2499,
}


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
        _counter_buffer.increment(origin, "signups")
        _counter_buffer.increment("all", "signups")
        logger.info("[Analytics] Created segment: user=%s origin=%s referrer=%s method=%s", user_id, origin, referrer_id, signup_method)
    except Exception:
        logger.exception("[Analytics] Failed to create segment for %s", user_id)


def record_milestone(user_id: str, event: str, context: dict | None = None):
    try:
        cfg = FLOW_EVENTS.get(event)
        if not cfg:
            logger.warning("[Analytics] Unknown event: %s", event)
            return

        try:
            platform = get_current_platform()
        except Exception:
            platform = "unknown"

        with get_pg() as conn:
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO user_actions (user_id, action, platform)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, action, platform)
                DO UPDATE SET count = user_actions.count + 1
            """, (user_id, event, platform))

            cur.execute(
                "UPDATE user_segments SET last_active_at = now() WHERE user_id = %s",
                (user_id,),
            )

            daily_col = cfg["daily_col"]
            if daily_col:
                cur.execute(
                    "SELECT origin FROM user_segments WHERE user_id = %s",
                    (user_id,),
                )
                row = cur.fetchone()
                if row:
                    _counter_buffer.increment(row["origin"], daily_col)
                    _counter_buffer.increment("all", daily_col)

        logger.info("[Analytics] Recorded: event=%s user=%s", event, user_id)
    except Exception:
        logger.exception("[Analytics] Failed to record %s for %s", event, user_id)
        return

    try:
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(user_id) as conn:
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            conn.execute(
                "INSERT INTO user_action_log (action, context, created_at) VALUES (?, ?, ?)",
                (event, json.dumps(context) if context else None, now),
            )
            conn.commit()
    except Exception:
        logger.warning("[Analytics] SQLite sync failed for record_milestone user=%s event=%s", user_id, event)


def update_session(user_id: str, is_pwa: bool = False):
    total_usage_seconds = 0
    try:
        platform = get_current_platform()
    except Exception:
        platform = "unknown"

    try:
        with get_pg() as conn:
            cur = conn.cursor()

            cur.execute(
                """SELECT
                       last_active_at < now() - INTERVAL '30 minutes' AS is_new_session,
                       current_session_start,
                       last_active_at,
                       total_usage_seconds
                   FROM user_segments WHERE user_id = %s""",
                (user_id,),
            )
            seg_row = cur.fetchone()
            if not seg_row:
                return

            is_new_session = seg_row["is_new_session"]
            current_session_start = seg_row["current_session_start"]
            last_active_at = seg_row["last_active_at"]
            total_usage_seconds = seg_row["total_usage_seconds"]

            if is_new_session:
                if current_session_start is not None and last_active_at is not None:
                    prev_duration = int((last_active_at - current_session_start).total_seconds())
                    if prev_duration > 0:
                        total_usage_seconds += prev_duration
                cur.execute(
                    """UPDATE user_segments
                       SET last_active_at = now(),
                           current_session_start = now(),
                           total_usage_seconds = %s
                       WHERE user_id = %s""",
                    (total_usage_seconds, user_id),
                )
            elif current_session_start is None:
                cur.execute(
                    """UPDATE user_segments
                       SET last_active_at = now(),
                           current_session_start = now()
                       WHERE user_id = %s""",
                    (user_id,),
                )
            else:
                cur.execute(
                    "UPDATE user_segments SET last_active_at = now() WHERE user_id = %s",
                    (user_id,),
                )

            cur.execute("""
                INSERT INTO user_actions (user_id, action, platform, count, first_at)
                VALUES (%s, 'session_started', %s, 1, now())
                ON CONFLICT (user_id, action, platform)
                DO UPDATE SET count = CASE
                    WHEN %s THEN user_actions.count + 1
                    ELSE user_actions.count
                END
            """, (user_id, platform, is_new_session))

            if is_pwa:
                cur.execute("""
                    INSERT INTO user_actions (user_id, action, platform, count, first_at)
                    VALUES (%s, 'pwa_session_started', %s, 1, now())
                    ON CONFLICT (user_id, action, platform)
                    DO UPDATE SET count = CASE
                        WHEN %s THEN user_actions.count + 1
                        ELSE user_actions.count
                    END
                """, (user_id, platform, is_new_session))

            if is_new_session:
                cur.execute(
                    "SELECT origin FROM user_segments WHERE user_id = %s",
                    (user_id,),
                )
                origin_row = cur.fetchone()
                if origin_row:
                    _counter_buffer.increment(origin_row["origin"], "sessions_started")
                    _counter_buffer.increment("all", "sessions_started")

            cur.execute(
                "SELECT action, SUM(count) AS count FROM user_actions WHERE user_id = %s AND action IN ('session_started', 'pwa_session_started') GROUP BY action",
                (user_id,),
            )
            counts = {r["action"]: r["count"] for r in cur.fetchall()}
            session_count = counts.get("session_started", 0)
            pwa_session_count = counts.get("pwa_session_started", 0)

            pwa_info = f" pwa_sessions={pwa_session_count}" if is_pwa else ""
            logger.info("[Analytics] Session update: user=%s session_count=%s platform=%s usage=%ss%s", user_id, session_count, platform, total_usage_seconds, pwa_info)
    except Exception:
        logger.exception("[Analytics] Failed to update session for %s", user_id)
        return

    if is_new_session:
        try:
            from app.services.user_db import get_user_db_connection
            with get_user_db_connection(user_id) as conn:
                now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                conn.execute(
                    "INSERT INTO user_action_log (action, context, created_at) VALUES (?, ?, ?)",
                    ("session_started", json.dumps({"is_pwa": is_pwa}), now),
                )
                conn.commit()
        except Exception:
            logger.warning("[Analytics] SQLite sync failed for update_session user=%s", user_id)


def close_session(user_id: str):
    """Close the current session and accumulate usage. Called on logout."""
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT current_session_start, last_active_at, total_usage_seconds
                   FROM user_segments WHERE user_id = %s""",
                (user_id,),
            )
            row = cur.fetchone()
            if not row or not row["current_session_start"]:
                return

            last_active = row["last_active_at"] or row["current_session_start"]
            duration = max(0, int((last_active - row["current_session_start"]).total_seconds()))
            total = (row["total_usage_seconds"] or 0) + duration

            cur.execute(
                """UPDATE user_segments
                   SET total_usage_seconds = %s,
                       current_session_start = NULL,
                       last_active_at = now()
                   WHERE user_id = %s""",
                (total, user_id),
            )
            logger.info("[Analytics] Session closed: user=%s duration=%ss total=%ss", user_id, duration, total)
    except Exception:
        logger.exception("[Analytics] Failed to close session for %s", user_id)


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
