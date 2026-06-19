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

import json
import logging
from datetime import datetime
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.analytics import record_milestone
from app.database import get_db_connection
from app.profile_context import get_current_profile_id
from app.queries import exclude_teammate_reels_clause, latest_final_videos_subquery
from app.services.collection_metadata import route_game_ids, route_collection, ORDER_BY_RANK
from app.services.materialization import open_profile_db_readonly
from app.services.sharing_db import (
    create_collection_share,
    find_collection_share,
)
from app.storage import APP_ENV, generate_presigned_url_global
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
}


def _curated_for(sport: Optional[str]) -> list:
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
    ratio_counts: Dict[str, int]
    ratio_durations: Dict[str, float]      # NULL-excluded sums per ratio
    ratio_eligible: Dict[str, bool]        # ratio_durations[r] >= threshold
    total_duration: float                  # NULL-excluded
    has_null_durations: bool
    latest_published_at: Optional[str]


class GameCollection(RatioBucketed):
    game_id: int
    game_name: str
    game_date: Optional[str]


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
    tags: Optional[List[str]]              # member fetch: ?tags=...; None => all reels
    nudge_when_locked: bool                # True => amber locked card sub-30s; False => hide until ready


class CollectionsSummaryResponse(BaseModel):
    smart_collections: List[SmartCollection]  # curated (Top Plays + combos) then ready per-tag
    games: List[GameCollection]            # sorted latest_published_at DESC
    mixes: RatioBucketed                   # always present, may be reel_count 0
    season_totals: List[SeasonTotal]
    tag_totals: List[TagTotal]
    total_reel_count: int                  # == list_downloads().total_count


# ---------------------------------------------------------------------------
# Accumulation helpers
# ---------------------------------------------------------------------------

def _utc(ts: Optional[str]) -> Optional[str]:
    """Normalize a SQLite timestamp to ISO-UTC ('...Z') like downloads.py, so
    JS parses it and lexical comparison orders it correctly."""
    if ts and not ts.endswith("Z"):
        return ts.replace(" ", "T") + "Z"
    return ts


def _new_bucket() -> dict:
    return {
        "reel_count": 0,
        "ratio_counts": {},
        "ratio_durations": {},
        "total_duration": 0.0,
        "has_null_durations": False,
        "latest_published_at": None,
    }


def _add_reel(bucket: dict, ratio: str, duration, published_at: Optional[str]) -> None:
    bucket["reel_count"] += 1
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
        "ratio_counts": dict(bucket["ratio_counts"]),
        "ratio_durations": ratio_durations,
        "ratio_eligible": ratio_eligible,
        "total_duration": round(bucket["total_duration"], 3),
        "has_null_durations": bucket["has_null_durations"],
        "latest_published_at": bucket["latest_published_at"],
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


def _season_key(date_str: Optional[str], season_fn) -> Optional[str]:
    """'<Season> <Year>' from a 'YYYY-MM-DD[...]' string, or None if unparseable."""
    if not date_str:
        return None
    try:
        normalized = date_str.replace("T", " ").replace("Z", "").strip()
        dt = datetime.strptime(normalized[:10], "%Y-%m-%d")
    except (ValueError, AttributeError):
        return None
    return f"{season_fn(dt.month)} {dt.year}"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=CollectionsSummaryResponse)
async def collections_summary(sport: Optional[str] = None):
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
                   fv.tags, fv.created_at, fv.published_at, fv.clip_count
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
                "ratio": ratio,
                "duration": row["duration"],
                "published_at": _utc(row["published_at"]),
                "created_at": row["created_at"],
                "game_id": game_id,
                "single_clip": single_clip,
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
                }

        # Pass 2: build buckets + season/tag totals + smart-collection buckets.
        game_buckets: Dict[int, dict] = {}
        mixes = _new_bucket()
        season_acc: dict = {}
        tag_acc: dict = {}
        curated_defs = _curated_for(sport)
        curated_buckets = {d["key"]: _new_bucket() for d in curated_defs}
        tag_buckets: Dict[str, dict] = {}   # per-tag dynamic collections

        for p in parsed:
            ratio, duration, gid = p["ratio"], p["duration"], p["game_id"]

            # Multi-clip reels are NOT collection-eligible (T3630): they only
            # count toward Mixes, never game/smart/season.
            if not p["single_clip"]:
                _add_reel(mixes, ratio, duration, p["published_at"])
                continue

            bucket = (game_buckets.setdefault(gid, _new_bucket())
                      if gid is not None else mixes)
            _add_reel(bucket, ratio, duration, p["published_at"])

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
                          ratio, duration, p["published_at"])

            # Curated collections: per-reel membership (tag-less group = all),
            # so a multi-tag reel is counted once per matching group.
            for d in curated_defs:
                if d["tags"] is None or (reel_tags & d["tags"]):
                    _add_reel(curated_buckets[d["key"]], ratio, duration, p["published_at"])

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
    game_id: Optional[int] = None


