"""
Collections summary endpoint (T3610).

Aggregates the published, latest-version final_videos into everything the
Collections tab needs in ONE DB pass + one Python pass (summary-first, EPIC #13):
per-game buckets, the Mixes bucket, season totals, and per-tag totals -- each
split by aspect ratio, with a server-computed eligibility flag (a (scope, ratio)
is a collection only once it has >= COLLECTION_MIN_DURATION_SEC of content).

Game attribution reads the FROZEN final_videos.game_ids BLOB (T3605) via
collection_metadata.route_game_ids -- the SAME read path as the game_id/mixes
filters on GET /api/downloads, so member counts always equal summary counts.

JSON over the wire like every other endpoint (no msgpack transport; the
game_ids/tags BLOBs are on-disk storage only, decoded in Python here).
"""

import asyncio
import hashlib
import json
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.analytics import record_milestone
from app.database import get_db_connection
from app.migrations import MigrationBlocked
from app.profile_context import get_current_profile_id
from app.queries import exclude_teammate_reels_clause, latest_final_videos_subquery
from app.services.collection_metadata import ORDER_BY_RANK, route_collection
from app.services.intro_cards import (
    collection_intro_settings_key,
    get_collection_intro_card_id,
    resolve_intro_card,
    set_collection_intro_card_id,
)
from app.services.intro_egress import _load_field_values, build_intro_playback_payload
from app.services.materialization import open_profile_db_readonly
from app.services.sharing_db import (
    create_collection_share,
    find_collection_share,
)
from app.services.user_db import get_intro_consent
from app.storage import (
    APP_ENV,
    R2_ENABLED,
    download_from_r2,
    download_from_r2_global,
    generate_presigned_url_global,
    r2_delete_object_global,
    r2_head_object_global,
    upload_file_to_r2_global,
)
from app.user_context import get_current_user_id
from app.utils.encoding import decode_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collections", tags=["collections"])

# Ratio word for frozen share titles (glyph-only in the app, but a share title is
# a human-readable string -- EPIC #2: glyph + word in names, never "9:16").
RATIO_WORD = {"9:16": "Portrait", "16:9": "Landscape"}

# A (scope, ratio) becomes a collection only at or above this much published
# content. Server-computed so clients never derive eligibility (EPIC #13).
COLLECTION_MIN_DURATION_SEC = 30

# Smart collections (T3670, extended for multi-sport). Two kinds, both surfaced
# in the `smart_collections` response list, distinguished by nudge_when_locked:
#
#   1. Curated (Top Plays + per-sport combos) -- nudge_when_locked=True, so the
#      UI shows an amber "locked" progress card from the first reel to nudge the
#      user toward the 30s threshold. Tag-less Top Plays = all reels; a combo
#      joins a reel iff the reel carries ANY of the combo's tags (OR), so a
#      multi-tag reel is counted once.
#   2. Per-tag -- nudge_when_locked=False, generated dynamically from whatever
#      tags are present. These stay HIDDEN until ready (>= 30s in a ratio); the
#      user is never told about a tag collection that can't play yet.
#
# Member fetch: tag-less -> GET /api/downloads (no filter); the rest ->
# GET /api/downloads?tags=<comma list>.

DEFAULT_SPORT = "soccer"


def _combo(key: str, name: str, tags: set) -> dict:
    return {"key": key, "name": name, "tags": frozenset(tags)}


# Always-on, sport-agnostic flagship (all single-clip reels).
TOP_PLAYS = {"key": "top_plays", "name": "Top Plays", "tags": None}

# Per-sport curated highlight combos -- the most entertaining tag groupings.
# Tag names must match the frontend tag registry EXACTLY (case-sensitive).
CURATED_COMBOS = {
    "soccer": [
        _combo("soccer_goals_assists", "Top Goals & Assists", {"Goal", "Assist"}),
    ],
    "basketball": [
        _combo("basketball_buckets_dunks", "Top Buckets & Dunks", {"Scoring", "Dunk"}),
        _combo("basketball_scoring_assists", "Top Scoring & Assists", {"Scoring", "Assist"}),
    ],
    "american_football": [
        _combo("af_touchdowns", "Top Touchdowns",
               {"Touchdown Pass", "Touchdown Catch", "Touchdown Run"}),
        _combo("af_defense", "Top Defensive Plays",
               {"Sack", "Interception", "Forced Fumble"}),
    ],
    "flag_football": [
        _combo("ff_touchdowns", "Top Touchdowns", {"Touchdown Pass", "Touchdown Catch"}),
        _combo("ff_defense", "Top Defensive Plays", {"Sack", "Interception"}),
    ],
    "lacrosse": [
        _combo("lax_goals_assists", "Top Goals & Assists", {"Goal", "Assist"}),
    ],
    "rugby": [
        _combo("rugby_tries_breaks", "Top Tries & Breaks", {"Try", "Line Break"}),
    ],
    "volleyball": [
        _combo("vb_kills_aces", "Top Kills & Aces", {"Kill", "Ace"}),
        _combo("vb_digs_blocks", "Top Digs & Blocks", {"Dig", "Block"}),
    ],
    "hockey": [
        _combo("hockey_goals_assists", "Top Goals & Assists", {"Goal", "Assist"}),
        _combo("hockey_goals_saves", "Top Goals & Saves", {"Goal", "Save"}),
    ],
    "tennis": [
        _combo("tennis_aces_winners", "Top Aces & Winners",
               {"Ace", "Forehand Winner", "Backhand Winner"}),
    ],
    "baseball": [
        _combo("baseball_hits_homers", "Top Hits & Homers", {"Home Run", "Hit"}),
        _combo("baseball_defense", "Top Defensive Plays", {"Strikeout", "Double Play"}),
    ],
    "softball": [
        _combo("softball_hits_homers", "Top Hits & Homers", {"Home Run", "Hit"}),
        _combo("softball_defense", "Top Defensive Plays", {"Strikeout", "Double Play"}),
    ],
}


def _curated_for(sport: str | None) -> list:
    """Top Plays first, then the sport's curated combos (soccer if unknown)."""
    combos = CURATED_COMBOS.get(sport or DEFAULT_SPORT, CURATED_COMBOS[DEFAULT_SPORT])
    return [TOP_PLAYS, *combos]


def _pluralize(tag: str) -> str:
    """Best-effort plural for a per-tag collection name ('Dig' -> 'Digs',
    'Pass' -> 'Passes', 'Rally' -> 'Rallies')."""
    low = tag.lower()
    if low.endswith(("s", "x", "z", "ch", "sh")):
        return tag + "es"
    if low.endswith("y") and len(tag) > 1 and low[-2] not in "aeiou":
        return tag[:-1] + "ies"
    return tag + "s"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class RatioBucketed(BaseModel):
    reel_count: int
    unwatched_count: int = 0               # T4190: NEW (watched_at IS NULL) reels in this bucket
    ratio_counts: dict[str, int]
    ratio_durations: dict[str, float]      # NULL-excluded sums per ratio
    ratio_eligible: dict[str, bool]        # ratio_durations[r] >= threshold
    total_duration: float                  # NULL-excluded
    has_null_durations: bool
    leading_reel_id: int | None = None     # T5673: representative reel id for collapsed row posters
    latest_published_at: str | None


class GameCollection(RatioBucketed):
    game_id: int
    game_name: str
    game_date: str | None


class GameGroup(BaseModel):                # T5880: derived tournament/month axis
    axis: Literal["tournament", "month"]   # which metadata column the group derives from
    key: str                               # stable key ('tournament:<name>' | 'month:YYYY-MM')
    label: str                             # display label (tournament name | 'July 2026')
    game_ids: list[int]                    # member games, most-recent-first (subset of `games`)
    reel_count: int                        # aggregate over member games
    unwatched_count: int                   # aggregate over member games


class SeasonTotal(BaseModel):              # T3640 consumer (already ratio-scoped)
    season: str
    ratio: str
    reel_count: int
    total_duration: float
    has_null_durations: bool
    eligible: bool


class TagTotal(BaseModel):                 # raw per-tag feed (other consumers)
    tag: str
    ratio: str
    reel_count: int
    total_duration: float
    has_null_durations: bool
    eligible: bool


