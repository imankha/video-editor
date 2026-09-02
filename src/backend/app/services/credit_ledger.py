"""
Credit ledger — Postgres-backed money balance (T5840).

Single source of truth for credits + credit_transactions. Replaces the per-user
SQLite implementation that used to live in user_db.py (grant_credits/deduct_credits/
etc): that model replicated the WHOLE user.sqlite file last-write-wins, had no real
idempotency key (NULL reference_id for admin/signup grants), and read-modify-wrote
balances non-atomically. See docs/plans/tasks/T5840-design.md.

Two write primitives, each ONE Postgres transaction:
  - grant(): adds credits. Idempotent via UNIQUE(user_id, idempotency_key) --
    a retry with the same key changes nothing and reports applied=False.
  - debit(): removes credits. The ledger row is written FIRST (the idempotency
    key is the concurrency token); the balance UPDATE's `WHERE balance >= n`
    predicate takes a row lock, so concurrent debits serialize and an
    insufficient balance rolls the whole transaction back -- no state where a
    debit row exists without the matching balance change, and no negative
    balance (`CHECK (balance >= 0)` is belt-and-braces).

credits_ready gate: every mutation (grant/debit/set_balance) checks
credit_migration_state.ready_at and raises CreditsUnavailable (-> HTTP 503) until
an admin has confirmed the backfill report shows zero drift. Reads (get_balance,
list_transactions, has_key, stats_for_admin) are never gated.
"""

import logging

from .pg import get_pg

logger = logging.getLogger(__name__)


class CreditsUnavailable(Exception):
    """Raised when the credits_ready gate is closed. Routers map this to HTTP 503."""


# Cached after the first successful read (per design 4a) -- once ready, a
# migration cutover is never reversed, so re-checking every call buys nothing.
_ready_cache: bool | None = None


def _is_ready() -> bool:
    global _ready_cache
    if _ready_cache:
        return True
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT ready_at FROM credit_migration_state WHERE id = 1")
        row = cur.fetchone()
    ready = bool(row and row["ready_at"] is not None)
    if ready:
        _ready_cache = True
    return ready


def _require_ready() -> None:
    if not _is_ready():
        raise CreditsUnavailable(
            "Credits are not yet available on Postgres (migration in progress)"
        )


def reset_ready_cache_for_tests() -> None:
    """Test-only: clear the process-cached gate state between tests."""
    global _ready_cache
    _ready_cache = None


# ---------------------------------------------------------------------------
# Idempotency-key derivation -- ONE definition, used by runtime AND backfill
# (design 2d/3c). Any new call site must register its source here rather than
# inventing a key format ad hoc.
# ---------------------------------------------------------------------------

KEY_PREFIX = {
    "stripe_purchase": "stripe",
    "quest_reward": "quest",
    # T8120: upfront quest-chain grant. Distinct key space from new_account_bonus
    # (signup:) and per-quest quest_reward (quest:) so all three coexist without
    # colliding idempotency keys.
    "quest_upfront": "questbank",
    "new_account_bonus": "signup",
    "admin_grant": "admin",
    "admin_set": "adminset",
    "game_upload": "game_upload",
    "storage_extension": "storage_ext",
    "framing_usage": "export",
    "framing_refund": "refund",
}


def credit_key(source: str, reference_id: str) -> str:
    """Derive the idempotency key for a registered source. Raises for an
    unregistered source -- that is a programming error, not a runtime one."""
    prefix = KEY_PREFIX.get(source)
    if not prefix:
        raise ValueError(f"[CreditLedger] no idempotency-key prefix registered for source={source!r}")
    return f"{prefix}:{reference_id}"


# ---------------------------------------------------------------------------
# Core primitives
# ---------------------------------------------------------------------------

