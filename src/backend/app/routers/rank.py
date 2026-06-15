"""
Reel ranking GAME endpoints (T3630).

Pairwise "this-or-that" ranking over the single-clip reel pool, per aspect ratio.
The engine is Glicko-1 (services/glicko.py); ratings are frozen-seeded at export
and only move on a user PICK -- there is no reactive or time-based write
(EPIC #5, gesture-only persistence). The middleware R2-syncs the profile DB after
each authenticated result.

Endpoints:
- GET  /api/rank/next?aspect_ratio=     -> {a, b} matchup (least-matched + nearest)
- POST /api/rank/result {winner_id,...}  -> Glicko update + twin sync + confidence
- GET  /api/rank/confidence?aspect_ratio= -> banner numbers

Per spec §4.3/§4.4/§5.3. The pool is single-clip reels only (clip_count == 1);
multi-clip reels live in Mixes and never rank.
"""

import logging
import random

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_db_connection
from app.queries import latest_final_videos_subquery
from app.routers.collections import COLLECTION_MIN_DURATION_SEC
from app.services.collection_metadata import route_collection
from app.services.glicko import update_one, confidence, RD_MAX
from app.utils.encoding import decode_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rank", tags=["ranking"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class MatchupSide(BaseModel):
    id: int
    name: str
    aspect_ratio: Optional[str] = None
    opponent_line: Optional[str] = None   # "vs Carlsbad - Dec 6" (None when game-less)
    minute: Optional[int] = None          # floor(clip_start_time/60)+1, soccer `33'`
    tags: List[str] = []
    stream_url: str                       # same-origin proxy (tap-to-replay)


class MatchupResponse(BaseModel):
    a: MatchupSide
    b: MatchupSide


class ConfidenceResponse(BaseModel):
    confidence_pct: int
    ranked_count: int    # reels with >= 1 matchup (match_count > 0)
    total: int           # rankable single-clip reels of the ratio
    total_sec: float     # total duration of the rankable pool (NULL-excluded)
    unranked_sec: float  # total duration of never-matched reels (NULL-excluded)
    eligible: bool       # unranked_sec >= COLLECTION_MIN_DURATION_SEC -> ranking is offered


class RankResultRequest(BaseModel):
    winner_id: int
    loser_id: int


# ---------------------------------------------------------------------------
# Pool + identity helpers
# ---------------------------------------------------------------------------

def _rankable_pool(cursor, aspect_ratio: str) -> list:
    """Single-clip, published, latest-version reels of one ratio that carry a
    rating (the ranking pool). Returns sqlite3.Row list ordered arbitrarily."""
    cursor.execute(
        f"""
        SELECT fv.id, fv.name, fv.aspect_ratio, fv.rating, fv.rd, fv.match_count,
               fv.source_clip_id, fv.clip_start_time, fv.game_ids, fv.tags, fv.clip_count,
               fv.duration
        FROM final_videos fv
        WHERE fv.id IN ({latest_final_videos_subquery()})
          AND fv.published_at IS NOT NULL
          AND fv.aspect_ratio = ?
          AND fv.clip_count = 1
          AND fv.rating IS NOT NULL
        """,
        (aspect_ratio,),
    )
    return cursor.fetchall()


def _games_info(cursor, rows) -> dict:
    """Batch {game_id: (opponent_name, game_date)} for the single game each
    single-clip reel routes to (frozen game_ids BLOB)."""
    game_ids = set()
    for r in rows:
        gid = route_collection(r["game_ids"], r["clip_count"])
        if gid is not None:
            game_ids.add(gid)
    info = {}
    if game_ids:
        placeholders = ",".join("?" for _ in game_ids)
        cursor.execute(
            f"SELECT id, opponent_name, game_date FROM games WHERE id IN ({placeholders})",
            list(game_ids),
        )
        for g in cursor.fetchall():
            info[g["id"]] = (g["opponent_name"], g["game_date"])
    return info