class SmartCollection(RatioBucketed):      # T3670: curated (Top Plays / combos) + per-tag
    key: str
    name: str
    tags: list[str] | None              # member fetch: ?tags=...; None => all reels
    nudge_when_locked: bool                # True => amber locked card sub-30s; False => hide until ready


class CollectionsSummaryResponse(BaseModel):
    smart_collections: list[SmartCollection]  # curated (Top Plays + combos) then ready per-tag
    games: list[GameCollection]            # sorted latest_published_at DESC
    game_groups: list[GameGroup]           # T5880: derived tournament/month groupings of `games`
    mixes: RatioBucketed                   # always present, may be reel_count 0
    season_totals: list[SeasonTotal]
    tag_totals: list[TagTotal]
    total_reel_count: int                  # == list_downloads().total_count


# ---------------------------------------------------------------------------
# Accumulation helpers
# ---------------------------------------------------------------------------

def _utc(ts: str | None) -> str | None:
    """Normalize a SQLite timestamp to ISO-UTC ('...Z') like downloads.py, so
    JS parses it and lexical comparison orders it correctly."""
    if ts and not ts.endswith("Z"):
        return ts.replace(" ", "T") + "Z"
    return ts


def _new_bucket() -> dict:
    return {
        "reel_count": 0,
        "unwatched_count": 0,
        "ratio_counts": {},
        "ratio_durations": {},
        "total_duration": 0.0,
        "has_null_durations": False,
        "latest_published_at": None,
        "leading_reel_id": None,
    }


def _add_reel(bucket: dict, ratio: str, duration, published_at: str | None,
              unwatched: bool = False, reel_id: int | None = None) -> None:
    bucket["reel_count"] += 1
    if unwatched:
        bucket["unwatched_count"] += 1
    bucket["ratio_counts"][ratio] = bucket["ratio_counts"].get(ratio, 0) + 1
    if duration is None:
        bucket["has_null_durations"] = True
    else:
        bucket["total_duration"] += duration
        bucket["ratio_durations"][ratio] = (
            bucket["ratio_durations"].get(ratio, 0.0) + duration
        )
    if published_at and (
        bucket["latest_published_at"] is None
        or published_at > bucket["latest_published_at"]
    ):
        bucket["latest_published_at"] = published_at
    if bucket["leading_reel_id"] is None and reel_id is not None:
        bucket["leading_reel_id"] = reel_id


def _finalize_bucket(bucket: dict) -> dict:
    """Round durations and compute per-ratio eligibility (keyed off the ratios
    that have reels; a ratio with only NULL-duration reels is ineligible)."""
    ratio_durations = {r: round(d, 3) for r, d in bucket["ratio_durations"].items()}
    ratio_eligible = {
        r: bucket["ratio_durations"].get(r, 0.0) >= COLLECTION_MIN_DURATION_SEC
        for r in bucket["ratio_counts"]
    }
    return {
        "reel_count": bucket["reel_count"],
        "unwatched_count": bucket["unwatched_count"],
        "ratio_counts": dict(bucket["ratio_counts"]),
        "ratio_durations": ratio_durations,
        "ratio_eligible": ratio_eligible,
        "total_duration": round(bucket["total_duration"], 3),
        "has_null_durations": bucket["has_null_durations"],
        "latest_published_at": bucket["latest_published_at"],
        "leading_reel_id": bucket["leading_reel_id"],
    }


def _add_total(acc: dict, key, duration) -> None:
    """Accumulate a ratio-scoped (season/tag) total."""
    t = acc.get(key)
    if t is None:
        t = {"reel_count": 0, "total_duration": 0.0, "has_null_durations": False}
        acc[key] = t
    t["reel_count"] += 1
    if duration is None:
        t["has_null_durations"] = True
    else:
        t["total_duration"] += duration


def _season_key(date_str: str | None, season_fn) -> str | None:
    """'<Season> <Year>' from a 'YYYY-MM-DD[...]' string, or None if unparseable."""
    if not date_str:
        return None
    try:
        normalized = date_str.replace("T", " ").replace("Z", "").strip()
        dt = datetime.strptime(normalized[:10], "%Y-%m-%d")
    except (ValueError, AttributeError):
        return None
    return f"{season_fn(dt.month)} {dt.year}"


def _month_key_label(date_str: str | None) -> tuple[str, str] | None:
    """('YYYY-MM', '<Month> <Year>') from a 'YYYY-MM-DD[...]' string, or None if
    unparseable (T5880). The key sorts newest-first lexically; the label is the
    human-readable heading ('July 2026')."""
    if not date_str:
        return None
    try:
        normalized = date_str.replace("T", " ").replace("Z", "").strip()
        dt = datetime.strptime(normalized[:10], "%Y-%m-%d")
    except (ValueError, AttributeError):
        return None
    return f"{dt.year:04d}-{dt.month:02d}", dt.strftime("%B %Y")