def grant(
    user_id: str,
    amount: int,
    source: str,
    key: str,
    reference_id: str | None = None,
    video_seconds: float | None = None,
) -> dict:
    """Idempotent credit grant. Returns {applied: bool, balance: int}.

    applied=False means a prior grant under this SAME key already ran (a
    retry) -- balance is returned unchanged, nothing was double-credited.
    """
    if amount <= 0:
        raise ValueError("grant amount must be positive")
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO credits (user_id, balance) VALUES (%s, 0) ON CONFLICT DO NOTHING",
            (user_id,),
        )
        cur.execute(
            """
            WITH ins AS (
                INSERT INTO credit_transactions
                    (user_id, amount, source, idempotency_key, reference_id, video_seconds)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, idempotency_key) DO NOTHING
                RETURNING amount
            ), upd AS (
                UPDATE credits SET balance = balance + (SELECT amount FROM ins), updated_at = now()
                WHERE user_id = %s AND EXISTS (SELECT 1 FROM ins)
                RETURNING balance
            )
            SELECT (SELECT balance FROM upd) AS new_balance,
                   EXISTS(SELECT 1 FROM ins) AS applied
            """,
            (user_id, amount, source, key, reference_id, video_seconds, user_id),
        )
        row = cur.fetchone()
        applied = bool(row["applied"])
        if applied:
            balance = row["new_balance"]
        else:
            cur.execute("SELECT balance FROM credits WHERE user_id = %s", (user_id,))
            b = cur.fetchone()
            balance = b["balance"] if b else 0
    logger.info(
        f"[CreditLedger] grant user={user_id} amount={amount} source={source} "
        f"key={key} applied={applied} balance={balance}"
    )
    return {"applied": applied, "balance": balance}


def debit(
    user_id: str,
    amount: int,
    source: str,
    key: str,
    video_seconds: float | None = None,
    reference_id: str | None = None,
) -> dict:
    """Idempotent, overdraft-proof debit. Returns {ok, applied, balance, required}.

    ok=False means insufficient balance (402 territory) -- the ledger row from
    this attempt was rolled back, nothing partial survives.
    applied=False (with ok=True) means a retry under this SAME key: the
    original debit already ran, this call changed nothing.
    """
    if amount <= 0:
        raise ValueError("debit amount must be positive")
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO credits (user_id, balance) VALUES (%s, 0) ON CONFLICT DO NOTHING",
            (user_id,),
        )
        cur.execute(
            """
            INSERT INTO credit_transactions (user_id, amount, source, idempotency_key, reference_id, video_seconds)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, idempotency_key) DO NOTHING
            RETURNING id
            """,
            (user_id, -amount, source, key, reference_id, video_seconds),
        )
        inserted = cur.fetchone()
        if inserted is None:
            cur.execute("SELECT balance FROM credits WHERE user_id = %s", (user_id,))
            b = cur.fetchone()
            balance = b["balance"] if b else 0
            logger.info(
                f"[CreditLedger] debit user={user_id} amount={amount} source={source} "
                f"key={key} applied=False (retry) balance={balance}"
            )
            return {"ok": True, "applied": False, "balance": balance, "required": amount}

        cur.execute(
            """
            UPDATE credits SET balance = balance - %s, updated_at = now()
            WHERE user_id = %s AND balance >= %s
            RETURNING balance
            """,
            (amount, user_id, amount),
        )
        updated = cur.fetchone()
        if updated is None:
            conn.rollback()
            cur.execute("SELECT balance FROM credits WHERE user_id = %s", (user_id,))
            b = cur.fetchone()
            balance = b["balance"] if b else 0
            logger.info(
                f"[CreditLedger] debit REFUSED (insufficient) user={user_id} "
                f"required={amount} balance={balance}"
            )
            return {"ok": False, "applied": False, "balance": balance, "required": amount}
        balance = updated["balance"]
    logger.info(
        f"[CreditLedger] debit user={user_id} amount={amount} source={source} "
        f"key={key} applied=True balance={balance}"
    )
    return {"ok": True, "applied": True, "balance": balance, "required": amount}


