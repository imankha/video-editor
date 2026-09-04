import atexit
import json
import logging
import re
import threading
from collections import defaultdict
from datetime import UTC, datetime

from app.migrations import MigrationBlocked
from app.services.pg import get_pg
from app.user_context import (
    get_current_impersonator_id,
    get_current_platform,
    get_current_user_id,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Engaged-time accounting (T5660)
# ---------------------------------------------------------------------------
# ONE cap constant, shared by the write side (this module) and the read side
# (admin.py). It is BOTH the new-session boundary (activity older than the cap
# starts a fresh session) AND the ceiling on the unconfirmed tail credited to a
# still-open session at read time. Keeping a single constant is what makes the
# write model and the read estimate symmetric — the asymmetry between an
# uncapped write and a capped read was the original inversion bug (D1).
SESSION_IDLE_CAP_SECONDS = 1800  # 30 minutes


def session_engaged_seconds(session_start, last_active, now=None) -> int:
    """Engaged seconds credited to a single session.

    ``confirmed`` = ``last_active - session_start``. This is left UNCAPPED on
    purpose: activity (the ~60s foreground heartbeat, plus /me pings and
    milestones) keeps ``last_active`` fresh, and the ``SESSION_IDLE_CAP_SECONDS``
    new-session boundary guarantees consecutive activities inside one session are
    never more than the cap apart. So the confirmed span can never already
    contain an idle gap larger than the cap — no per-gap trim is needed on it,
    and a genuinely heavy continuous user is not clamped to the cap (fixes D1).

    ``tail`` = ``now - last_active``. The UNCONFIRMED gap since the last recorded
    activity, relevant only when estimating a still-open session at read time. It
    is credited only while within the cap; beyond the cap the session is treated
    as abandoned and the idle tail is trimmed to zero rather than counted as
    engaged time (fixes D4). Pass ``now=None`` when banking a session that has
    already ended (its ``last_active`` is the true end) so no tail is added.
    """
    if not session_start:
        return 0
    last_active = last_active or session_start
    confirmed = max(0, int((last_active - session_start).total_seconds()))
    if now is None:
        return confirmed
    tail = max(0, int((now - last_active).total_seconds()))
    if tail > SESSION_IDLE_CAP_SECONDS:
        # Abandoned tab / dead session: the idle gap beyond the cap is not engaged
        # time. Trim it entirely instead of clamping to the cap (clamping would
        # itself over-count idle by up to the full cap — the D4 over-count).
        tail = 0
    return confirmed + tail


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
                        [origin, *counts, *counts],
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
    # T7510: game_created fires on the PENDING game insert (games.py create_game)
    # BEFORE any bytes reach R2 — it is an ATTEMPT, not a durable upload. The
    # durable success is game_upload_succeeded (finalize_upload). Relabeled so the
    # funnel/journey stop counting attempts as uploads (the reported prod lie).
    "game_created":         {"label": "Upload Attempted",   "daily_col": "games_created"},
    "clip_created":         {"label": "Clipped",            "daily_col": "clips_created"},
    # T7860 reserved this name + funnel position; T8370 SHIPS it (POST
    # /api/clips/upload records one per landed clip) and adds the
    # daily_counters.clips_uploaded column (postgres v027) that T7860
    # deliberately deferred to avoid a dead column. Distinct origin dimension
    # from clip_created (annotation-sourced) — that event is untouched.
    "clip_uploaded":        {"label": "Clip Uploaded",      "daily_col": "clips_uploaded"},
    "export_completed":     {"label": "Exported",           "daily_col": "exports_completed"},
    "export_failed":        {"label": None,                 "daily_col": "exports_failed"},
    "share_completed":      {"label": "Shared",             "daily_col": "shares_completed"},
    "credit_purchased":     {"label": "Purchased",          "daily_col": "credit_purchases"},
    "credits_consumed":     {"label": None,                 "daily_col": "credits_consumed"},
    "pwa_installed":        {"label": "PWA Installed",      "daily_col": None},
    # New flow events (T3040)
    # T7930: LABEL renamed "Annotation Done" -> "Watched Annotate Video". This
    # event fires from POST /{game_id}/finish-annotation purely on
    # viewed_duration > 0 (games.py) — a user watching the Annotate video, with
    # ZERO raw_clips required. The old label read as "a clip was created" on every
    # dashboard (funnel/last-step badge/platform table), which is what prompted the
    # 2026-08-27 user report (accounts with no visible clip showing "Annotation
    # Done"). It joins the sibling "Watched * Tutorial" engagement family below.
    # The event KEY (annotation_completed) and daily_col (annotations_completed)
    # are UNCHANGED on purpose — they are stored history in user_actions /
    # daily_counters; a key/column rename would sever the time series. The funnel
    # step key is derived at READ time from this label (admin.py:
    # label.lower().replace(" ", "_")), so it becomes "watched_annotate_video" —
    # FunnelChart.jsx / UserTable.jsx step-style map updated to match.
    "annotation_completed": {"label": "Watched Annotate Video", "daily_col": "annotations_completed"},
    "framing_opened":       {"label": "Focus Opened",       "daily_col": None},
    "framing_exported":     {"label": "Focus Exported",     "daily_col": "framing_exports"},
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
    # T3700: per-step framing/overlay drop-off events
    "overlay_opened":               {"label": "Overlay Opened",             "daily_col": None},
    # T8520: overlay-is-an-offer completion-choice funnel (engagement dims, no
    # daily_col, reuse user_actions). Sum invariant:
    # overlay_offered = overlay_deferred + overlay_declined + <"Add Spotlight",
    # which reuses overlay_opened>. If they stop summing, an exit path is unrecorded.
    "overlay_offered":              {"label": "Overlay Offered",            "daily_col": None},
    "overlay_deferred":             {"label": "Overlay Deferred",           "daily_col": None},
    "overlay_declined":             {"label": "Overlay Declined",           "daily_col": None},
    "crop_adjusted":                {"label": "Crop Adjusted",              "daily_col": None},
    "speed_segment_created":        {"label": "Slow-mo Added",              "daily_col": None},
    "overlay_players_assigned":     {"label": "Players Spotlighted",        "daily_col": None},
    "overlay_color_set":            {"label": "Highlight Color Set",        "daily_col": None},
    "overlay_shape_set":            {"label": "Highlight Shape Set",        "daily_col": None},
    # T7510: attempt/outcome/failure taxonomy. Every funnel action gets an
    # ATTEMPT (gesture-time) and, at its durable completion point, EITHER a
    # _succeeded OR a _failed carrying a machine-readable reason (see MILESTONE_REASONS).
    # Failure reason is encoded into the stored action name as "{event}:{reason}"
    # (record_milestone `reason=`), so per-reason breakdowns are queryable in the
    # user_actions aggregate while the daily_col below rolls all reasons into one.
    "game_upload_succeeded":        {"label": "Uploaded",                   "daily_col": "game_uploads_succeeded"},
    "game_upload_failed":           {"label": "Upload Failed",              "daily_col": "game_uploads_failed"},
    "clip_save_attempted":          {"label": "Clip Attempted",             "daily_col": "clips_attempted"},
    "clip_save_failed":             {"label": "Clip Failed",                "daily_col": "clips_failed"},
    # T8370: the same attempt/outcome/failure triple as game_created/
    # game_upload_succeeded/game_upload_failed, for the clip-upload path — a
    # success-only event would make the clip-upload success rate 100% by
    # construction (the exact lie T7510 fixed for games). clip_upload_attempted
    # fires from the T8380 "Add Clip" gesture (before prepare-upload); this task
    # ships the durable outcome pair (clip_uploaded / clip_upload_failed).
    "clip_upload_attempted":        {"label": "Clip Upload Attempted",      "daily_col": None},
    "clip_upload_failed":           {"label": "Clip Upload Failed",         "daily_col": None},
    "share_attempted":              {"label": "Share Attempted",            "daily_col": None},
    "move_attempted":               {"label": "Move Attempted",             "daily_col": None},
    "move_succeeded":               {"label": "Moved to Reels",             "daily_col": None},
    "payment_failed":               {"label": "Payment Failed",             "daily_col": None},
    # T7890: pre-upload funnel beacons. Everything before game_created (the
    # "Upload Attempted" pending insert) was previously dark, so a signup who
    # bailed before the prepare POST was indistinguishable from one who never
    # clicked Add Game. These two frontend gestures now bridge through
    # record_milestone (impersonation-guarded) into user_actions. Read side is
    # the existing user_actions aggregate (per-user first_at + count) — no
    # daily_col / day-grain needed, so no daily_counters column and no migration.
    # Interpretation contract: add_game_opened WITHOUT upload_file_selected =
    # picker/entry failure or bail; upload_file_selected WITHOUT game_created =
    # pre-prepare death (JS error, validation, navigation). picker-abandoned is
    # NOT instrumented (no reliable browser cancel event) — derive it in reads as
    # add_game_opened - upload_file_selected.
    "add_game_opened":              {"label": "Add Game Opened",            "daily_col": None},
    "upload_file_selected":         {"label": "File Selected",              "daily_col": None},
    # T7510: previously-dropped engagement milestones (frontend achievements
    # bridged to these names, which were absent from FLOW_EVENTS -> "Unknown
    # event" drops). Registered as engagement dimensions (no daily rollup).
    "add_clip_opened":              {"label": "Add Clip Opened",            "daily_col": None},
    "watched_annotate_tutorial":    {"label": "Watched Annotate Tutorial",  "daily_col": None},
    "watched_framing_tutorial":     {"label": "Watched Framing Tutorial",   "daily_col": None},
    "watched_overlay_tutorial":     {"label": "Watched Overlay Tutorial",   "daily_col": None},
    "watched_publish_tutorial":     {"label": "Watched Publish Tutorial",   "daily_col": None},
}