def _build_game_groups(games: list, games_info: dict) -> list:
    """Derived tournament/month groupings of the game collections (T5880).

    Two INDEPENDENT axes, each a partition of the same games -- the client picks
    one to view. Absent metadata produces NO group (never a fabricated bucket,
    per the no-silent-fallback standard): a game with no `tournament_name` is in
    no tournament group; a game with no parseable `game_date` is in no month
    group. Grouping/eligibility stay server-computed, consistent with every
    other collection (the client never derives them).

    `games` is pre-sorted latest_published_at DESC, so iterating it in order
    gives most-recent-first member lists; dict insertion order then yields
    most-recent-first tournament groups. Month groups are sorted by key DESC
    (newest month first) since a game's date need not track its publish time."""
    tournaments: dict[str, dict] = {}
    months: dict[str, dict] = {}

    def _add(acc: dict, key: str, label: str, gc) -> None:
        grp = acc.get(key)
        if grp is None:
            grp = {"label": label, "game_ids": [], "reel_count": 0,
                   "unwatched_count": 0}
            acc[key] = grp
        grp["game_ids"].append(gc.game_id)
        grp["reel_count"] += gc.reel_count
        grp["unwatched_count"] += gc.unwatched_count

    for gc in games:
        info = games_info.get(gc.game_id, {})
        tname = (info.get("tournament") or "").strip()
        if tname:
            _add(tournaments, tname, tname, gc)
        ml = _month_key_label(info.get("date"))
        if ml:
            _add(months, ml[0], ml[1], gc)

    out = [
        GameGroup(axis="tournament", key=f"tournament:{name}", **grp)
        for name, grp in tournaments.items()
    ]
    out.extend(
        GameGroup(axis="month", key=f"month:{mkey}", **months[mkey])
        for mkey in sorted(months, reverse=True)
    )
    return out


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=CollectionsSummaryResponse)
async def collections_summary(sport: str | None = None):
    """Per-game / mixes / season / tag aggregates for the Collections tab.

    `sport` selects the curated combo set (the per-tag and per-game aggregates
    are sport-agnostic). It only chooses which curated nudge cards to attempt --
    a combo with no matching reels is omitted -- so eligibility stays fully
    server-computed regardless of the value passed.
    """
    # Reuse the downloads helpers (router->router import has precedent here).
    from app.routers.downloads import (
        _generate_game_display_name,
        _get_season_for_month,
    )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT fv.id, fv.game_ids, fv.aspect_ratio, fv.duration,
                   fv.tags, fv.created_at, fv.published_at, fv.clip_count,
                   fv.watched_at
            FROM final_videos fv
            WHERE fv.id IN ({latest_final_videos_subquery()})
              AND fv.published_at IS NOT NULL
              {exclude_teammate_reels_clause()}
            """
        )
        rows = cursor.fetchall()

        # Pass 1: decode + route. Collect resolved game ids for a batch lookup.
        parsed = []
        resolved_game_ids = set()
        for row in rows:
            ratio = row["aspect_ratio"]
            if not ratio:
                # annotated_game reels (the only NULL-ratio source) can never be
                # published, so a NULL ratio here is a real data bug -- surface it,
                # don't bucket it (no silent 'unknown' coercion; EPIC decision #4).
                logger.warning(
                    f"[Collections] published final_video id={row['id']} has NULL "
                    f"aspect_ratio -- excluded from summary (data bug)."
                )
                continue
            # T3630: collections are single-clip reels only. route_collection
            # sends multi-clip reels (clip_count != 1) to Mixes; only single-clip
            # reels resolve to a game / smart / season bucket.
            single_clip = row["clip_count"] == 1
            game_id = route_collection(row["game_ids"], row["clip_count"])
            if game_id is not None:
                resolved_game_ids.add(game_id)
            parsed.append({
                "id": row["id"],
                "ratio": ratio,
                "duration": row["duration"],
                "published_at": _utc(row["published_at"]),
                "created_at": row["created_at"],
                "game_id": game_id,
                "single_clip": single_clip,
                "unwatched": row["watched_at"] is None,
                "tags": decode_data(row["tags"]) or [],
            })

        # Batch game display info. A routed game id whose row was later deleted
        # still belongs to its game (the frozen id is authoritative); it gets a
        # 'Game N' fallback name rather than being rerouted to mixes -- this keeps
        # the route_game_ids parity with the /api/downloads member filter trivial.
        games_info = {}
        if resolved_game_ids:
            placeholders = ",".join("?" for _ in resolved_game_ids)
            cursor.execute(
                f"""
                SELECT id, name, game_date, opponent_name, game_type, tournament_name
                FROM games WHERE id IN ({placeholders})
                """,
                list(resolved_game_ids),
            )
            for g in cursor.fetchall():
                games_info[g["id"]] = {
                    "name": _generate_game_display_name(
                        g["opponent_name"], g["game_date"], g["game_type"],
                        g["tournament_name"], g["name"] or f"Game {g['id']}",
                    ),
                    "date": g["game_date"] or None,
                    "tournament": g["tournament_name"] or None,   # T5880 axis
                }

        # Pass 2: build buckets + season/tag totals + smart-collection buckets.
        game_buckets: dict[int, dict] = {}
        mixes = _new_bucket()
        season_acc: dict = {}
        tag_acc: dict = {}
        curated_defs = _curated_for(sport)
        curated_buckets = {d["key"]: _new_bucket() for d in curated_defs}
        tag_buckets: dict[str, dict] = {}   # per-tag dynamic collections

        for p in parsed:
            reel_id, ratio, duration, gid = p["id"], p["ratio"], p["duration"], p["game_id"]
            unwatched = p["unwatched"]

            # Multi-clip reels are NOT collection-eligible (T3630): they only
            # count toward Mixes, never game/smart/season.
            if not p["single_clip"]:
                _add_reel(mixes, ratio, duration, p["published_at"], unwatched, reel_id)
                continue

            bucket = (game_buckets.setdefault(gid, _new_bucket())
                      if gid is not None else mixes)
            _add_reel(bucket, ratio, duration, p["published_at"], unwatched, reel_id)

            # Season: the game's date when game-resolved, else the reel's created_at.
            date_src = (games_info.get(gid, {}).get("date")
                        if gid is not None else None) or p["created_at"]
            skey = _season_key(date_src, _get_season_for_month)
            if skey:
                _add_total(season_acc, (skey, ratio), duration)

            reel_tags = set(p["tags"])
            for tag in reel_tags:
                _add_total(tag_acc, (tag, ratio), duration)
                _add_reel(tag_buckets.setdefault(tag, _new_bucket()),
                          ratio, duration, p["published_at"], unwatched, reel_id)

            # Curated collections: per-reel membership (tag-less group = all),
            # so a multi-tag reel is counted once per matching group.
            for d in curated_defs:
                if d["tags"] is None or (reel_tags & d["tags"]):
                    _add_reel(curated_buckets[d["key"]], ratio, duration,
                              p["published_at"], unwatched, reel_id)

    games = [
        GameCollection(
            game_id=gid,
            game_name=games_info.get(gid, {}).get("name") or f"Game {gid}",
            game_date=games_info.get(gid, {}).get("date"),
            **_finalize_bucket(b),
        )
        for gid, b in game_buckets.items()
    ]
    games.sort(key=lambda gc: gc.latest_published_at or "", reverse=True)

    # Derived tournament/month groupings over the now-sorted games (T5880).
    game_groups = _build_game_groups(games, games_info)

    def _totals(acc, label_field):
        out = []
        for (label, ratio), v in acc.items():
            out.append({
                label_field: label,
                "ratio": ratio,
                "reel_count": v["reel_count"],
                "total_duration": round(v["total_duration"], 3),
                "has_null_durations": v["has_null_durations"],
                "eligible": v["total_duration"] >= COLLECTION_MIN_DURATION_SEC,
            })
        out.sort(key=lambda r: (r[label_field], r["ratio"]))
        return out

    season_totals = [SeasonTotal(**t) for t in _totals(season_acc, "season")]
    tag_totals = [TagTotal(**t) for t in _totals(tag_acc, "tag")]

    # Curated (Top Plays + combos): shown from the first reel (nudge), in
    # definition order; omit groups with no matching reels.
    smart_collections = [
        SmartCollection(
            key=d["key"], name=d["name"],
            tags=(sorted(d["tags"]) if d["tags"] else None),
            nudge_when_locked=True,
            **_finalize_bucket(curated_buckets[d["key"]]),
        )
        for d in curated_defs
        if curated_buckets[d["key"]]["reel_count"] > 0
    ]

    # Per-tag: hidden until ready -- include only once a ratio clears the
    # threshold (the UI never renders a locked card for these). Sorted by the
    # displayed (pluralized) name for a stable order.
    ready_tags = []
    for tag, bucket in tag_buckets.items():
        fb = _finalize_bucket(bucket)
        if any(fb["ratio_eligible"].values()):
            ready_tags.append((tag, fb))
    ready_tags.sort(key=lambda t: _pluralize(t[0]).lower())
    smart_collections.extend(
        SmartCollection(
            key=f"tag:{tag}", name="Top " + _pluralize(tag),
            tags=[tag], nudge_when_locked=False, **fb,
        )
        for tag, fb in ready_tags
    )

    return CollectionsSummaryResponse(
        smart_collections=smart_collections,
        games=games,
        game_groups=game_groups,
        mixes=RatioBucketed(**_finalize_bucket(mixes)),
        season_totals=season_totals,
        tag_totals=tag_totals,
        total_reel_count=len(parsed),
    )


# ---------------------------------------------------------------------------
# Collection share links (T3620)
#
# A share is a stored (scope, filter, aspect_ratio[, budget_sec]) DEFINITION,
# evaluated LIVE against the sharer's profile DB at view time. Only the display
# `title` is frozen (explicit-names-after-archive convention). The membership
# read path reuses the SAME filter chain as GET /api/downloads (route_game_ids /
# tag decode / aspect_ratio), so a link and the in-app card never disagree.
#
# Scope types: 'game' (single game), 'all' (all-time -- smart collections), and
# 'mixes' (multi-game OR game-less). No 'season' yet (added in T3640).
# ---------------------------------------------------------------------------

class CollectionScope(BaseModel):
    type: Literal["game", "all", "mixes"]
    game_id: int | None = None


class CollectionFilter(BaseModel):
    tags: list[str] | None = None
    min_rating: int | None = None   # accepted but inert until a rating filter exists


class CollectionDefinition(BaseModel):
    scope: CollectionScope
    filter: CollectionFilter = Field(default_factory=CollectionFilter)
    aspect_ratio: Literal["9:16", "16:9"]
    budget_sec: float | None = None
    title: str | None = None          # server overwrites with a frozen title
    # T5215: the CLIENT's raw picker choice at share-creation time -- 0 (no
    # intro), an explicit card id, or None/omitted ("use my current default").
    # The server resolves this to a CONCRETE value (id or 0, never None) and
    # freezes THAT into the stored definition (see `_canonical_definition`) so
    # a later default change never retroactively changes an existing link.
    intro_card_id: int | None = None


class CollectionShareRequest(BaseModel):
    definition: CollectionDefinition
    recipient_emails: list[str] = []
    is_public: bool = False


class CollectionShareRecipient(BaseModel):
    share_token: str
    recipient_email: str
    is_existing_link: bool               # surfaced an existing link (dedup)
    email_sent: bool | None = None


class CollectionShareResponse(BaseModel):
    shares: list[CollectionShareRecipient]
    title: str


# ---- membership evaluation (shared by resolve; reuses list_downloads' chain) --

def select_within_budget(members: list[dict], budget_sec: float) -> list[dict]:
    """Greedy-with-skip selection of members that fit the budget, in order
    (Python port of frontend budget.js::selectWithinBudget). NULL-duration
    members can't be budgeted; guarantees at least one member when any has a
    duration so a shared link is never empty for a non-empty collection."""
    out: list[dict] = []
    used = 0.0
    for m in members:
        d = m["duration"]
        if d is None:
            continue
        if used + d <= budget_sec + 1e-6:
            out.append(m)
            used += d
    if not out:
        first = next((m for m in members if m["duration"] is not None), None)
        if first:
            out.append(first)
    return out


def evaluate_collection_members(conn, definition: dict) -> list[dict]:
    """Return the live members of a collection definition against an open profile
    DB connection, ordered by the canonical comparator (rating, quality_score,
    recency -- T3630 ORDER_BY_RANK). Each: {id, name, duration, filename}.

    Same filter chain as GET /api/downloads so member counts match the summary:
    aspect_ratio (SQL, indexed) + single-clip-only collection routing on the frozen
    game_ids BLOB + clip_count (game -> route_collection==game_id; mixes ->
    route_collection None; all -> clip_count==1) + optional tag OR-filter."""
    scope = definition["scope"]
    stype = scope["type"]
    ratio = definition["aspect_ratio"]

    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT fv.id, fv.name AS fv_name, fv.duration, fv.filename,
               fv.game_ids, fv.tags, fv.created_at, fv.rating,
               fv.quality_score, fv.clip_count
        FROM final_videos fv
        WHERE fv.id IN ({latest_final_videos_subquery()})
          AND fv.published_at IS NOT NULL
          AND fv.aspect_ratio = ?
          {exclude_teammate_reels_clause()}
        ORDER BY {ORDER_BY_RANK}
        """,
        (ratio,),
    )
    rows = cur.fetchall()

    if stype == "game":
        gid = scope.get("game_id")
        rows = [r for r in rows if route_collection(r["game_ids"], r["clip_count"]) == gid]
    elif stype == "mixes":
        rows = [r for r in rows if route_collection(r["game_ids"], r["clip_count"]) is None]
    else:  # "all" (smart / season scope): collections are single-clip only
        rows = [r for r in rows if r["clip_count"] == 1]

    tags = (definition.get("filter") or {}).get("tags")
    if tags:
        wanted = set(tags)
        rows = [r for r in rows if wanted & set(decode_data(r["tags"]) or [])]

    return [
        {"id": r["id"], "name": r["fv_name"], "duration": r["duration"],
         "filename": r["filename"]}
        for r in rows
    ]