def set_balance(user_id: str, amount: int, key: str, reference_id: str | None = None) -> dict:
    """Admin set-to-exact-value. Returns {applied, balance, delta}.

    Uses SELECT ... FOR UPDATE to hold the row lock across the read+write --
    that's what makes this safe against a concurrent grant/debit landing
    between the read and the write (the SQLite version's smell: it read
    old_balance then wrote an absolute value with nothing serializing the two).

    M3 fix (T5840 review round 2): `applied` must distinguish a GENUINE retry
    (same key already used -> False) from a first-time call that happens to
    already match the current balance (delta==0 but never applied before ->
    True, nothing to insert since CHECK(amount<>0) forbids a zero-amount row).
    The old code decided `applied` from `delta == 0` alone, so a real retry
    (second call, same key, same amount -- delta is now 0 because the FIRST
    call already moved the balance) reported `applied=True`, which the admin
    UI then showed as a fresh "Credits updated!" even though nothing happened
    on this call. Checking the key FIRST closes that gap.
    """
    if amount < 0:
        raise ValueError("set_balance amount cannot be negative")
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO credits (user_id, balance) VALUES (%s, 0) ON CONFLICT DO NOTHING",
            (user_id,),
        )
        cur.execute("SELECT balance FROM credits WHERE user_id = %s FOR UPDATE", (user_id,))
        row = cur.fetchone()
        # N1: the ensure-then-read pair is safe under normal concurrent
        # grant/debit/reserve (Postgres blocks our INSERT on an uncommitted
        # conflicting row, so the SELECT always finds SOMETHING once our
        # statement returns) -- but a concurrent account purge
        # (_purge_user_data DELETEs credits/credit_transactions) can still
        # remove the row between our INSERT and this SELECT. Treat that as a
        # fresh zero balance rather than raising TypeError on `None["balance"]`.
        old_balance = row["balance"] if row else 0
        delta = amount - old_balance

        cur.execute(
            "SELECT 1 FROM credit_transactions WHERE user_id = %s AND idempotency_key = %s",
            (user_id, key),
        )
        if cur.fetchone() is not None:
            # Genuine retry (same amount) OR a reused key with a DIFFERENT
            # target amount -- either way this call changes nothing; never
            # silently reinterpret a reused key as a new target.
            return {"applied": False, "balance": old_balance, "delta": delta}

        if delta == 0:
            return {"applied": True, "balance": old_balance, "delta": 0}

        cur.execute(
            """
            INSERT INTO credit_transactions (user_id, amount, source, idempotency_key, reference_id)
            VALUES (%s, %s, 'admin_set', %s, %s)
            ON CONFLICT (user_id, idempotency_key) DO NOTHING
            RETURNING id
            """,
            (user_id, delta, key, reference_id),
        )
        inserted = cur.fetchone()
        if inserted is None:
            # Race: another transaction inserted this exact key between our
            # check above and this insert (both hold the SAME credits row
            # lock in sequence, so this is rare but not impossible under
            # concurrent identical retries) -- refuse, do not double-apply.
            logger.warning(
                f"[CreditLedger] set_balance key reuse race for user={user_id} key={key}"
            )
            return {"applied": False, "balance": old_balance, "delta": delta}

        cur.execute(
            "UPDATE credits SET balance = %s, updated_at = now() WHERE user_id = %s",
            (amount, user_id),
        )
    logger.info(
        f"[CreditLedger] set_balance user={user_id} amount={amount} "
        f"delta={delta} key={key}"
    )
    return {"applied": True, "balance": amount, "delta": delta}


# ---------------------------------------------------------------------------
# Reads -- never gated
# ---------------------------------------------------------------------------

def get_balance(user_id: str) -> int:
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance FROM credits WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        return row["balance"] if row else 0


def has_key(user_id: str, key: str) -> bool:
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM credit_transactions WHERE user_id = %s AND idempotency_key = %s",
            (user_id, key),
        )
        return cur.fetchone() is not None


def list_transactions(user_id: str, limit: int = 50) -> list[dict]:
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, amount, source, reference_id, video_seconds, created_at
            FROM credit_transactions
            WHERE user_id = %s
            ORDER BY created_at DESC, id DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def stats_for_admin(user_ids: list[str] | None = None) -> dict:
    """One grouped Postgres query for the admin panel (replaces per-file R2/local
    reads across up to `page_size` other users' SQLite files, T4870 -> gone).

    Returns dict keyed by user_id: credits_spent, credits_purchased,
    credits_balance (a real int -- absent row = 0, never null/unavailable),
    purchase_credit_amounts.
    """
    if user_ids is not None and not user_ids:
        return {}

    with get_pg() as conn:
        cur = conn.cursor()
        if user_ids is not None:
            cur.execute(
                """
                SELECT
                    user_id,
                    COALESCE(SUM(CASE WHEN amount < 0 AND source != 'admin_set' THEN -amount ELSE 0 END), 0) AS credits_spent,
                    COALESCE(SUM(CASE WHEN source = 'stripe_purchase' AND amount > 0 THEN amount ELSE 0 END), 0) AS credits_purchased,
                    ARRAY_AGG(amount ORDER BY created_at, id) FILTER (WHERE source = 'stripe_purchase' AND amount > 0) AS purchase_credit_amounts
                FROM credit_transactions
                WHERE user_id = ANY(%s)
                GROUP BY user_id
                """,
                (user_ids,),
            )
        else:
            cur.execute(
                """
                SELECT
                    user_id,
                    COALESCE(SUM(CASE WHEN amount < 0 AND source != 'admin_set' THEN -amount ELSE 0 END), 0) AS credits_spent,
                    COALESCE(SUM(CASE WHEN source = 'stripe_purchase' AND amount > 0 THEN amount ELSE 0 END), 0) AS credits_purchased,
                    ARRAY_AGG(amount ORDER BY created_at, id) FILTER (WHERE source = 'stripe_purchase' AND amount > 0) AS purchase_credit_amounts
                FROM credit_transactions
                GROUP BY user_id
                """
            )
        agg_rows = cur.fetchall()

        if user_ids is not None:
            cur.execute("SELECT user_id, balance FROM credits WHERE user_id = ANY(%s)", (user_ids,))
        else:
            cur.execute("SELECT user_id, balance FROM credits")
        balance_rows = cur.fetchall()

    agg_by_user = {r["user_id"]: r for r in agg_rows}
    balance_by_user = {r["user_id"]: r["balance"] for r in balance_rows}

    ids = user_ids if user_ids is not None else sorted(set(agg_by_user) | set(balance_by_user))
    stats = {}
    for uid in ids:
        a = agg_by_user.get(uid)
        stats[uid] = {
            "credits_spent": int(a["credits_spent"]) if a else 0,
            "credits_purchased": int(a["credits_purchased"]) if a else 0,
            "credits_balance": balance_by_user.get(uid, 0),
            "purchase_credit_amounts": list(a["purchase_credit_amounts"]) if a and a["purchase_credit_amounts"] else [],
        }
    return stats