# T7510: closed vocabulary of coarse, machine-readable failure reasons. Encoded
# into the stored action name for a failed attempt (e.g. game_upload_failed:timeout)
# so "what did users try that didn't work" is queryable per reason.
MILESTONE_REASONS = frozenset({
    "timeout",         # client gave up / server slow
    "network",         # transport dropped
    "refused",         # server/validation rejection (quota, format, 4xx)
    "sync_failed",     # R2 CAS / durable-sync refusal
    "user_abandoned",  # reaped pending / navigated away
    "r2_rejected",     # T8170: an R2 part PUT itself returned a non-2xx (e.g. the
                        # T8160 self-abort's 404 NoSuchUpload) -- NOT a dropped
                        # transport, distinct from "network" so diagnosis doesn't
                        # get pointed at users' connections for our own bug
    "unknown",         # uncaught
})

FUNNEL_STEPS = [
    "session_started",
    "add_game_opened",        # T7890: pre-upload entry gesture (Add Game click)
    "upload_file_selected",   # T7890: file chosen, before the prepare POST
    "game_created",           # T7510: upload ATTEMPT (pending insert)
    "game_upload_succeeded",  # T7510: durable upload OUTCOME (finalize)
    "clip_created",
    "clip_uploaded",          # T7860 reserved, T8370 ships: direct-upload origin
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


# ---------------------------------------------------------------------------
# Referrer-host attribution buckets (T7910)
# ---------------------------------------------------------------------------
# SHARED CONSTANT — the single server-side source of truth mapping a referrer
# hostname to an attribution bucket. T7410 (first-party visit beacon) is specced
# to reuse this EXACT mapping via bucket_referrer_host(); do NOT fork it.
#
# Keys are registrable-domain suffixes: a host matches a key when it equals the
# key or ends with "." + key, AFTER a leading www./m./l./lm. label is stripped
# (see bucket_referrer_host). A referrer is only ever a HINT (privacy settings
# and Referrer-Policy strip it), so partial coverage is fine — an unlisted host
# buckets to "organic", never a wrong channel. Extend the dict as data warrants.
REFERRER_HOST_BUCKETS: dict[str, str] = {
    # --- search engines -> seo ---
    "google.com": "seo",
    "bing.com": "seo",
    "duckduckgo.com": "seo",
    "search.yahoo.com": "seo",
    "yahoo.com": "seo",
    "yandex.com": "seo",
    "yandex.ru": "seo",
    "baidu.com": "seo",
    "ecosia.org": "seo",
    "search.brave.com": "seo",
    # --- social networks -> social-<network> ---
    "instagram.com": "social-instagram",
    "facebook.com": "social-facebook",
    "fb.com": "social-facebook",
    "fb.me": "social-facebook",
    "twitter.com": "social-twitter",
    "x.com": "social-twitter",
    "t.co": "social-twitter",
    "tiktok.com": "social-tiktok",
    "youtube.com": "social-youtube",
    "youtu.be": "social-youtube",
    "linkedin.com": "social-linkedin",
    "lnkd.in": "social-linkedin",
    "pinterest.com": "social-pinterest",
    "snapchat.com": "social-snapchat",
    "threads.net": "social-threads",
    "threads.com": "social-threads",
    # --- communities / forums -> community ---
    "reddit.com": "community",
    "news.ycombinator.com": "community",
    "discord.com": "community",
    "discord.gg": "community",
    "quora.com": "community",
    "whatsapp.com": "community",
    "telegram.org": "community",
    "t.me": "community",
}

# International Google ccTLDs (google.co.uk, google.de, ...) are too many to
# enumerate; a leading "google." host is treated as search regardless of TLD.
_GOOGLE_HOST_RE = re.compile(r'^google\.[a-z.]+$')


def bucket_referrer_host(host: str | None) -> str | None:
    """Map an external referrer hostname to an attribution bucket, or None.

    Returns one of ``seo`` / ``social-<network>`` / ``community`` for a known
    host, else ``None`` (caller falls back to ``organic``). Hostname only — no
    query strings or paths are ever consulted. Shared with T7410.
    """
    if not host:
        return None
    host = host.strip().lower().rstrip(".")
    if ":" in host:  # strip an accidental :port
        host = host.split(":", 1)[0]
    # Normalize a leading mobile/link-shim label so m.facebook.com etc. match.
    for prefix in ("www.", "m.", "l.", "lm."):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    if host in REFERRER_HOST_BUCKETS:
        return REFERRER_HOST_BUCKETS[host]
    for key, bucket in REFERRER_HOST_BUCKETS.items():
        if host.endswith("." + key):
            return bucket
    if host == "google" or _GOOGLE_HOST_RE.match(host):
        return "seo"
    return None


def _determine_origin(
    user_id: str,
    ref: str | None,
    utm_campaign: str | None = None,
    click_source: str | None = None,
    referrer_host: str | None = None,
) -> tuple[str, str | None]:
    """Determine origin and referrer_id for a new user.

    Priority: ref invite code -> ref campaign ID -> utm_campaign ->
    share-based -> click_source fallback -> referrer host -> organic.

    ``referrer_host`` (T7910) is the LOWEST-priority signal: it only ever breaks
    the ``organic`` fallback into seo/social/community, never overriding a real
    campaign/invite/click signal above it.
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

    referrer_bucket = bucket_referrer_host(referrer_host)
    if referrer_bucket:
        return referrer_bucket, None

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


def record_milestone(
    user_id: str, event: str, context: dict | None = None, reason: str | None = None
):
    """Record a milestone / funnel event.

    T7510: `reason` marks a FAILED attempt with a coarse, machine-readable cause
    (must be in ``MILESTONE_REASONS``). The stored action name becomes
    ``"{event}:{reason}"`` so per-reason breakdowns are queryable in the
    ``user_actions`` aggregate (e.g. ``LIKE 'game_upload_failed:%'``), while the
    daily counter for the base event rolls all reasons together. ``event`` itself
    must be a base key in ``FLOW_EVENTS``; the reason is validated but never
    invents a new base dimension.
    """
    # T1515: don't attribute admin impersonation actions to the user's analytics.
    impersonator = get_current_impersonator_id()
    if impersonator:
        logger.debug("[Analytics] Skipped milestone %s for %s during impersonation by %s", event, user_id, impersonator)
        return
    try:
        cfg = FLOW_EVENTS.get(event)
        if not cfg:
            logger.warning("[Analytics] Unknown event: %s", event)
            return

        if reason is not None and reason not in MILESTONE_REASONS:
            # A bad reason is an internal bug, not external data — fail loudly
            # rather than silently coining a new dimension (coding-standards §5).
            logger.warning("[Analytics] Unknown failure reason %r for event %s", reason, event)
            reason = "unknown"
        action = f"{event}:{reason}" if reason else event

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
            """, (user_id, action, platform))

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

        logger.info("[Analytics] Recorded: action=%s user=%s", action, user_id)
    except Exception:
        logger.exception("[Analytics] Failed to record %s for %s", action, user_id)
        return

    try:
        from app.services.user_db import get_user_db_connection
        # T7510: the per-user journey trail carries the reason-encoded action AND
        # the reason in context, so the admin journey view can show the failure
        # cause without re-parsing the action string.
        log_context = dict(context) if context else {}
        if reason:
            log_context["reason"] = reason
        with get_user_db_connection(user_id) as conn:
            now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            conn.execute(
                "INSERT INTO user_action_log (action, context, created_at) VALUES (?, ?, ?)",
                (action, json.dumps(log_context) if log_context else None, now),
            )
            conn.commit()
    except MigrationBlocked as e:
        # T5085: this user.sqlite is below head on this machine and could not
        # be migrated -- the row is NOT written. record_milestone's contract
        # is "never raises" (webhook/background-task/admin-read callers have
        # nothing sensible to do with a raise), so this stays non-fatal, but
        # a dropped analytics write must be LOUD, not folded into the generic
        # warning below (EPIC decision 6 — no silent fallback).
        logger.critical(
            "[Migration] ANALYTICS_WRITE_DROPPED user=%s action=%s reason=%s — "
            "user.sqlite is below head on this machine; the row was NOT written",
            user_id, action, e.reason,
        )
    except Exception:
        logger.warning("[Analytics] SQLite sync failed for record_milestone user=%s action=%s", user_id, action)