# ---- collection's OWN attached intro (T5215 round 2) -----------------------
# Distinct from a SHARE's frozen-at-creation choice above: this is a stored
# attribute of the collection itself (the user, 2026-08-06: "I also want to
# be able to add an intro card to compilations/collections"). Resolution order
# + duration-gate semantics are documented in full on
# `services.intro_cards.collection_intro_settings_key`.

class UpdateCollectionIntroRequest(BaseModel):
    intro_card_id: int | None


def _collection_scope_and_definition(
    scope_type: str, aspect_ratio: str, game_id: int | None, tags: str | None,
) -> tuple[str, list[str] | None, dict]:
    """Shared param parsing for both the GET and PATCH collection-intro
    endpoints -- one place decides the tag list + the live-evaluation
    definition shape, so the two routes can't drift on scope validation."""
    if scope_type == "game" and game_id is None:
        raise HTTPException(400, "game scope requires game_id")
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    definition = {
        "scope": {"type": scope_type, **({"game_id": game_id} if scope_type == "game" else {})},
        "filter": {"tags": tag_list} if tag_list else {},
        "aspect_ratio": aspect_ratio,
    }
    return tag_list, definition


@router.get("/intro")
async def get_collection_intro(
    scope_type: str, aspect_ratio: str,
    game_id: int | None = None, tags: str | None = None,
):
    """Resolve a (scope, ratio) collection's OWN attached intro -- id (raw
    stored value, for the picker's preselection) + name (resolved, what will
    actually play)."""
    tag_list, _definition = _collection_scope_and_definition(scope_type, aspect_ratio, game_id, tags)
    key = collection_intro_settings_key(
        scope_type, game_id=game_id, tags=tag_list, aspect_ratio=aspect_ratio,
    )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        raw_id = get_collection_intro_card_id(cursor, key)
        # T6680: resolution no longer needs a duration (the duration-gated
        # inherit path is gone) -- no need to evaluate_collection_members
        # just to compute one.
        card = resolve_intro_card(raw_id, None, conn)

    return {
        "intro_card_id": raw_id,
        "intro_card_name": card["name"] if card else None,
    }


@router.get("/intro-playback")
async def get_collection_intro_playback(
    scope_type: str, aspect_ratio: str,
    game_id: int | None = None, tags: str | None = None,
):
    """The COLLECTION's OWN resolved intro, LIVE against LIVE total duration,
    for the owner in-app Play-all gesture (T6700 design §5.1 row 2). Same
    (scope_type, aspect_ratio, game_id?, tags?) params as `GET /intro` above;
    reuses the identical scope/resolution block (never per-member reel
    intros -- design §0/Q2) and serializes via the SAME
    `build_intro_playback_payload` the single-reel endpoint and the frozen
    collection-share path already use, so the three never diverge in shape.

    Non-fatal, ALWAYS 200: no stored/inherited card, the duration gate
    blocking the inherit path, or a resolve failure all degrade to
    `{"intro": null}`.
    """
    tag_list, definition = _collection_scope_and_definition(scope_type, aspect_ratio, game_id, tags)
    key = collection_intro_settings_key(
        scope_type, game_id=game_id, tags=tag_list, aspect_ratio=aspect_ratio,
    )

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            raw_id = get_collection_intro_card_id(cursor, key)
            # Same LIVE-total-duration gate as GET /intro above.
            members = evaluate_collection_members(conn, definition)
            durations = [m["duration"] for m in members if m["duration"] is not None]
            total_duration = sum(durations) if durations else None
            card = resolve_intro_card(raw_id, total_duration, conn)

            if card is None:
                return {"intro": None}

            user_id = get_current_user_id()
            profile_id = get_current_profile_id()
            field_values = _load_field_values(user_id, profile_id)
            intro = build_intro_playback_payload(card, field_values)
    except Exception as e:
        logger.error(f"[collections] intro-playback resolve failed for key={key!r}: {e}", exc_info=True)
        return {"intro": None}

    return {"intro": intro}


# ---- collection download: ONE stitched MP4 (T4945) -------------------------
# `[intro?][member_1..member_N][outro?]` -- members in rank/playback order,
# the collection's OWN resolved intro at the front, exactly one branded outro
# at the end. The hard part is already built: `ffmpeg_concat.concat_segments`
# (ordered N-join with a mixed-resolution re-encode fallback, EPIC decision 7)
# pre-joins the members, `serve_time_video.compose_serve_time` wraps the single
# stitch with the intro/outro cards in ONE pass. This endpoint is the wiring.

_MEMBER_KEY_PREFIX = "final_videos"


def _collection_download_filename(scope_type: str, tags: list[str] | None) -> str:
    """A human-ish attachment filename for the Content-Disposition header.
    No PII -- derived only from the collection's scope, never a reel name."""
    if scope_type == "game":
        base = "Game_Highlights"
    elif scope_type == "mixes":
        base = "Mixes"
    elif tags:
        joined = "_".join(tags)
        base = "".join(c if (c.isalnum() or c in "-_") else "_" for c in joined)[:60] or "Highlights"
    else:
        base = "Highlights"
    return f"{base}.mp4"


# ---- disposable stitched-download cache (T4947) ----------------------------
# A repeat download of an UNCHANGED collection serves a pre-built MP4 straight
# from R2 instead of re-stitching. No DB row, no migration: the cache is fully
# derivable from its R2 key, which fingerprints EVERYTHING that changes the
# composed bytes, so any input change is a natural miss. Lives under the
# caller's own R2 prefix (same namespace as the Modal stitch scratch), disposable
# and torn down with the account.

_CACHE_KEY_PREFIX = "collection_downloads"

# The intro-card columns whose value determines the BURNED intro; an edit to any
# of them (same card id) must invalidate the cache. `updated_at` bumps on every
# card edit; the explicit content columns cover a same-second image/text swap.
_CARD_CONTENT_COLUMNS = (
    "id", "name", "shown_fields", "treatment", "subtitle_text",
    "image_key", "image_cutout_key", "focal_x", "focal_y", "zoom",
    "duration", "updated_at",
)


