"""
Storage credits — size-based upload cost and R2 cleanup.

Game videos are metered: users pay credits on upload, get 30 days of storage,
and can extend via T1581. Final/working videos are prepaid at export time.

The cost formula ensures R2 costs are recovered with a 10% margin:
    cost = max(1, ceil(size_gb * R2_RATE * (days / 30) * (1 + MARGIN) / CREDIT_VALUE))
"""

import logging
import math
from datetime import datetime, timedelta

from ..pricing import CREDIT_VALUE  # worst-case $/credit, derived from pricing.json (T10210)

logger = logging.getLogger(__name__)

# R2 cost basis
R2_RATE_PER_GB_MONTH = 0.015  # $/GB/month
MARGIN = 0.10

# Storage defaults
STORAGE_DURATION_DAYS = 30
EXPIRY_VISIBLE_DAYS = 28
NEW_ACCOUNT_CREDITS = 8
AUTO_EXPORT_SURCHARGE = 1

# T11170: the "welcome" credit grant, moved off the quest system. A new user gets
# NEW_ACCOUNT_CREDITS (8) + WELCOME_CREDITS (80) = 88 total, the number advertised
# on the landing page (src/landing/src/site.ts `freeCredits: 88`). This replaces
# the old quest-chain grant (quest_config.QUEST_CHAIN_CREDIT_TOTAL) so removing the
# quest system never silently drops new signups to 8 credits. Amount frozen at 80
# by owner ruling G1 (docs/plans/tasks/quest-removal/EPIC.md).
WELCOME_CREDITS = 80


def calculate_storage_cost(file_size_bytes: int, days: int = STORAGE_DURATION_DAYS) -> int:
    size_gb = file_size_bytes / (1024 ** 3)
    return max(1, math.ceil(
        size_gb * R2_RATE_PER_GB_MONTH * (days / 30) * (1 + MARGIN) / CREDIT_VALUE
    ))


def calculate_upload_cost(file_size_bytes: int, days: int = STORAGE_DURATION_DAYS) -> int:
    return calculate_storage_cost(file_size_bytes, days) + AUTO_EXPORT_SURCHARGE


def calculate_extension_cost(file_size_bytes: int, days: int) -> int:
    return calculate_storage_cost(file_size_bytes, days)


def storage_expires_at(from_dt: datetime | None = None, days: int = STORAGE_DURATION_DAYS) -> datetime:
    base = from_dt or datetime.utcnow()
    return base + timedelta(days=days)


# ---------------------------------------------------------------------------
# T11170: welcome credit grant. Moved here verbatim from
# credit_ledger.grant_quest_chain_credits so the grant no longer depends on the
# quest system (quest_config). Same logic, same remainder calculation, same ONE
# write site through session_init. The ledger SOURCE and KEY strings
# (`quest_upfront` / `questbank:`) are DELIBERATELY UNCHANGED -- see the frozen-
# string comments in credit_ledger.py. Renaming either would make the remainder
# calc below see 0 already-granted and pay the 80 again to every existing
# account. Never rename them. The credit_ledger helpers are imported inside the
# function (matching the original's function-local import) to avoid any import
# cycle at module load.
# ---------------------------------------------------------------------------

def grant_welcome_credits(user_id: str) -> dict:
    """Grant the ungranted remainder of the welcome credit total upfront.

    Returns {applied, granted, balance}. applied=False (granted=0) when the user
    has already received the full total: a brand-new signup gets the whole
    WELCOME_CREDITS; an existing account that already claimed some legacy per-quest
    rewards (source='quest_reward') gets only what's left; a fully-granted user
    gets nothing. Safe to call on every login -- steady state is one indexed
    SELECT. Idempotent two ways: a fixed per-user idempotency key
    (questbank:{user_id}) makes grant() itself refuse a second application, AND the
    remainder is computed from what the user has already been granted (prior
    quest_reward claims + a prior upfront grant), so a repeat call computes 0.
    """
    from .credit_ledger import (
        _granted_quest_chain_credits,
        _require_ready,
        credit_key,
        get_balance,
        grant,
    )
    from .pg import get_pg

    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        already = _granted_quest_chain_credits(cur, user_id)
    remainder = WELCOME_CREDITS - already
    if remainder <= 0:
        logger.info(
            f"[StorageCredits] welcome-credits no-op user={user_id} "
            f"(already granted {already}/{WELCOME_CREDITS})"
        )
        return {"applied": False, "granted": 0, "balance": get_balance(user_id)}
    result = grant(
        user_id, remainder, "quest_upfront",
        credit_key("quest_upfront", user_id),
        reference_id=user_id,
    )
    granted = remainder if result["applied"] else 0
    logger.info(
        f"[StorageCredits] welcome-credits user={user_id} remainder={remainder} "
        f"applied={result['applied']} balance={result['balance']}"
    )
    return {"applied": result["applied"], "granted": granted, "balance": result["balance"]}