def _opponent_line(opponent_name, game_date) -> Optional[str]:
    """"vs Carlsbad - Dec 6" from a game's opponent + date (date optional)."""
    if not opponent_name:
        return None
    from datetime import datetime
    date_str = ""
    if game_date:
        try:
            dt = datetime.strptime(str(game_date)[:10], "%Y-%m-%d")
            date_str = dt.strftime("%b %d").replace(" 0", " ")
        except (ValueError, TypeError):
            date_str = str(game_date)
    return f"vs {opponent_name}" + (f" - {date_str}" if date_str else "")


def _minute(clip_start_time) -> Optional[int]:
    """Soccer-notation in-match minute: floor(sec/60)+1. None when unknown."""
    if clip_start_time is None:
        return None
    return int(clip_start_time // 60) + 1


def _side(row, games_info: dict) -> MatchupSide:
    gid = route_collection(row["game_ids"], row["clip_count"])
    opponent_name, game_date = games_info.get(gid, (None, None)) if gid is not None else (None, None)
    return MatchupSide(
        id=row["id"],
        name=row["name"] or f"Reel {row['id']}",
        aspect_ratio=row["aspect_ratio"],
        opponent_line=_opponent_line(opponent_name, game_date),
        minute=_minute(row["clip_start_time"]),
        tags=decode_data(row["tags"]) or [],
        stream_url=f"/api/downloads/{row['id']}/stream",
    )


# ---------------------------------------------------------------------------
# Pairing (spec §4.3)
# ---------------------------------------------------------------------------

def _pick_pair(pool: list, exclude_id: Optional[int]):
    """(candidate, opponent) from a rankable pool. candidate = lowest match_count
    (ties random); opponent = nearest rating (ties prefer lower match_count, then
    random), excluding the candidate and -- when possible -- `exclude_id` (the
    most recent opponent, to avoid a back-to-back repeat)."""
    if len(pool) < 2:
        return None, None

    min_mc = min(r["match_count"] for r in pool)
    candidates = [r for r in pool if r["match_count"] == min_mc]
    candidate = random.choice(candidates)

    others = [r for r in pool if r["id"] != candidate["id"]]
    # Drop the most-recent opponent unless it's the only one left.
    filtered = [r for r in others if r["id"] != exclude_id]
    opp_pool = filtered if filtered else others

    # Shuffle first so the (distance, match_count) min breaks final ties randomly.
    random.shuffle(opp_pool)
    opponent = min(
        opp_pool,
        key=lambda r: (abs(r["rating"] - candidate["rating"]), r["match_count"]),
    )
    return candidate, opponent


# ---------------------------------------------------------------------------
# Confidence (spec §4.2)
# ---------------------------------------------------------------------------

def _confidence_stats(cursor, aspect_ratio: str) -> ConfidenceResponse:
    pool = _rankable_pool(cursor, aspect_ratio)
    total = len(pool)
    if total == 0:
        return ConfidenceResponse(confidence_pct=0, ranked_count=0, total=0,
                                  total_sec=0.0, unranked_sec=0.0, eligible=False)
    mean_c = sum(confidence(r["rd"] if r["rd"] is not None else RD_MAX) for r in pool) / total
    ranked = sum(1 for r in pool if (r["match_count"] or 0) > 0)
    total_sec = sum(r["duration"] for r in pool if r["duration"] is not None)
    # Ranking is only OFFERED once a ratio has >= 30s of not-yet-ranked content
    # (never-matched single-clip reels). Once you've ranked it down past 30s, the
    # prompt retires until new publishes accumulate enough unranked material again.
    # total_sec lets the UI tell "not enough content yet" from "caught up".
    unranked_sec = sum(
        r["duration"] for r in pool
        if (r["match_count"] or 0) == 0 and r["duration"] is not None
    )
    return ConfidenceResponse(
        confidence_pct=round(mean_c * 100),
        ranked_count=ranked,
        total=total,
        total_sec=round(total_sec, 3),
        unranked_sec=round(unranked_sec, 3),
        eligible=unranked_sec >= COLLECTION_MIN_DURATION_SEC,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/next", response_model=Optional[MatchupResponse])
async def rank_next(aspect_ratio: str, exclude_id: Optional[int] = None):
    """Next matchup for a ratio. 204 (null body) when the pool has < 2 rankable
    reels. `exclude_id` (optional) is the previous opponent to avoid repeating."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        pool = _rankable_pool(cursor, aspect_ratio)
        candidate, opponent = _pick_pair(pool, exclude_id)
        if candidate is None:
            from fastapi import Response
            return Response(status_code=204)
        games_info = _games_info(cursor, [candidate, opponent])
        sides = [_side(candidate, games_info), _side(opponent, games_info)]
        random.shuffle(sides)  # random A/B order
        return MatchupResponse(a=sides[0], b=sides[1])


@router.post("/result", response_model=ConfidenceResponse)
async def rank_result(body: RankResultRequest):
    """Apply a pick: Glicko-1 update of winner (s=1) and loser (s=0), then TWIN
    SYNC -- write the new rating/rd + match_count+1 to EVERY published row sharing
    each reel's source_clip_id (ratio twins). Returns the winner ratio's banner
    numbers. GESTURE-ONLY: this is the sole rating write path (spec §5.3)."""
    if body.winner_id == body.loser_id:
        raise HTTPException(status_code=400, detail="winner_id and loser_id must differ")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        def _load(fid):
            cursor.execute(
                "SELECT id, rating, rd, source_clip_id, aspect_ratio, clip_count "
                "FROM final_videos WHERE id = ? AND published_at IS NOT NULL",
                (fid,),
            )
            return cursor.fetchone()

        winner = _load(body.winner_id)
        loser = _load(body.loser_id)
        if winner is None or loser is None:
            raise HTTPException(status_code=404, detail="Reel not found")
        # No silent fallback: a published single-clip reel without a rating is a
        # seed/backfill gap -- surface it rather than rank against a guessed value.
        if winner["rating"] is None or loser["rating"] is None:
            raise HTTPException(
                status_code=400,
                detail="Reel is not rankable (missing rating -- re-export or backfill)",
            )

        # Snapshot BOTH pre-update values; each player updates against the other's
        # pre-update rating/RD (Glicko is symmetric within a rating period).
        wr, wrd = winner["rating"], winner["rd"] if winner["rd"] is not None else RD_MAX
        lr, lrd = loser["rating"], loser["rd"] if loser["rd"] is not None else RD_MAX
        new_wr, new_wrd = update_one(wr, wrd, lr, lrd, 1.0)
        new_lr, new_lrd = update_one(lr, lrd, wr, wrd, 0.0)

        _apply_twin_sync(cursor, winner, new_wr, new_wrd)
        _apply_twin_sync(cursor, loser, new_lr, new_lrd)
        conn.commit()

        return _confidence_stats(cursor, winner["aspect_ratio"])


def _apply_twin_sync(cursor, reel, new_rating: float, new_rd: float) -> None:
    """Write (rating, rd, match_count+1) to every published final_videos row that
    shares this reel's source_clip_id (its Portrait/Landscape twins). Orphaned
    reels (source_clip_id NULL) update only their own row (per-reel rating)."""
    if reel["source_clip_id"] is not None:
        cursor.execute(
            "UPDATE final_videos SET rating = ?, rd = ?, match_count = COALESCE(match_count, 0) + 1 "
            "WHERE source_clip_id = ? AND published_at IS NOT NULL",
            (new_rating, new_rd, reel["source_clip_id"]),
        )
    else:
        cursor.execute(
            "UPDATE final_videos SET rating = ?, rd = ?, match_count = COALESCE(match_count, 0) + 1 "
            "WHERE id = ?",
            (new_rating, new_rd, reel["id"]),
        )


@router.get("/confidence", response_model=ConfidenceResponse)
async def rank_confidence(aspect_ratio: str):
    """Collection Confidence banner numbers for one ratio (spec §4.2)."""
    with get_db_connection() as conn:
        return _confidence_stats(conn.cursor(), aspect_ratio)