def _card_content_hash(card_row) -> str:
    """Stable 16-hex digest of the resolved intro card's burn-affecting content
    (or a fixed sentinel when there is no intro), so EDITING the card without
    changing its id still invalidates the download cache. `card_row` is a
    `SELECT *` sqlite row from `resolve_intro_card`."""
    if card_row is None:
        return "no-card"
    parts = []
    for col in _CARD_CONTENT_COLUMNS:
        try:
            parts.append(f"{col}={card_row[col]}")
        except (KeyError, IndexError):
            parts.append(f"{col}=?")  # column absent below-head; still stable
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]


def _collection_download_cache_key(
    r2_prefix: str, members: list[dict], resolved_card_id: int | None,
    card_content_hash: str, field_values_fp: str, outro_on: bool,
    budget_sec: float | None,
) -> str:
    """Full R2 key for the stitched-download cache: sha256 over the ordered
    member ids + each member's filename + the resolved intro card id + its
    content hash + the burned intro FACTS (profile full_name / shown fields) +
    the branded-outro flag + the budget. Any single input change (member set,
    rank order, card, card content, a burned profile fact, outro flag, budget)
    yields a different key = a natural cache miss."""
    fingerprint = "\n".join([
        "ids=" + ",".join(str(m["id"]) for m in members),
        "files=" + ",".join(m["filename"] for m in members),
        f"card={resolved_card_id}",
        f"cardhash={card_content_hash}",
        f"facts={field_values_fp}",
        f"outro={int(outro_on)}",
        f"budget={budget_sec}",
    ])
    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    return f"{r2_prefix}/{_CACHE_KEY_PREFIX}/{digest}.mp4"


def _stream_file_and_cleanup(path: str, cleanup_dir: str):
    """Stream an on-disk MP4 in 1 MiB chunks, then `rmtree` `cleanup_dir` in a
    `finally`. Shared by the cache-hit and freshly-built collection-download
    paths so they never drift on chunk size / cleanup. A failure here is
    genuinely post-headers (the 200 is already committed) -- logged loudly with
    context rather than silently swallowed."""
    def _gen():
        try:
            with open(path, "rb") as fin:
                while True:
                    chunk = fin.read(1024 * 1024)
                    if not chunk:
                        break
                    yield chunk
        except Exception:
            logger.exception(f"[CollectionDownload] streaming file failed mid-stream: {path}")
            raise
        finally:
            shutil.rmtree(cleanup_dir, ignore_errors=True)
    return _gen()


def _stitch_members_local(
    user_id: str, profile_id: str, member_keys: list[str], out_path: str, tmp_dir: str,
) -> None:
    """Pre-join the collection's member reels into `out_path`, IN ORDER, on the
    app server (the MODAL_ENABLED=false / dev + container path). Read-only over
    the member sources: each is fetched (R2 download, or a copy of the local
    final_videos file when R2 is off) into `tmp_dir`, never opened for write.

    Mixed-resolution safety is delegated ENTIRELY to `concat_segments`' built-in
    re-encode fallback (EPIC decision 7) -- there is no bespoke resolution
    normalization here; the reference probe is the top-ranked member's, exactly
    as `concat_segments` expects. Raises on a member fetch / concat failure (the
    caller degrades non-fatally); NOTHING is ever written back to a source.
    """
    from app.database import get_final_videos_path
    from app.services.ffmpeg_concat import concat_segments, probe_media

    seg_paths: list[str] = []
    for i, key in enumerate(member_keys):
        local = os.path.join(tmp_dir, f"member_{i}.mp4")
        if R2_ENABLED:
            # Explicit profile_id (T5340): this runs inside the deferred
            # streaming generator, where the request's profile ContextVar may
            # already be gone -- never rely on it to build the R2 key.
            if not download_from_r2(user_id, key, Path(local), profile_id=profile_id):
                raise RuntimeError(f"could not download collection member {key!r}")
        else:
            filename = key.split("/", 1)[1] if "/" in key else key
            src = get_final_videos_path() / filename
            if not src.exists():
                raise RuntimeError(f"collection member file missing: {src}")
            shutil.copyfile(src, local)
        seg_paths.append(local)

    if len(seg_paths) == 1:
        # One member: the "stitch" is just that member -- compose still prepends
        # the intro / appends the outro over it. No concat needed.
        shutil.copyfile(seg_paths[0], out_path)
        return

    reference = probe_media(seg_paths[0])  # top-ranked member = concat reference
    if not concat_segments(seg_paths, out_path, reference):
        raise RuntimeError("collection member concat failed")