# ---------------------------------------------------------------------------
# Reservations (T890) -- Phase 1 moves them verbatim, see design 2d/RESOLVED-1.
# The atomic-debit+refund simplification is an explicit later phase, NOT this task.
# ---------------------------------------------------------------------------

def reserve_credits(
    user_id: str,
    amount: int,
    job_id: str,
    video_seconds: float | None = None,
    profile_id: str | None = None,
) -> dict:
    """Atomic: UPDATE credits -= amount + INSERT credit_reservations.

    profile_id (M6) is recorded so recover_orphaned_reservations can check
    THAT profile's export_jobs before releasing -- without it, recovery has
    no way to tell an active in-flight reservation from an abandoned one.
    """
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO credits (user_id, balance) VALUES (%s, 0) ON CONFLICT DO NOTHING",
            (user_id,),
        )
        cur.execute(
            """
            UPDATE credits SET balance = balance - %s, updated_at = now()
            WHERE user_id = %s AND balance >= %s
            RETURNING balance
            """,
            (amount, user_id, amount),
        )
        updated = cur.fetchone()
        if updated is None:
            conn.rollback()
            cur.execute("SELECT balance FROM credits WHERE user_id = %s", (user_id,))
            b = cur.fetchone()
            balance = b["balance"] if b else 0
            return {"success": False, "balance": balance, "required": amount}
        cur.execute(
            "INSERT INTO credit_reservations (job_id, user_id, profile_id, amount, video_seconds) VALUES (%s, %s, %s, %s, %s)",
            (job_id, user_id, profile_id, amount, video_seconds),
        )
        balance = updated["balance"]
    return {"success": True, "balance": balance, "required": amount}


def confirm_reservation(user_id: str, job_id: str) -> bool:
    """Atomic: DELETE reservation + INSERT credit_transaction (the debit becomes real)."""
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT amount, video_seconds FROM credit_reservations WHERE job_id = %s AND user_id = %s",
            (job_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            return False
        cur.execute("DELETE FROM credit_reservations WHERE job_id = %s AND user_id = %s", (job_id, user_id))
        cur.execute(
            """
            INSERT INTO credit_transactions (user_id, amount, source, idempotency_key, reference_id, video_seconds)
            VALUES (%s, %s, 'framing_usage', %s, %s, %s)
            ON CONFLICT (user_id, idempotency_key) DO NOTHING
            """,
            (user_id, -row["amount"], credit_key("framing_usage", job_id), job_id, row["video_seconds"]),
        )
    from app.analytics import record_milestone
    record_milestone(user_id, "credits_consumed", {"job_id": job_id})
    return True


def release_reservation(user_id: str, job_id: str) -> bool:
    """Atomic: DELETE reservation + UPDATE credits += amount (no ledger row, matches SQLite behavior)."""
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT amount FROM credit_reservations WHERE job_id = %s AND user_id = %s",
            (job_id, user_id),
        )
        row = cur.fetchone()
        if not row:
            return False
        cur.execute("DELETE FROM credit_reservations WHERE job_id = %s AND user_id = %s", (job_id, user_id))
        cur.execute(
            "UPDATE credits SET balance = balance + %s, updated_at = now() WHERE user_id = %s",
            (row["amount"], user_id),
        )
    return True


