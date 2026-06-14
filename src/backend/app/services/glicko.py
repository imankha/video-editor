"""
Glicko-1 rating engine for reel ranking (T3630).

Each user pick (A beats B) is treated as a one-game rating period: both reels'
ratings move and both RDs shrink toward RD_MIN. There is no time-based RD
inflation in v1 -- RD only shrinks on play (spec §4.1, decision #1/#2).

A rating is keyed by the SOURCE CLIP (final_videos.source_clip_id) so a Portrait
reel and its Landscape twin share one value; the result endpoint applies the
computed update to every row sharing that source clip (spec §4.4).

Pure math, no DB. The endpoint reads both players' pre-update (rating, rd),
computes each update against the OPPONENT'S pre-update values, then writes both.
"""

import math

# ln(10) / 400 -- the Glicko scaling constant q.
Q = math.log(10) / 400.0  # ~0.0057565

RD_MAX = 350.0  # uncertainty of a never-matched (seeded) reel
RD_MIN = 50.0   # floor -- a reel never becomes infinitely certain

# Rating seed: 5 star -> 1580, 3 star -> 1500, 1 star -> 1420.
SEED_BASE = 1500.0
SEED_PER_STAR = 40.0
SEED_STAR_PIVOT = 3.0


def seed_rating(quality_score) -> float:
    """Seed a reel's rating from its frozen star (quality_score). NULL star ->
    the neutral 1500 (no silent star guess; an unrated single-clip reel simply
    starts neutral)."""
    if quality_score is None:
        return SEED_BASE
    return SEED_BASE + (float(quality_score) - SEED_STAR_PIVOT) * SEED_PER_STAR


def _g(rd: float) -> float:
    """Glicko g(RD): how much an opponent's RD attenuates the rating exchange."""
    return 1.0 / math.sqrt(1.0 + 3.0 * (Q ** 2) * (rd ** 2) / (math.pi ** 2))


def expected_score(rating: float, opp_rating: float, opp_rd: float) -> float:
    """E: probability `rating` beats an opponent of (opp_rating, opp_rd)."""
    return 1.0 / (1.0 + 10.0 ** (-_g(opp_rd) * (rating - opp_rating) / 400.0))


def update_one(rating: float, rd: float,
               opp_rating: float, opp_rd: float, score: float) -> tuple[float, float]:
    """Single-game Glicko-1 update of one player against ONE opponent.

    `score` is 1.0 for a win, 0.0 for a loss. Returns (new_rating, new_rd).
    Pass the opponent's PRE-update (opp_rating, opp_rd) -- both players in a pick
    must be updated from each other's pre-update values, so the caller snapshots
    both before applying either."""
    g_opp = _g(opp_rd)
    e = expected_score(rating, opp_rating, opp_rd)
    # d^2: estimated variance of the rating from this one game.
    d2 = 1.0 / ((Q ** 2) * (g_opp ** 2) * e * (1.0 - e))
    inv = 1.0 / (rd ** 2) + 1.0 / d2
    new_rd = max(RD_MIN, math.sqrt(1.0 / inv))
    new_rating = rating + (Q / inv) * g_opp * (score - e)
    return new_rating, new_rd


def confidence(rd: float) -> float:
    """Per-clip confidence in [0,1]: 0 at RD_MAX (never matched), 1 at RD_MIN.
    Linear in RD between the two (spec §4.2)."""
    c = 1.0 - (rd - RD_MIN) / (RD_MAX - RD_MIN)
    return max(0.0, min(1.0, c))