@router.get("/download")
async def download_collection(
    scope_type: str, aspect_ratio: str,
    game_id: int | None = None, tags: str | None = None,
    budget_sec: float | None = None,
):
    """Stream a (scope, ratio) collection as ONE stitched MP4 (T4945): members
    in rank/playback order, the collection's OWN resolved intro card at the
    front, exactly one branded outro at the end (flag off -> no outro).

    Compute location honors MODAL_ENABLED (EPIC decision 1): the arbitrary-N
    concat/re-encode runs on the CPU-only Modal `stitch_members` function in
    prod (the single shared app server must not absorb it), or locally in dev.
    The intro/outro compose ALWAYS runs app-side (the card render engines are
    app-side; T3950 invariant) -- Modal only ever muxes the raw member concat.

    Read-only over member sources throughout: sources are fetched into a
    per-request temp dir (rmtree'd in `finally`), the Modal branch writes only
    to a disposable `temp/collection_stitch/` scratch key (best-effort deleted,
    never a member key), and NOTHING is inserted into final_videos/export_jobs.
    Every ffmpeg stage is non-fatal -- a stitch/outro failure degrades the
    download, it never corrupts or drops a source reel.

    Access control (T4946, RESOLVED): "permission to the clip" collapses to
    OWNERSHIP for a collection download -- there is no collaborator-permission
    concept for collections. Both properties are enforced STRUCTURALLY, not by
    an added gate (a defensive owner check against a row that cannot exist is a
    banned defensive fix, CLAUDE.md):
      - Sign-in: this path is NOT in the middleware AUTH_ALLOWLIST_PREFIXES, so
        a request with no session cookie / X-User-ID is 401'd by
        RequestContextMiddleware BEFORE this handler runs.
      - Ownership: `get_db_connection()` / `evaluate_collection_members` read
        ONLY the caller's own profile DB (resolved purely from the request's
        user/profile ContextVars -- there is no user argument to pass), and
        `final_videos` never holds a foreign-owned reel. A signed-in user can
        only ever stitch their own published reels; another user's collection
        is structurally invisible (yields the 404 below), never reachable.
      - Free (Decision 4): NO credit reservation / debit -- downloads are free.
    This mirrors the sibling single-reel download (`downloads.py::download_file`),
    which gates identically. Regression: test_t4946_collection_download_access.py.
    """
    tag_list, definition = _collection_scope_and_definition(scope_type, aspect_ratio, game_id, tags)
    key = collection_intro_settings_key(
        scope_type, game_id=game_id, tags=tag_list, aspect_ratio=aspect_ratio,
    )

    # ---- Resolve EVERYTHING that needs the request connection / ContextVar
    # BEFORE building the async generator (T5220 gotcha: the generator body runs
    # after this request's DB connection has closed). ----
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        raw_card_id = get_collection_intro_card_id(cursor, key)
        members = evaluate_collection_members(conn, definition)
        # Resolve the collection's intro card row here (connection alive) -- its
        # RESOLVED id + content hash feed the cache key so a card swap/edit
        # invalidates it. Same row `resolve_intro_for_reel` will burn (T6680:
        # the reel_duration arg no longer participates in resolution).
        card_row = resolve_intro_card(raw_card_id, None, conn)
    if budget_sec is not None:
        members = select_within_budget(members, budget_sec)
    if not members:
        raise HTTPException(status_code=404, detail="Collection has no members to download")

    durations = [m["duration"] for m in members if m["duration"] is not None]
    total_duration = sum(durations) if durations else None
    member_keys = [f"{_MEMBER_KEY_PREFIX}/{m['filename']}" for m in members]
    # R2 prefix resolved here (ContextVar alive) for the Modal branch -- Modal
    # builds member/scratch keys as `{prefix}/{relative_key}`.
    from app.services.modal_client import _resolve_modal_user_id
    r2_prefix = _resolve_modal_user_id(user_id)
    download_filename = _collection_download_filename(scope_type, tag_list)

    # T6360: scope-derived metadata (title/album) + the profile name (artist) +
    # the constant attribution block. Applied per-request AFTER compose and
    # DELIBERATELY NOT baked into the T4947 cache -- `artist` is the current
    # profile name, so a rename must reflect on the next download without
    # poisoning the cached bytes (which stay keyed on stitch + cards only).
    from app.services.download_metadata import (
        apply_download_metadata,
        build_collection_metadata,
    )
    coll_meta = build_collection_metadata(scope_type, tag_list, user_id, profile_id)

    record_milestone(user_id, "collection_downloaded", {
        "scope_type": scope_type, "aspect_ratio": aspect_ratio, "members": len(members),
    })

    dl_headers = {
        "Content-Disposition": f'attachment; filename="{download_filename}"',
        "Cache-Control": "no-cache",
    }

    # ---- HEAD-before-build: serve a repeat download from the disposable R2
    # cache without re-stitching (T4947). The key fingerprints every input that
    # changes the composed bytes; `outro_enabled()` (the BRANDED_OUTRO_ENABLED
    # flag) is what compose_serve_time ACTUALLY honors even though we always pass
    # outro=True, so it -- not the literal True -- belongs in the key. ----
    from app.services.branded_outro import outro_enabled
    # The BURNED intro facts (profile full_name + the card's shown fields) live in
    # user.sqlite, NOT the intro-card row, so editing a fact never bumps the
    # card's `updated_at` -- they must be in the key on their own, or a profile
    # rename would keep serving the stale burned name from cache. Only relevant
    # when a card is actually attached (the only case they get burned). Offloaded:
    # _load_field_values does an R2 user-db freshness check that must not run on
    # the event loop (T7040).
    field_values_fp = ""
    if card_row is not None:
        field_values = await asyncio.to_thread(_load_field_values, user_id, profile_id)
        field_values_fp = json.dumps(field_values, sort_keys=True, default=str)
    cache_key = _collection_download_cache_key(
        r2_prefix, members,
        card_row["id"] if card_row is not None else None,
        _card_content_hash(card_row), field_values_fp, outro_enabled(), budget_sec,
    )
    if await asyncio.to_thread(r2_head_object_global, cache_key) is not None:
        cache_tmp = tempfile.mkdtemp(prefix="rb_coll_dl_cache_")
        cached_path = os.path.join(cache_tmp, "cached.mp4")
        if await asyncio.to_thread(download_from_r2_global, cache_key, Path(cached_path)):
            logger.info(f"[CollectionDownload] cache HIT {cache_key}")
            # Stamp metadata on the cached (unstamped) bytes at serve time.
            stamped_path = await asyncio.to_thread(
                apply_download_metadata, cached_path, cache_tmp, coll_meta,
            )
            return StreamingResponse(
                _stream_file_and_cleanup(stamped_path, cache_tmp),
                media_type="video/mp4", headers=dl_headers,
            )
        # HEAD said present but the GET failed (transient blip / just-evicted) --
        # tear down and fall through to a fresh build rather than 5xx.
        shutil.rmtree(cache_tmp, ignore_errors=True)
        logger.warning(
            f"[CollectionDownload] cache HEAD hit but download failed; rebuilding {cache_key}"
        )

    def _resolve_collection_intro():
        # Own read-only connection (resolve_intro_for_reel opens one keyed on
        # the EXPLICIT user/profile ids), matching the single-reel download --
        # reel_id=None because this is the collection-level card, not a member's.
        from app.services.intro_egress import resolve_intro_for_reel
        return resolve_intro_for_reel(user_id, profile_id, raw_card_id, total_duration, None)

    # ---- Produce the fully-composed MP4 BEFORE returning the stream (T7040) ----
    # Everything that can fail -- the Modal (or local) member stitch and the R2
    # fetch of its output -- runs HERE, inside the request handler, so a failure
    # raises an HTTPException the client reports as a real 5xx. Doing this work
    # inside the StreamingResponse generator (as the original did) meant an
    # exception fired AFTER a 200 + headers were already committed, dropping the
    # connection abnormally -- the browser surfaced that as a bare
    # "TypeError: Failed to fetch" with no diagnosable server-side status.
    # Nothing is streamed until the stitch completes anyway, so eager-computing
    # here costs no extra latency; it only converts mid-stream aborts into clean
    # error statuses. The intro/outro compose stays best-effort (a failure there
    # degrades to the bare stitch, never a hard failure -- unchanged).
    tmp_dir = tempfile.mkdtemp(prefix="rb_coll_dl_")
    scratch_full_key = None
    try:
        stitched_path = os.path.join(tmp_dir, "stitched.mp4")
        out_path = os.path.join(tmp_dir, "composed.mp4")

        # ---- produce the raw member stitch (compute-location branch) ----
        from app.services.modal_client import modal_enabled
        if modal_enabled():
            from app.services.modal_client import call_modal_stitch_members
            scratch_rel = f"temp/collection_stitch/{uuid.uuid4().hex}.mp4"
            scratch_full_key = f"{r2_prefix}/{scratch_rel}"
            await call_modal_stitch_members(r2_prefix, member_keys, scratch_rel)
            if not await asyncio.to_thread(
                download_from_r2_global, scratch_full_key, Path(stitched_path)
            ):
                raise RuntimeError("could not fetch Modal-stitched collection output from R2")
        else:
            await asyncio.to_thread(
                _stitch_members_local, user_id, profile_id, member_keys, stitched_path, tmp_dir
            )

        # ---- compose intro + outro (T7090 Phase 3: the card BURN + concat now
        # dispatch to Modal when enabled, exactly like the member stitch above;
        # local compose is the Modal-off fallback). The T4947 cache gate below is
        # unchanged -- it still keys on `compose_report["full_fidelity"]`, now
        # sourced from the Modal result dict on the dispatched path. ----
        serve_path = stitched_path
        compose_report: dict = {}
        intro = await asyncio.to_thread(_resolve_collection_intro)
        try:
            from app.services.serve_time_video import compose_serve_time_dispatched
            if await asyncio.to_thread(
                compose_serve_time_dispatched, stitched_path, out_path,
                user_id=user_id, user_prefix=r2_prefix,
                intro=intro, outro=True, report=compose_report,
            ):
                serve_path = out_path
        except Exception as exc:
            logger.error(f"[CollectionDownload] compose failed (serving bare stitch): {exc}")
        finally:
            if intro is not None:
                intro.cleanup()
    except Exception as exc:
        # Failure BEFORE any byte is streamed -> clean up scratch/tmp and surface
        # a real HTTP 500. The client sees a reportable status, never a silent
        # "Failed to fetch". Log with scope context so it is diagnosable.
        if scratch_full_key:
            try:
                await asyncio.to_thread(r2_delete_object_global, scratch_full_key)
            except Exception:
                logger.warning(f"[CollectionDownload] scratch cleanup failed: {scratch_full_key}")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.exception(
            f"[CollectionDownload] stitch failed (scope={scope_type} game_id={game_id} "
            f"members={len(members)}): {exc}"
        )
        raise HTTPException(status_code=500, detail="Collection stitch failed") from exc

    # Composed file now lives on local disk -> the R2 scratch object is no longer
    # needed. Best-effort delete (a leaked scratch key is disposable, never a
    # member key) before we hand off to the streaming generator.
    if scratch_full_key:
        try:
            await asyncio.to_thread(r2_delete_object_global, scratch_full_key)
        except Exception:
            logger.warning(f"[CollectionDownload] scratch cleanup failed: {scratch_full_key}")

    # ---- write-after-build: populate the disposable cache (best-effort) ----
    # An R2 object PUT is atomic -- the key only becomes visible once the whole
    # object lands -- so two concurrent requests for the same uncached key can
    # only ever race to write byte-complete objects (last writer wins on
    # identical content), never expose a partial one. And because each request
    # STREAMS ITS OWN freshly-built `serve_path` (never the key it just wrote),
    # the race can't corrupt the bytes any caller actually receives. A cache-write
    # failure is non-fatal: the download already succeeded from local disk.
    #
    # ONLY cache a FULL-FIDELITY compose. compose_serve_time is non-fatal: a
    # transient intro/outro/concat hiccup degrades to a bare stitch but still
    # returns True. Caching that would freeze the degraded bytes and serve them
    # on every future hit for this key (no self-heal), so a degraded serve
    # streams to THIS caller but must not poison the cache -- the next request
    # re-misses and rebuilds once the transient condition clears.
    if compose_report.get("full_fidelity"):
        try:
            await asyncio.to_thread(
                upload_file_to_r2_global, cache_key, Path(serve_path), content_type="video/mp4",
            )
        except Exception:
            logger.warning(f"[CollectionDownload] cache write failed (non-fatal): {cache_key}")
    else:
        logger.info(
            f"[CollectionDownload] compose degraded (not full fidelity); skipping cache write {cache_key}"
        )

    # T6360: stamp AFTER the cache write above, so the cache stores the unstamped
    # compose output (matching the cache-HIT path, which stamps on read) while
    # this caller streams the stamped file.
    serve_path = await asyncio.to_thread(
        apply_download_metadata, serve_path, tmp_dir, coll_meta,
    )

    return StreamingResponse(
        _stream_file_and_cleanup(serve_path, tmp_dir),
        media_type="video/mp4", headers=dl_headers,
    )