def _has_live_export_job(user_id: str, profile_id: str | None, job_id: str) -> bool:
    """True if `job_id` has a live/queued export_jobs row in that PROFILE's
    LOCAL SQLite (M6). Only checks the local cache -- never downloads from R2
    (recovery runs at session-init time; if this machine doesn't have the
    profile cached, we cannot confirm liveness).

    Conservative on ambiguity: `profile_id` missing (legacy reservation from
    before this column existed) or the profile DB not locally present both
    return True (treated as "possibly still live, do not release") -- the
    failure mode we're avoiding is releasing an ACTIVE reservation (a free
    export), not leaving a truly-orphaned one stuck a little longer.

    Assumption this relies on: a job absent from a locally-cached
    profile.sqlite is treated as not-live (row is None -> False). A
    stale-but-PRESENT local copy (this machine hasn't synced the latest
    export_jobs write) is indistinguishable here from a genuinely absent job
    -- both read as "no matching row". We accept that gap because recovery
    only runs at session-init time against THIS machine's own cache.
    """
    if not profile_id:
        return True
    from ..migrations import MigrationBlocked
    from .materialization import _open_profile_db

    try:
        conn = _open_profile_db(user_id, profile_id)
    except MigrationBlocked as e:
        # T5085: conservative on ambiguity (the documented contract above) --
        # a profile we cannot bring to head cannot be asked whether the job
        # is live, so treat the reservation as possibly-live and do NOT
        # release it. This is the money-path direction: the failure mode
        # we're avoiding is releasing an ACTIVE reservation, not leaving a
        # truly-orphaned one stuck a little longer.
        logger.warning(
            "[Credits] cannot confirm export-job liveness for %s/%s — profile "
            "blocked at migration seam (%s); treating reservation as live",
            user_id, profile_id, e.reason,
        )
        return True
    if conn is None:
        return True
    try:
        row = conn.execute(
            "SELECT 1 FROM export_jobs WHERE id = ? AND status IN ('pending', 'processing')",
            (job_id,),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def recover_orphaned_reservations(user_id: str) -> int:
    """Startup: this user's reservations older than 60s with NO matching live
    export_job -> release.

    M6 fix: the SQLite-era version of this table was per-machine (the file
    itself was the scope), so "recover on cold init" only ever touched
    reservations THIS machine could plausibly own. Postgres shares the table
    across every machine -- without the export_jobs liveness check that was
    always documented but never implemented, ANY machine's cold session init
    releases EVERY user's reservations older than 60s, including another
    machine's active in-flight export (confirm_reservation then finds nothing
    to confirm against -> the export completes for free, a silent revenue
    leak). See `_has_live_export_job` for the conservative-on-ambiguity rule.
    """
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT job_id, profile_id, amount FROM credit_reservations
            WHERE user_id = %s AND created_at < now() - INTERVAL '60 seconds'
            """,
            (user_id,),
        )
        candidates = cur.fetchall()
        released = []
        for row in candidates:
            if _has_live_export_job(user_id, row["profile_id"], row["job_id"]):
                continue
            cur.execute(
                "DELETE FROM credit_reservations WHERE job_id = %s AND user_id = %s",
                (row["job_id"], user_id),
            )
            cur.execute(
                "UPDATE credits SET balance = balance + %s, updated_at = now() WHERE user_id = %s",
                (row["amount"], user_id),
            )
            released.append(row["job_id"])
    count = len(released)
    if count > 0:
        logger.info(f"[CreditLedger] Recovered {count} orphaned reservations for {user_id}")
    return count


# ---------------------------------------------------------------------------
# Backward-compatible shims -- preserve the OLD user_db.py call signatures/
# return shapes so most of the 16 call sites are a mechanical import swap
# (design 2a). Call sites that need a richer idempotency key (admin grant/bulk/
# set) call grant()/debit()/set_balance() directly instead of these.
# ---------------------------------------------------------------------------

def grant_credits(user_id: str, amount: int, source: str, reference_id: str | None = None) -> int:
    """Old contract: returns the new balance (int)."""
    key = credit_key(source, reference_id if reference_id is not None else user_id)
    result = grant(user_id, amount, source, key, reference_id=reference_id)
    return result["balance"]


def deduct_credits(
    user_id: str,
    amount: int,
    source: str,
    reference_id: str | None = None,
    video_seconds: float | None = None,
) -> dict:
    """Old contract: returns {success, balance, required}."""
    key = credit_key(source, reference_id)
    # M5 fix: reference_id was being dropped on the floor here -- game_upload
    # and storage_extension debit rows landed with NULL reference_id,
    # regressing GDPR export / credit history / admin forensics, and making
    # this path inconsistent with reserve_credits (which DOES preserve it).
    result = debit(user_id, amount, source, key, video_seconds=video_seconds, reference_id=reference_id)
    return {"success": result["ok"], "balance": result["balance"], "required": result["required"]}


def refund_credits(
    user_id: str,
    amount: int,
    reference_id: str,
    video_seconds: float | None = None,
    source: str = "framing_refund",
) -> int:
    """Old contract: returns the new balance (int)."""
    key = credit_key(source, reference_id)
    result = grant(user_id, amount, source, key, reference_id=reference_id, video_seconds=video_seconds)
    return result["balance"]


def get_credit_balance(user_id: str) -> dict:
    """Old contract: returns {"balance": int}."""
    return {"balance": get_balance(user_id)}


def get_credit_transactions(user_id: str, limit: int = 50) -> list:
    return list_transactions(user_id, limit)


def has_processed_payment(user_id: str, reference_id: str) -> bool:
    return has_key(user_id, credit_key("stripe_purchase", reference_id))


def get_credit_stats_for_admin(user_ids: list[str] | None = None) -> dict:
    return stats_for_admin(user_ids)


# ---------------------------------------------------------------------------
# T8120: upfront quest-chain credit grant. Retires the per-quest drip — the
# whole chain total is granted at signup (new users) or as the ungranted
# remainder on next login (existing mid-quest users), through this ONE write
# site. Idempotent two ways: a fixed per-user idempotency key
# (questbank:{user_id}) makes grant() itself refuse a second application, AND
# the remainder is computed from what the user has already been granted toward
# the chain (prior quest_reward claims + a prior upfront grant), so a repeat
# call computes 0 and does nothing. Never double-grants, even under a race:
# concurrent calls both compute the same remainder but only ONE grant() applies
# (UNIQUE(user_id, idempotency_key)); the loser reports applied=False.
# Deliberately a separate section at the file's end (not folded into the reads
# block) to minimize merge friction with the sibling T8110 stats_for_admin work.
# ---------------------------------------------------------------------------

def _granted_quest_chain_credits(cur, user_id: str) -> int:
    """Sum of positive credits already granted toward the quest chain for this
    user: legacy per-quest claims (source='quest_reward') plus any prior upfront
    grant (source='quest_upfront'). Drives the ungranted-remainder computation."""
    cur.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS granted
        FROM credit_transactions
        WHERE user_id = %s AND amount > 0
          AND source IN ('quest_reward', 'quest_upfront')
        """,
        (user_id,),
    )
    row = cur.fetchone()
    return int(row["granted"]) if row else 0


