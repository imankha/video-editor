"""T7860: clip/reel lifecycle-phase inventory derivation (read-only).

Canonical, read-time derivation of how many of a user's clips and reels sit at
each lifecycle phase. Everything here is computed on demand from the tables that
already encode the phase — NO new persisted state (no-redundant-state rule) and
NO writes.

Two-tier model (user decision 2026-08-27):
  * CLIP tier — the annotation unit (``raw_clips``). Each clip is counted in
    EXACTLY ONE furthest-phase bucket: ``created`` -> ``focus_started`` ->
    ``focused`` (so the three buckets sum to the profile's clip count).
  * REEL tier — the final-render unit (``final_videos``). Each reel is counted in
    EXACTLY ONE furthest-phase bucket: ``completed`` -> ``published``. A
    multi-clip reel is a SINGLE ``final_videos`` row, so it counts as 1 (never N)
    — the core design decision.
  Orthogonal reel FLAGS (not mutually exclusive, each reel may set several):
  ``intro_explicit`` / ``intro_inherited`` / ``downloaded`` / ``shared`` /
  ``watched``.

Phase predicates — SINGLE SOURCE OF TRUTH. These mirror the ``clip_stats`` CASE
expressions in ``routers/projects.py``'s project-list query (which carries a
cross-reference comment pointing here). If the rule for focused/focus_started
ever changes, change it in BOTH places:
  * focused        = a working_clip for the raw clip has ``exported_at`` NOT NULL
  * focus_started  = not focused, but a working_clip has crop/segments/timing data
  * created        = neither (a bare ``raw_clips`` row, or one whose working_clips
                     carry no framing yet)

Intro semantics (``final_videos.intro_card_id``, raw stored value — see
downloads.py:240): ``0`` = opted out (counted in NEITHER intro flag), ``NULL`` =
inherit the profile default (``intro_inherited``), a positive id = an explicit
attachment (``intro_explicit``).
"""

from __future__ import annotations

import logging
import sqlite3

logger = logging.getLogger(__name__)


def compute_profile_phase_inventory(
    conn: sqlite3.Connection,
    downloaded_video_ids: set[int],
) -> dict:
    """Per-profile phase inventory from an ALREADY-OPEN read-only profile.sqlite.

    ``downloaded_video_ids`` is the user-level set of ``final_videos.id`` the user
    has downloaded (see :func:`gather_downloaded_video_ids`). The ``shared`` flag
    is NOT computed here (it lives in Postgres) — the orchestrator fills it in per
    profile via :func:`gather_shared_video_ids`.
    """
    cur = conn.cursor()

    # --- CLIP tier: each raw clip counted once, in its FURTHEST bucket --------
    # LEFT JOIN so a raw clip with no working_clip (or only frame-less ones)
    # collapses to 'created'. MAX(...) over the join gives the furthest phase any
    # of the clip's working_clips reached.
    cur.execute(
        """
        SELECT
          SUM(CASE WHEN phase = 'focused'        THEN 1 ELSE 0 END) AS focused,
          SUM(CASE WHEN phase = 'focus_started'  THEN 1 ELSE 0 END) AS focus_started,
          SUM(CASE WHEN phase = 'created'        THEN 1 ELSE 0 END) AS created
        FROM (
          SELECT rc.id,
            CASE
              WHEN MAX(CASE WHEN wc.exported_at IS NOT NULL THEN 1 ELSE 0 END) = 1
                THEN 'focused'
              WHEN MAX(CASE WHEN (wc.crop_data IS NOT NULL
                                   OR wc.segments_data IS NOT NULL
                                   OR wc.timing_data IS NOT NULL) THEN 1 ELSE 0 END) = 1
                THEN 'focus_started'
              ELSE 'created'
            END AS phase
          FROM raw_clips rc
          LEFT JOIN working_clips wc ON wc.raw_clip_id = rc.id
          GROUP BY rc.id
        )
        """
    )
    crow = cur.fetchone()
    clips = {
        "created": (crow["created"] if crow else 0) or 0,
        "focus_started": (crow["focus_started"] if crow else 0) or 0,
        "focused": (crow["focused"] if crow else 0) or 0,
    }

    # --- REEL tier + orthogonal flags: one final_video == one reel ------------
    cur.execute(
        "SELECT id, published_at, intro_card_id, watched_at FROM final_videos"
    )
    reels = {"completed": 0, "published": 0}
    flags = {
        "intro_explicit": 0,
        "intro_inherited": 0,
        "downloaded": 0,
        "shared": 0,  # filled in by the orchestrator (Postgres)
        "watched": 0,
    }
    for r in cur.fetchall():
        if r["published_at"] is not None:
            reels["published"] += 1
        else:
            reels["completed"] += 1

        intro = r["intro_card_id"]
        if intro is None:
            flags["intro_inherited"] += 1
        elif intro > 0:
            flags["intro_explicit"] += 1
        # intro == 0 -> opted out -> neither intro flag

        if r["watched_at"] is not None:
            flags["watched"] += 1
        if r["id"] in downloaded_video_ids:
            flags["downloaded"] += 1

    return {"clips": clips, "reels": reels, "flags": flags}