@router.patch("/intro")
async def set_collection_intro(
    body: UpdateCollectionIntroRequest,
    scope_type: str, aspect_ratio: str,
    game_id: int | None = None, tags: str | None = None,
):
    """Attach/detach/clear a collection's OWN intro. Surgical write to
    `collection_settings` (no per-collection row exists otherwise). Same
    consent gate + dangling-id rejection as the reel PATCH."""
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    intro_card_id = body.intro_card_id

    if (intro_card_id is not None and intro_card_id != 0
            and get_intro_consent(user_id, profile_id) is None):
        raise HTTPException(
            status_code=403,
            detail="Parental consent is required before attaching an intro card.",
        )

    tag_list, _definition = _collection_scope_and_definition(scope_type, aspect_ratio, game_id, tags)
    key = collection_intro_settings_key(
        scope_type, game_id=game_id, tags=tag_list, aspect_ratio=aspect_ratio,
    )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        if intro_card_id is not None and intro_card_id != 0:
            cursor.execute("SELECT 1 FROM intro_cards WHERE id = ?", (intro_card_id,))
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail="Intro card not found")
        set_collection_intro_card_id(cursor, key, intro_card_id)
        conn.commit()

    return {"success": True, "intro_card_id": intro_card_id}


class CollectionIntroBatchItem(BaseModel):
    scope_type: str
    game_id: int | None = None
    tags: list[str] | None = None
    aspect_ratio: str


@router.get("/intro/batch")
async def get_collection_intro_batch(items: str):
    """Batch-resolve MANY collections' OWN attached intro in ONE round trip
    (T5215 round 3 -- the Collections tab renders N cards; badging every one
    of them must not fire N separate requests). GET, not POST: this is a pure
    read (no `collection_settings` row is ever written here) -- keeping it a
    GET is also what lets the frontend call it from a plain data-loading
    useEffect without tripping the reactive-persistence lint rule, which
    flags non-GET verbs inside effects as a likely write-as-side-effect bug
    (CLAUDE.md's gesture-based persistence rule); a GET is unambiguous either
    way. `items` is a JSON-encoded array (querystring-safe for a small list;
    a real POST body isn't idiomatic for a request that mutates nothing).
    Each result echoes the item's OWN canonical key so the client can match
    by key rather than trusting array position. T6680: resolution no longer
    needs a duration (no inherit path left to gate), so every bucket costs
    one KV lookup only -- no member scan."""
    try:
        raw_items = json.loads(items)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"items must be a JSON array: {e}") from None
    parsed_items = [CollectionIntroBatchItem(**it) for it in raw_items]

    with get_db_connection() as conn:
        cursor = conn.cursor()
        results = []
        for item in parsed_items:
            tag_list, _definition = _collection_scope_and_definition(
                item.scope_type, item.aspect_ratio, item.game_id,
                ",".join(item.tags) if item.tags else None,
            )
            key = collection_intro_settings_key(
                item.scope_type, game_id=item.game_id, tags=tag_list,
                aspect_ratio=item.aspect_ratio,
            )
            raw_id = get_collection_intro_card_id(cursor, key)
            card = resolve_intro_card(raw_id, None, conn)
            results.append({
                "key": key,
                "intro_card_id": raw_id,
                "intro_card_name": card["name"] if card else None,
            })

    return {"results": results}


def _context_line(definition: dict) -> str:
    if definition["scope"]["type"] == "game":
        return "This link always shows the current reels for this game."
    return "This link always shows the current top reels."


def _evaluated_share_members(share: dict) -> tuple[dict, list, Any]:
    """(definition, evaluated members in playback order, resolved intro card row
    or None) for a collection share. Empty members + None intro on an
    unavailable sharer DB - never raises."""
    definition = share["collection_definition"]
    if isinstance(definition, str):
        definition = json.loads(definition)

    try:
        conn = open_profile_db_readonly(share["sharer_user_id"], share["sharer_profile_id"])
    except MigrationBlocked as e:
        logger.warning(
            f"[collection-share] sharer DB blocked at migration seam ({e.reason}) "
            f"for token={share['share_token']}"
        )
        return definition, [], None
    if conn is None:
        logger.warning(
            f"[collection-share] sharer DB unavailable for token={share['share_token']}"
        )
        return definition, [], None
    try:
        members = evaluate_collection_members(conn, definition)
        # T5215: the frozen value is ALWAYS concrete (id or 0) for a share
        # created by this task's `/share` endpoint, never NULL -- so the
        # duration gate is structurally unreachable here; collections are
        # never duration-gated, by construction. A share frozen BEFORE this
        # field existed has no `intro_card_id` key at all -- default that to 0
        # (no intro) rather than None, so a legacy link stays exactly as it
        # was (no retroactively-invented attachment, no spurious "unknown
        # duration" warning for a value that was never meant to be resolved).
        intro_card = resolve_intro_card(
            definition.get("intro_card_id", 0), reel_duration=None, profile_conn=conn,
        )
    finally:
        conn.close()

    budget = definition.get("budget_sec")
    if budget:
        members = select_within_budget(members, budget)
    return definition, members, intro_card


def first_member_poster_key(share: dict) -> str | None:
    """Full R2 key of the FIRST member's poster, or None when memberless.

    The collection unfurl card (og:image) shows the first reel's first frame -
    the same reel playback opens with."""
    from app.services.poster import poster_basename, poster_rel_path

    _, members, _ = _evaluated_share_members(share)
    if not members:
        return None
    rel = poster_rel_path(poster_basename(members[0]["filename"]))
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}/{rel}"
    )


def resolve_collection_share(share: dict) -> dict:
    """Evaluate a stored collection share against the sharer's profile DB (with
    R2 fallback) and presign each member. Read-only: never writes the sharer DB.
    Empty / DB-evicted membership -> still 200 with empty members + the title."""
    from app.services.poster import poster_basename, poster_rel_path

    definition, members, intro_card = _evaluated_share_members(share)
    title = definition.get("title") or "Highlights"
    base = {
        "title": title,
        "context_line": _context_line(definition),
        "aspect_ratio": definition["aspect_ratio"],
    }
    # T5215: id + name (preselection / display). T5220 (Scope B, design §3 row
    # 4): the FROZEN card also serializes the full pre-roll payload
    # ({card, previewUrl, field_values, profile}) under a single top-level
    # `intro` key -- ONCE for the whole share, not per member (first-segment
    # semantics: the pre-roll plays before the FIRST member, then
    # `CollectionPlayer` chains members as today). No resolution change here
    # -- `intro_card` above is already the frozen resolved row
    # (`_evaluated_share_members`, T5215); this only serializes it.
    intro_fields = {}
    if intro_card is not None:
        intro_fields["intro_card_id"] = intro_card["id"]
        intro_fields["intro_card_name"] = intro_card["name"]
        field_values = _load_field_values(share["sharer_user_id"], share["sharer_profile_id"])
        intro_payload = build_intro_playback_payload(intro_card, field_values)
        if intro_payload is not None:
            intro_fields["intro"] = intro_payload

    uid, pid = share["sharer_user_id"], share["sharer_profile_id"]
    out_members = []
    for m in members:
        key = f"{APP_ENV}/users/{uid}/profiles/{pid}/final_videos/{m['filename']}"
        out_members.append({
            "id": m["id"],
            "name": m["name"],
            "duration": m["duration"],
            "presigned_url": generate_presigned_url_global(key),
        })

    # T4890 follow-up: first member's poster as the unfurl image. STABLE relative
    # proxy path (never presigned - see shares._resolve_poster); the edge function
    # absolutizes it. Absent poster -> fields omitted, og:image omitted upstream.
    poster_fields = {}
    if out_members:
        rel = poster_rel_path(poster_basename(members[0]["filename"]))
        head = r2_head_object_global(f"{APP_ENV}/users/{uid}/profiles/{pid}/{rel}")
        if head is not None:
            meta = head.get("Metadata") or {}

            def _i(v):
                try:
                    return int(v) if v is not None else None
                except (TypeError, ValueError):
                    return None

            poster_fields = {
                "poster_url": f"/api/shared/collection/{share['share_token']}/poster.jpg",
                "poster_width": _i(meta.get("width")),
                "poster_height": _i(meta.get("height")),
            }

    return {**base, "members": out_members, **poster_fields, **intro_fields}