# ---------------------------------------------------------------------------
# T7515 — frustration mid-funnel instrumentation (tiers 3 + 4)
# ---------------------------------------------------------------------------
# These reuse T7510's storage EXACTLY — the free-text `user_actions` aggregate
# (counts, no per-event rows) plus the per-user `user_action_log` detail trail —
# and copy record_milestone's impersonation guard verbatim. They are SEPARATE
# functions (not record_milestone calls) only because record_milestone gates its
# `event` on the CLOSED FLOW_EVENTS funnel vocabulary, whereas a dialog/toast
# name is OPEN-ended. Neither adds a Postgres column or table (no migration):
# `user_actions.action` and `user_action_log.action` are both free text, so a new
# action string is a new row, exactly like T7510's `game_upload_failed:{reason}`.

# Blocking surfaces we count impressions for. Kept closed so a stray beacon can't
# invent a new kind (the NAME within a kind is open, the kind is not).
IMPRESSION_KINDS = frozenset({"toast", "dialog"})

# Screens a session-exit breadcrumb may name (mirrors the frontend EDITOR_MODES).
# Bounding the trail/dwell keys keeps the per-user log free of junk/PII.
BREADCRUMB_SCREENS = frozenset({
    "framing", "overlay", "annotate", "project-manager", "admin",
})

