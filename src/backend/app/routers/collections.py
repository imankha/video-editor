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

import logging
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.database import get_db_connection
from app.queries import latest_final_videos_subquery
from app.services.collection_metadata import route_game_ids
from app.utils.encoding import decode_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collections", tags=["collections"])

# A (scope, ratio) becomes a collection only at or above this much published
# content. Server-computed so clients never derive eligibility (EPIC #13).
COLLECTION_MIN_DURATION_SEC = 30

# Smart collections (T3670, pulled forward). A reel joins a group iff the group
# is tag-less (top_plays = all) or the reel carries ANY of the group's tags;
# membership is a per-reel boolean, so a Goal+Assist reel is counted once.
# Member fetch: top_plays -> GET /api/downloads (no filter); the others ->
# GET /api/downloads?tags=<comma list>.
SMART_COLLECTIONS = [
    {"key": "top_plays", "name": "Top Plays", "tags": None},
    {"key": "top_goals_assists", "name": "Top Goals & Assists",
     "tags": frozenset({"Goal", "Assist"})},
    {"key": "top_dribbles", "name": "Top Dribbles", "tags": frozenset({"Dribble"})},
]


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


class SmartCollection(RatioBucketed):      # T3670: Top Plays / Goals & Assists / Dribbles
    key: str
    name: str


class CollectionsSummaryResponse(BaseModel):
    smart_collections: List[SmartCollection]  # SMART_COLLECTIONS order, reel_count > 0 only
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
async def collections_summary():
    """Per-game / mixes / season / tag aggregates for the Collections tab."""
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
                   fv.tags, fv.created_at, fv.published_at
            FROM final_videos fv
            WHERE fv.id IN ({latest_final_videos_subquery()})
              AND fv.published_at IS NOT NULL
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
            game_id = route_game_ids(row["game_ids"])
            if game_id is not None:
                resolved_game_ids.add(game_id)
            parsed.append({
                "ratio": ratio,
                "duration": row["duration"],
                "published_at": _utc(row["published_at"]),
                "created_at": row["created_at"],
                "game_id": game_id,
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
        smart_buckets = {sc["key"]: _new_bucket() for sc in SMART_COLLECTIONS}

        for p in parsed:
            ratio, duration, gid = p["ratio"], p["duration"], p["game_id"]
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

            # Smart collections: per-reel membership (tag-less group = all),
            # so a multi-tag reel is counted once per matching group.
            for sc in SMART_COLLECTIONS:
                if sc["tags"] is None or (reel_tags & sc["tags"]):
                    _add_reel(smart_buckets[sc["key"]], ratio, duration, p["published_at"])

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

    # Smart collections in defined order; omit empties (a group with no matching reels).
    smart_collections = [
        SmartCollection(key=sc["key"], name=sc["name"],
                        **_finalize_bucket(smart_buckets[sc["key"]]))
        for sc in SMART_COLLECTIONS
        if smart_buckets[sc["key"]]["reel_count"] > 0
    ]

    return CollectionsSummaryResponse(
        smart_collections=smart_collections,
        games=games,
        mixes=RatioBucketed(**_finalize_bucket(mixes)),
        season_totals=season_totals,
        tag_totals=tag_totals,
        total_reel_count=len(parsed),
    )