def gather_downloaded_video_ids(user_id: str) -> set[int]:
    """The ``final_videos.id`` the user has downloaded, from ``user.sqlite``.

    ``video_downloaded`` milestones store ``{"video_id": <final_video id>}`` in
    ``user_action_log.context`` (downloads.py). ``final_videos.id`` is a
    per-profile AUTOINCREMENT, so an id shared by two profiles would attribute a
    download to BOTH — accepted imprecision for an admin inventory (documented),
    never a billing figure. On read failure we log loudly and return an empty set
    (the download flag reads 0; the clip/reel counts are unaffected).
    """
    from app.services.user_db import get_user_db_connection

    ids: set[int] = set()
    try:
        with get_user_db_connection(user_id) as conn:
            rows = conn.execute(
                """SELECT DISTINCT json_extract(context, '$.video_id') AS vid
                   FROM user_action_log
                   WHERE action = 'video_downloaded'
                     AND json_extract(context, '$.video_id') IS NOT NULL"""
            ).fetchall()
        for r in rows:
            try:
                ids.add(int(r["vid"]))
            except (TypeError, ValueError):
                continue
    except Exception:
        logger.warning(
            "[clip_phases] downloaded-id gather failed for user=%s", user_id,
            exc_info=True,
        )
    return ids


def gather_shared_video_ids(user_id: str, profile_id: str) -> set[int]:
    """Distinct ``final_videos.id`` this user+profile has a LIVE video share for.

    Scoped to Postgres ``shares.sharer_profile_id`` because ``video_id`` is only
    unique within a profile. Revoked shares are excluded (a taken-back share is
    not "currently shared"). Returns an empty set on failure (logged).
    """
    from app.services.pg import get_pg

    ids: set[int] = set()
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT DISTINCT sv.video_id
                   FROM share_videos sv
                   JOIN shares s ON sv.share_id = s.id
                   WHERE s.sharer_user_id = %s
                     AND s.sharer_profile_id = %s
                     AND s.share_type = 'video'
                     AND s.revoked_at IS NULL""",
                (user_id, profile_id),
            )
            for r in cur.fetchall():
                if r["video_id"] is not None:
                    ids.add(int(r["video_id"]))
    except Exception:
        logger.warning(
            "[clip_phases] shared-id gather failed for user=%s profile=%s",
            user_id, profile_id, exc_info=True,
        )
    return ids


def compute_user_clip_phases(user_id: str, email: str | None) -> dict:
    """Whole-user phase inventory, aggregated across every profile.

    Runs entirely synchronously so the caller can offload it with a SINGLE
    ``asyncio.to_thread`` — sqlite3 connections are thread-affine, so opening,
    reading and closing each profile DB must happen on the same thread. Opens
    each ``profile.sqlite`` ``mode=ro`` through the shared connection path
    (:func:`open_profile_db_readonly`) — no writes, no R2 sync side effects.

    A profile whose DB cannot be opened/read is skipped (logged), never counted
    as empty.
    """
    from app.services.materialization import open_profile_db_readonly
    from app.services.user_db import get_profiles

    downloaded_ids = gather_downloaded_video_ids(user_id)

    profiles_out: list[dict] = []
    for profile in get_profiles(user_id):
        profile_id = profile["id"]
        conn = open_profile_db_readonly(user_id, profile_id)
        if conn is None:
            logger.warning(
                "[clip_phases] could not open profile %s for user %s (skipped)",
                profile_id, user_id,
            )
            continue
        try:
            inv = compute_profile_phase_inventory(conn, downloaded_ids)
        except Exception:
            logger.warning(
                "[clip_phases] read failed for profile %s user %s (skipped)",
                profile_id, user_id, exc_info=True,
            )
            continue
        finally:
            conn.close()

        inv["flags"]["shared"] = len(gather_shared_video_ids(user_id, profile_id))
        inv["profile_id"] = profile_id
        profiles_out.append(inv)

    def _sum(section: str, key: str) -> int:
        return sum(p[section][key] for p in profiles_out)

    return {
        "user_id": user_id,
        "email": email,
        "clips": {k: _sum("clips", k) for k in ("created", "focus_started", "focused")},
        "reels": {k: _sum("reels", k) for k in ("completed", "published")},
        "flags": {
            k: _sum("flags", k)
            for k in ("intro_explicit", "intro_inherited", "downloaded", "shared", "watched")
        },
        "profiles": profiles_out,
    }