class CollectionFilter(BaseModel):
    tags: Optional[List[str]] = None
    min_rating: Optional[int] = None   # accepted but inert until a rating filter exists


class CollectionDefinition(BaseModel):
    scope: CollectionScope
    filter: CollectionFilter = Field(default_factory=CollectionFilter)
    aspect_ratio: Literal["9:16", "16:9"]
    budget_sec: Optional[float] = None
    title: Optional[str] = None          # server overwrites with a frozen title


class CollectionShareRequest(BaseModel):
    definition: CollectionDefinition
    recipient_emails: List[str] = []
    is_public: bool = False


class CollectionShareRecipient(BaseModel):
    share_token: str
    recipient_email: str
    is_existing_link: bool               # surfaced an existing link (dedup)
    email_sent: Optional[bool] = None


class CollectionShareResponse(BaseModel):
    shares: List[CollectionShareRecipient]
    title: str


# ---- membership evaluation (shared by resolve; reuses list_downloads' chain) --

def select_within_budget(members: List[dict], budget_sec: float) -> List[dict]:
    """Greedy-with-skip selection of members that fit the budget, in order
    (Python port of frontend budget.js::selectWithinBudget). NULL-duration
    members can't be budgeted; guarantees at least one member when any has a
    duration so a shared link is never empty for a non-empty collection."""
    out: List[dict] = []
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


def evaluate_collection_members(conn, definition: dict) -> List[dict]:
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


def _context_line(definition: dict) -> str:
    if definition["scope"]["type"] == "game":
        return "This link always shows the current reels for this game."
    return "This link always shows the current top reels."


def resolve_collection_share(share: dict) -> dict:
    """Evaluate a stored collection share against the sharer's profile DB (with
    R2 fallback) and presign each member. Read-only: never writes the sharer DB.
    Empty / DB-evicted membership -> still 200 with empty members + the title."""
    definition = share["collection_definition"]
    if isinstance(definition, str):
        definition = json.loads(definition)

    title = definition.get("title") or "Highlights"
    base = {
        "title": title,
        "context_line": _context_line(definition),
        "aspect_ratio": definition["aspect_ratio"],
    }

    conn = open_profile_db_readonly(share["sharer_user_id"], share["sharer_profile_id"])
    if conn is None:
        logger.warning(
            f"[collection-share] sharer DB unavailable for token={share['share_token']}"
        )
        return {**base, "members": []}
    try:
        members = evaluate_collection_members(conn, definition)
    finally:
        conn.close()

    budget = definition.get("budget_sec")
    if budget:
        members = select_within_budget(members, budget)

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
    return {**base, "members": out_members}


# ---- create endpoint (authenticated sharer) -------------------------------

def _format_budget(sec: float) -> str:
    s = int(round(sec))
    return f"{s // 60}:{s % 60:02d}"


def _smart_base_name(tags: List[str]) -> str:
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


def _canonical_definition(d: CollectionDefinition, title: str) -> dict:
    """Canonical (dedup-stable) JSONB definition: sorted tags, omitted None
    fields, title + budget folded in (both are part of link identity)."""
    scope: dict = {"type": d.scope.type}
    if d.scope.type == "game":
        scope["game_id"] = d.scope.game_id

    filt: dict = {}
    if d.filter.tags:
        filt["tags"] = sorted(set(d.filter.tags))
    if d.filter.min_rating is not None:
        filt["min_rating"] = d.filter.min_rating

    out: dict = {"scope": scope, "filter": filt,
                 "aspect_ratio": d.aspect_ratio, "title": title}
    if d.budget_sec is not None:
        out["budget_sec"] = round(float(d.budget_sec), 3)
    return out


@router.post("/share", response_model=CollectionShareResponse)
async def create_collection_share_endpoint(body: CollectionShareRequest):
    from app.services.auth_db import get_user_by_id

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    d = body.definition

    if d.scope.type == "game" and d.scope.game_id is None:
        raise HTTPException(400, "game scope requires game_id")

    with get_db_connection() as conn:
        title = _build_collection_title(conn, d)
    definition = _canonical_definition(d, title)

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
            send_collection_share_email, _resolve_sender_name, _is_existing_user,
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
