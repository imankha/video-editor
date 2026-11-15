"""Admin referral-stats endpoints (T2910): leaderboard, by channel, per user, tree.

Split out of routers/admin.py by T5940; every URL is unchanged."""

import logging

from fastapi import APIRouter, Depends

from . import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# Referral stats (T2910)
# ---------------------------------------------------------------------------

@router.get("/referrals/leaderboard")
async def referral_leaderboard():
    """Referral counts per user, ordered descending."""
    from ...services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT r.referrer_id, u.email, COUNT(*) AS referral_count
            FROM referrals r
            JOIN users u ON u.user_id = r.referrer_id
            GROUP BY r.referrer_id, u.email
            ORDER BY referral_count DESC
        """)
        return cur.fetchall()


@router.get("/referrals/by-channel")
async def referrals_by_channel():
    """Referral counts broken down by channel."""
    from ...services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT channel, COUNT(*) AS count
            FROM referrals
            GROUP BY channel
            ORDER BY count DESC
        """)
        return cur.fetchall()


@router.get("/referrals/user/{user_id}")
async def referrals_for_user(user_id: str):
    """Direct referrals for a single user."""
    from ...services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT r.referred_id, u.email, r.channel, r.source_id, r.created_at
            FROM referrals r
            JOIN users u ON u.user_id = r.referred_id
            WHERE r.referrer_id = %s
            ORDER BY r.created_at DESC
        """, (user_id,))
        return cur.fetchall()


@router.get("/referrals/tree/{user_id}")
async def referral_tree(user_id: str):
    """Recursive referral tree size (depth <= 5)."""
    from ...services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            WITH RECURSIVE tree AS (
                SELECT referred_id, 1 AS depth
                FROM referrals WHERE referrer_id = %s
                UNION ALL
                SELECT r.referred_id, t.depth + 1
                FROM referrals r
                JOIN tree t ON r.referrer_id = t.referred_id
                WHERE t.depth < 5
            )
            SELECT depth, COUNT(*) AS count FROM tree GROUP BY depth ORDER BY depth
        """, (user_id,))
        rows = cur.fetchall()
        total = sum(r["count"] for r in rows)
        return {"user_id": user_id, "total": total, "by_depth": rows}