# ---- create endpoint (authenticated sharer) -------------------------------

def _format_budget(sec: float) -> str:
    s = round(sec)
    return f"{s // 60}:{s % 60:02d}"


def _smart_base_name(tags: list[str]) -> str:
    """Frozen share title for an all-scope tag filter, kept consistent with the
    in-app card names: a curated combo's name if the tag set matches one (across
    any sport), a pluralized single tag ('Top Goals'), else a sorted join."""
    fs = frozenset(tags)
    for combos in CURATED_COMBOS.values():
        for c in combos:
            if c["tags"] == fs:
                return c["name"]
    if len(tags) == 1:
        return "Top " + _pluralize(tags[0])
    return "Top " + " & ".join(sorted(tags))


def _build_collection_title(conn, d: CollectionDefinition) -> str:
    """Build the frozen share title server-side (don't trust the client title)."""
    ratio_word = RATIO_WORD.get(d.aspect_ratio, d.aspect_ratio)
    if d.scope.type == "game":
        from app.routers.downloads import _generate_game_display_name
        cur = conn.cursor()
        cur.execute(
            "SELECT name, game_date, opponent_name, game_type, tournament_name "
            "FROM games WHERE id = ?",
            (d.scope.game_id,),
        )
        g = cur.fetchone()
        base = (
            _generate_game_display_name(
                g["opponent_name"], g["game_date"], g["game_type"],
                g["tournament_name"], g["name"] or f"Game {d.scope.game_id}",
            )
            if g else f"Game {d.scope.game_id}"
        )
        base = f"{base} Game Highlights"
    elif d.scope.type == "mixes":
        base = "Mixes"
    else:  # all
        base = _smart_base_name(d.filter.tags) if d.filter.tags else "Top Plays"

    title = f"{base} - {ratio_word}"
    if d.budget_sec is not None:
        title += f" ({_format_budget(d.budget_sec)})"
    return title


def _canonical_definition(d: CollectionDefinition, title: str, intro_card_id: int) -> dict:
    """Canonical (dedup-stable) JSONB definition: sorted tags, omitted None
    fields, title + budget folded in (both are part of link identity).

    `intro_card_id` is the ALREADY-RESOLVED concrete value (T5215) -- the
    caller (`create_collection_share_endpoint`) turns the client's raw picker
    choice (id / 0 / "use my default") into a concrete id-or-0 BEFORE calling
    this, so the frozen JSONB never stores NULL and a later default change can
    never retroactively move an existing link. Always included (part of link
    identity, like title/budget) so `find_collection_share` dedup correctly
    treats two different intros as two different links."""
    scope: dict = {"type": d.scope.type}
    if d.scope.type == "game":
        scope["game_id"] = d.scope.game_id

    filt: dict = {}
    if d.filter.tags:
        filt["tags"] = sorted(set(d.filter.tags))
    if d.filter.min_rating is not None:
        filt["min_rating"] = d.filter.min_rating

    out: dict = {"scope": scope, "filter": filt,
                 "aspect_ratio": d.aspect_ratio, "title": title,
                 "intro_card_id": intro_card_id}
    if d.budget_sec is not None:
        out["budget_sec"] = round(float(d.budget_sec), 3)
    return out


@router.post("/share", response_model=CollectionShareResponse)
async def create_collection_share_endpoint(body: CollectionShareRequest):
    from app.services.auth_db import get_user_by_id

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    d = body.definition

    # T7510: the Share gesture IS the attempt; `share_completed` below is the
    # outcome. record_milestone is impersonation-guarded.
    record_milestone(user_id, "share_attempted")

    if d.scope.type == "game" and d.scope.game_id is None:
        raise HTTPException(400, "game scope requires game_id")

    # T5215: an EXPLICIT card pick requires consent (mirrors the reel PATCH --
    # "use my default"/None and 0/no-intro are never gated, same as detaching).
    if (d.intro_card_id is not None and d.intro_card_id != 0
            and get_intro_consent(user_id, profile_id) is None):
        raise HTTPException(
            status_code=403,
            detail="Parental consent is required before attaching an intro card.",
        )

    with get_db_connection() as conn:
        title = _build_collection_title(conn, d)
        cursor = conn.cursor()
        # T5215: freeze the picker choice to a CONCRETE value NOW (id or 0,
        # never NULL) -- this is what makes "changing the default later does
        # not retroactively change an existing shared link" true. T6680: there
        # is no profile default to freeze anymore -- "no explicit pick" (None)
        # freezes 0 (no intro), the same as an explicit 0.
        if d.intro_card_id is None or d.intro_card_id == 0:
            concrete_intro_id = 0
        else:
            cursor.execute("SELECT 1 FROM intro_cards WHERE id = ?", (d.intro_card_id,))
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail="Intro card not found")
            concrete_intro_id = d.intro_card_id
    definition = _canonical_definition(d, title, concrete_intro_id)

    recipient_emails = body.recipient_emails
    if not recipient_emails:
        if not body.is_public:
            raise HTTPException(400, "At least one recipient email is required")
        sharer = get_user_by_id(user_id)
        recipient_emails = [sharer["email"] if sharer else user_id]

    is_self_share = not body.recipient_emails and body.is_public

    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id

    results = []
    for email in recipient_emails:
        existing = find_collection_share(user_id, email, definition, body.is_public)
        token = existing or create_collection_share(
            user_id, profile_id, email, definition, body.is_public
        )
        results.append({
            "share_token": token,
            "recipient_email": email.lower().strip(),
            "is_existing_link": existing is not None,
        })

    record_milestone(user_id, "share_completed", {
        "recipient_count": len(recipient_emails),
        "share_type": "collection_public" if body.is_public else "collection_direct",
    })

    email_results: dict = {}
    if not is_self_share:
        import asyncio

        from app.services.email import (
            _is_existing_user,
            _resolve_sender_name,
            send_collection_share_email,
        )
        sender_name = _resolve_sender_name(sharer_email)
        tasks = {}
        for r in results:
            if r["is_existing_link"]:
                continue   # don't re-email an already-shared link
            if r["recipient_email"].lower() == sharer_email.lower():
                continue
            tasks[r["recipient_email"]] = send_collection_share_email(
                recipient_email=r["recipient_email"],
                sharer_email=sharer_email,
                share_token=r["share_token"],
                collection_title=title,
                sender_name=sender_name,
                is_first_touch=not _is_existing_user(r["recipient_email"]),
            )
        if tasks:
            sent = await asyncio.gather(*tasks.values())
            email_results = dict(zip(tasks.keys(), sent))
            for email in tasks:
                record_milestone(user_id, "invite_sent", {
                    "recipient_email": email, "share_type": "collection",
                })

    return CollectionShareResponse(
        title=title,
        shares=[
            CollectionShareRecipient(
                share_token=r["share_token"],
                recipient_email=r["recipient_email"],
                is_existing_link=r["is_existing_link"],
                email_sent=email_results.get(r["recipient_email"]),
            )
            for r in results
        ],
    )