def grant_quest_chain_credits(user_id: str) -> dict:
    """Grant the ungranted remainder of the quest-chain credit total upfront.

    Returns {applied, granted, balance}. applied=False (granted=0) when the user
    has already received the full chain total: a brand-new signup gets the whole
    QUEST_CHAIN_CREDIT_TOTAL; a mid-quest user who already claimed some quests
    (legacy quest_reward rows) gets only what's left; a fully-granted user gets
    nothing. Safe to call on every login — steady state is one indexed SELECT.
    """
    from ..quest_config import QUEST_CHAIN_CREDIT_TOTAL
    _require_ready()
    with get_pg() as conn:
        cur = conn.cursor()
        already = _granted_quest_chain_credits(cur, user_id)
    remainder = QUEST_CHAIN_CREDIT_TOTAL - already
    if remainder <= 0:
        logger.info(
            f"[CreditLedger] quest-chain upfront no-op user={user_id} "
            f"(already granted {already}/{QUEST_CHAIN_CREDIT_TOTAL})"
        )
        return {"applied": False, "granted": 0, "balance": get_balance(user_id)}
    result = grant(
        user_id, remainder, "quest_upfront",
        credit_key("quest_upfront", user_id),
        reference_id=user_id,
    )
    granted = remainder if result["applied"] else 0
    logger.info(
        f"[CreditLedger] quest-chain upfront user={user_id} remainder={remainder} "
        f"applied={result['applied']} balance={result['balance']}"
    )
    return {"applied": result["applied"], "granted": granted, "balance": result["balance"]}