_IMPRESSION_NAME_RE = re.compile(r"[^a-z0-9]+")


def _slugify_impression_name(name: str) -> str:
    """Coarse, bounded, PII-free slug for an impression name.

    Toast/dialog titles are short static strings ("Tag not submitted"), so a
    lowercase alnum slug truncated to 48 chars keeps the `user_actions`
    vocabulary bounded while staying human-readable in the admin log.
    """
    slug = _IMPRESSION_NAME_RE.sub("_", (name or "").strip().lower()).strip("_")
    return slug[:48] or "unnamed"


def record_impression(kind: str, name: str, session_count: int | None = None):
    """T7515 tier 3: count a blocking-dialog / error-toast IMPRESSION.

    Fires from the SHOW gesture (the surface actually rendering to the user), NOT
    from a reactive state watch. Increments a per-name row in the `user_actions`
    aggregate (`"{kind}_impression:{slug}"`, e.g. ``dialog_impression:tag_not_submitted``)
    so a repeated refusal in one session — the T7540 tag-trap's "shown 5x, saved
    0" — is queryable via ``LIKE 'dialog_impression:%'``, mirroring T7510's
    per-reason failure rows. The per-session repetition count and the original
    name ride the `user_action_log` detail trail. No daily_counters column, no
    migration. Never raises.
    """
    impersonator = get_current_impersonator_id()
    if impersonator:
        logger.debug("[Analytics] Skipped impression %s/%s during impersonation by %s", kind, name, impersonator)
        return

    if kind not in IMPRESSION_KINDS:
        logger.warning("[Analytics] Unknown impression kind: %r", kind)
        return

    slug = _slugify_impression_name(name)
    action = f"{kind}_impression:{slug}"

    try:
        user_id = get_current_user_id()
    except RuntimeError:
        logger.warning("[Analytics] impression %s with no user context — dropped", action)
        return

    try:
        platform = get_current_platform()
    except Exception:
        platform = "unknown"

    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO user_actions (user_id, action, platform)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, action, platform)
                DO UPDATE SET count = user_actions.count + 1
            """, (user_id, action, platform))
        logger.info("[Analytics] Impression: action=%s user=%s session_count=%s", action, user_id, session_count)
    except Exception:
        logger.exception("[Analytics] Failed to record impression %s for %s", action, user_id)
        return

    try:
        from app.services.user_db import get_user_db_connection
        log_context = {"kind": kind, "name": (name or "")[:120]}
        if session_count is not None:
            log_context["session_count"] = session_count
        with get_user_db_connection(user_id) as conn:
            now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            conn.execute(
                "INSERT INTO user_action_log (action, context, created_at) VALUES (?, ?, ?)",
                (action, json.dumps(log_context), now),
            )
            conn.commit()
    except MigrationBlocked as e:
        # T5085: see record_milestone's identical handler above.
        logger.critical(
            "[Migration] ANALYTICS_WRITE_DROPPED user=%s action=%s reason=%s — "
            "user.sqlite is below head on this machine; the row was NOT written",
            user_id, action, e.reason,
        )
    except Exception:
        logger.warning("[Analytics] SQLite sync failed for impression user=%s action=%s", user_id, action)


def record_session_exit(
    user_id: str,
    last_screen: str | None,
    dwell: dict[str, float] | None,
    trail: list[str] | None,
):
    """T7515 tier 4: write a session-exit BREADCRUMB to the user's own log.

    Per-event detail (last screen + per-screen dwell + the ordered screen trail)
    lives ONLY in the per-user `user_action_log` (user.sqlite) — Postgres stays
    aggregate-only, so there is no PG write here at all. Fired from the tab-close /
    visibility→hidden lifecycle event (a real exit gesture), never a reactive
    watch. Copies record_milestone's impersonation guard verbatim because it does
    not route through it. Inputs are sanitized/bounded (unknown screens dropped,
    dwell clamped) since they arrive from an unauthenticated-tolerant beacon.
    Never raises.
    """
    impersonator = get_current_impersonator_id()
    if impersonator:
        logger.debug("[Analytics] Skipped session-exit breadcrumb for %s during impersonation by %s", user_id, impersonator)
        return

    # Bound everything the beacon supplied to the known screen vocabulary.
    clean_last = last_screen if last_screen in BREADCRUMB_SCREENS else None
    clean_dwell = {
        s: round(float(secs), 1)
        for s, secs in (dwell or {}).items()
        if s in BREADCRUMB_SCREENS and isinstance(secs, (int, float)) and 0 <= secs < 86400
    }
    clean_trail = [s for s in (trail or []) if s in BREADCRUMB_SCREENS][:50]

    if not clean_last and not clean_dwell and not clean_trail:
        # Nothing usable — don't write an empty breadcrumb row.
        return

    try:
        from app.services.user_db import get_user_db_connection
        log_context = {"last_screen": clean_last, "dwell": clean_dwell, "trail": clean_trail}
        with get_user_db_connection(user_id) as conn:
            now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            conn.execute(
                "INSERT INTO user_action_log (action, context, created_at) VALUES (?, ?, ?)",
                ("session_exit", json.dumps(log_context), now),
            )
            conn.commit()
        logger.info("[Analytics] Session-exit breadcrumb: user=%s last=%s screens=%d", user_id, clean_last, len(clean_trail))
    except MigrationBlocked as e:
        # T5085: see record_milestone's identical handler above.
        logger.critical(
            "[Migration] ANALYTICS_WRITE_DROPPED user=%s action=session_exit reason=%s — "
            "user.sqlite is below head on this machine; the row was NOT written",
            user_id, e.reason,
        )
    except Exception:
        logger.warning("[Analytics] SQLite sync failed for session-exit breadcrumb user=%s", user_id)


def share_view_counts(sharer_user_id: str, tokens: list[str]) -> dict[str, int] | None:
    """Per-link `share_viewed` counts for the T5740 admin funnel (read-only).

    share_viewed milestones are logged per-event in the sharer's per-user SQLite
    (record_milestone -> user_action_log) with the share_token in `context`. T5740
    reads them back rather than adding a second counter (the beacon already exists).
    This is an admin READ, never on a user-facing response path (T4840).

    Returns {token: view_count} (missing tokens = 0 views), or None if the sharer's
    DB can't be opened -- an honest 'unknown', never a silent 0 that would read as
    'nobody watched'."""
    if not tokens:
        return {}
    try:
        from app.services.user_db import get_user_db_connection
        placeholders = ",".join("?" * len(tokens))
        with get_user_db_connection(sharer_user_id) as conn:
            rows = conn.execute(
                f"""SELECT json_extract(context, '$.share_token') AS token,
                           COUNT(*) AS views
                    FROM user_action_log
                    WHERE action = 'share_viewed'
                      AND json_extract(context, '$.share_token') IN ({placeholders})
                    GROUP BY token""",
                tokens,
            ).fetchall()
        return {row[0]: row[1] for row in rows}
    except MigrationBlocked as e:
        # T5085: honest 'unknown' (same contract as the except Exception
        # below) rather than a silent 0 that would read as "nobody watched".
        logger.critical(
            "[Migration] ANALYTICS_READ_BLOCKED sharer=%s reason=%s — user.sqlite "
            "is below head on this machine; share_view_counts unavailable",
            sharer_user_id, e.reason,
        )
        return None
    except Exception:
        logger.warning(
            "[Analytics] share_view_counts failed for sharer=%s", sharer_user_id,
            exc_info=True,
        )
        return None

def add_usage_seconds(cur, user_id: str, seconds: int) -> None:
    """Single write path for engaged-usage time (T5770).

    Bumps BOTH the all-time running total (``user_segments.total_usage_seconds``)
    and today's per-day bucket (``user_usage_daily``) using the SAME cursor, so
    they join the caller's open transaction and move atomically together — the
    admin panel's all-time total and its trailing "last 7 days" figure can never
    disagree. Both callers already hold an open pg cursor, so there is no extra
    round-trip.

    ``seconds`` is the engaged span just banked (from
    :func:`session_engaged_seconds`). A 0 (an instant open/close) is a no-op — no
    empty bucket row is written.

    Day = ``CURRENT_DATE`` at write time: a session spanning midnight attributes
    its whole banked increment to the day the increment lands, not split across
    the two days. That is acceptable for admin metrics — noted, not engineered
    around.
    """
    if seconds <= 0:
        return
    cur.execute(
        "UPDATE user_segments SET total_usage_seconds = total_usage_seconds + %s "
        "WHERE user_id = %s",
        (seconds, user_id),
    )
    cur.execute(
        """INSERT INTO user_usage_daily (user_id, day, seconds)
           VALUES (%s, CURRENT_DATE, %s)
           ON CONFLICT (user_id, day)
           DO UPDATE SET seconds = user_usage_daily.seconds + %s""",
        (user_id, seconds, seconds),
    )


def update_session(user_id: str, is_pwa: bool = False):
    # T1515: an impersonating admin's requests must not bump the user's session
    # timing (last_active_at / current_session_start / total_usage_seconds).
    impersonator = get_current_impersonator_id()
    if impersonator:
        logger.debug("[Analytics] Skipped session update for %s during impersonation by %s", user_id, impersonator)
        return
    total_usage_seconds = 0
    try:
        platform = get_current_platform()
    except Exception:
        platform = "unknown"

    try:
        with get_pg() as conn:
            cur = conn.cursor()

            # T7570: FOR UPDATE closes a lost-update race that double-counted
            # sessions. update_session is reachable concurrently for the same
            # user (the /api/auth/me background task is fire-and-forget and its
            # scheduling is retried by the client's fetchWithRetry on a Fly
            # cold-start; /api/auth/heartbeat can also overlap it). Without the
            # row lock, two overlapping calls both SELECT the stale
            # last_active_at, both evaluate is_new_session=True, and both
            # increment the session_started count + write a user_action_log row
            # (~200ms apart in prod) -- inflating session counts ~2x. The lock
            # serializes the decide-and-roll: the second caller blocks, then
            # under READ COMMITTED re-reads the row after the first commits, so
            # is_new_session is now False for it. Exactly one caller records a
            # new session per genuine 30-min-idle boundary, no matter how many
            # times update_session fires. This is the single-owner fix at the
            # source, NOT a dedupe window.
            cur.execute(
                """SELECT
                       last_active_at < now() - INTERVAL '30 minutes' AS is_new_session,
                       current_session_start,
                       last_active_at,
                       total_usage_seconds
                   FROM user_segments WHERE user_id = %s
                   FOR UPDATE""",
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
                # Roll the session window forward; the just-ended session's span
                # (if any) is banked via the single usage write path so the
                # running total and the daily bucket move together (T5770).
                cur.execute(
                    """UPDATE user_segments
                       SET last_active_at = now(),
                           current_session_start = now()
                       WHERE user_id = %s""",
                    (user_id,),
                )
                if current_session_start is not None and last_active_at is not None:
                    # Bank the just-ended session (now=None -> no idle tail).
                    banked = session_engaged_seconds(
                        current_session_start, last_active_at
                    )
                    add_usage_seconds(cur, user_id, banked)
                    total_usage_seconds += banked  # keep local accurate for the log line
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
                now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                conn.execute(
                    "INSERT INTO user_action_log (action, context, created_at) VALUES (?, ?, ?)",
                    ("session_started", json.dumps({"is_pwa": is_pwa}), now),
                )
                conn.commit()
        except MigrationBlocked as e:
            # T5085: see record_milestone's identical handler above.
            logger.critical(
                "[Migration] ANALYTICS_WRITE_DROPPED user=%s action=session_started "
                "reason=%s — user.sqlite is below head on this machine; the row "
                "was NOT written",
                user_id, e.reason,
            )
        except Exception:
            logger.warning("[Analytics] SQLite sync failed for update_session user=%s", user_id)


def close_session(user_id: str):
    """Close the current session and accumulate usage.

    Called on logout AND on the tab-close beacon (T5660) — banking the last
    session no longer requires an explicit logout or a return visit (fixes D2).
    Idempotent: a session with no open ``current_session_start`` returns early, so
    a duplicate beacon + logout can't double-bank.
    """
    # T1515: a logout during impersonation must not write the user's session timing.
    impersonator = get_current_impersonator_id()
    if impersonator:
        logger.debug("[Analytics] Skipped session close for %s during impersonation by %s", user_id, impersonator)
        return
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

            # Same accounting as the read-side estimate (admin.py): confirmed span
            # plus the capped idle tail since the last heartbeat. So the banked
            # value matches what the admin panel showed for the open session.
            duration = session_engaged_seconds(
                row["current_session_start"], row["last_active_at"], datetime.now(UTC)
            )

            cur.execute(
                """UPDATE user_segments
                   SET current_session_start = NULL,
                       last_active_at = now()
                   WHERE user_id = %s""",
                (user_id,),
            )
            # Single usage write path (T5770): running total + today's bucket, one txn.
            add_usage_seconds(cur, user_id, duration)
            total = (row["total_usage_seconds"] or 0) + duration
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


def decrement_total_spent(user_id: str, amount_cents: int):
    """Decrement total_spent_cents by a refund/chargeback amount (T5760).

    Used by the ``charge.refunded`` webhook branch so steady-state drift from the
    Stripe truth stays near zero. total_spent_cents is NET of refunds, so a refund
    lowers it. Reads-then-writes (not a bare ``- %s``) so we can keep the aggregate
    from going negative — a refund larger than the recorded spend means the local
    cache was already wrong (e.g. a test-mode-era value); we log that loudly and
    floor at 0 rather than persist a nonsensical negative aggregate.
    """
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT total_spent_cents FROM user_segments WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                logger.warning("[Analytics] decrement_total_spent: no user_segments row for %s", user_id)
                return
            current = row["total_spent_cents"] or 0
            new_value = current - amount_cents
            if new_value < 0:
                logger.warning(
                    "[Analytics] Refund exceeds recorded spend for %s (current=%s refund=%s) — flooring to 0",
                    user_id, current, amount_cents,
                )
                new_value = 0
            cur.execute(
                "UPDATE user_segments SET total_spent_cents = %s WHERE user_id = %s",
                (new_value, user_id),
            )
        logger.info("[Analytics] Decremented total_spent: user=%s amount_cents=%s new=%s", user_id, amount_cents, new_value)
    except Exception:
        logger.exception("[Analytics] Failed to decrement total_spent for %s", user_id)


def set_total_spent(user_id: str, amount_cents: int):
    """Set total_spent_cents to an exact value; return the prior value (or None).

    The heal side of Stripe revenue reconciliation (T5760): an admin adopts the
    Stripe net figure (net of refunds AND lost disputes) as the local cache value.
    Explicit admin gesture only — never called reactively.
    """
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT total_spent_cents FROM user_segments WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                logger.warning("[Analytics] set_total_spent: no user_segments row for %s", user_id)
                return None
            old_value = row["total_spent_cents"] or 0
            cur.execute(
                "UPDATE user_segments SET total_spent_cents = %s WHERE user_id = %s",
                (amount_cents, user_id),
            )
        logger.info("[Analytics] Set total_spent (heal): user=%s %s -> %s", user_id, old_value, amount_cents)
        return old_value
    except Exception:
        logger.exception("[Analytics] Failed to set total_spent for %s", user_id)
        return None
