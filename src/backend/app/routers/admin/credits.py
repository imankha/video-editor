"""Admin credits endpoints: single and bulk grants (T4860), set-credits, and the T5840
credits -> Postgres backfill report / apply / open-gate.

Split out of routers/admin.py by T5940; every URL is unchanged."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...services import credit_ledger
from ...services.auth_db import get_user_by_id
from ...services.credit_ledger import CreditsUnavailable
from ...services.pg import get_pg
from ...user_context import get_current_user_id
from . import BULK_MAX_IDS, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# T4860: Bulk user actions (grant credits / send update email)
#
# These MUST be registered before /users/{user_id}/grant-credits below: FastAPI
# matches routes in definition order, and /users/bulk/grant-credits would
# otherwise be captured by the {user_id} route with user_id="bulk". A max of
# 100 ids per request keeps the sequential loops bounded. Partial failure is a
# first-class outcome (per-user result), never an all-or-nothing error.
# ---------------------------------------------------------------------------

class BulkGrantCreditsRequest(BaseModel):
    user_ids: list[str]
    amount: int
    batch_id: str  # minted client-side (UUID) once per bulk click; a retry of the
    # SAME click reuses it (idempotent no-op on double-grant), a new click mints a new one


@router.post("/users/bulk/grant-credits")
async def admin_bulk_grant_credits(request: BulkGrantCreditsRequest):
    """Grant credits to many users at once. Admin only.

    Loops sequentially and grants via credit_ledger.grant() with a per-user key
    derived from (admin, batch_id, target_user_id) -- a retry of the whole batch
    (same batch_id) cannot double-grant any user in it. Unknown ids are skipped
    and recorded, not fatal. Credits now live in Postgres, so there is no
    per-user R2 sync step and no `synced` field to report anymore.
    """

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if not request.user_ids:
        raise HTTPException(status_code=400, detail="user_ids must not be empty")
    if len(request.user_ids) > BULK_MAX_IDS:
        raise HTTPException(status_code=400, detail=f"Too many users (max {BULK_MAX_IDS})")

    admin_id = get_current_user_id()
    results: list[dict] = []
    granted = 0
    failed = 0
    for uid in request.user_ids:
        user = get_user_by_id(uid)
        if not user:
            results.append({"user_id": uid, "ok": False, "error": "user not found"})
            failed += 1
            continue
        key = f"admin:{admin_id}:{request.batch_id}:{uid}"
        try:
            result = credit_ledger.grant(uid, request.amount, "admin_grant", key)
        except CreditsUnavailable:
            raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
        except Exception as exc:
            logger.exception(f"[Admin] bulk grant-credits failed for {uid}")
            results.append({"user_id": uid, "ok": False, "error": str(exc)})
            failed += 1
            continue
        # M3: `ok=True` means the request succeeded (no error); `applied`
        # separately says whether IT was the call that moved the balance --
        # a batch_id retry re-reports every user's CURRENT balance with
        # applied=False, never double-granting but never silently reading as
        # a fresh grant either.
        results.append({"user_id": uid, "ok": True, "balance": result["balance"], "applied": result["applied"]})
        granted += 1

    return {"results": results, "granted": granted, "failed": failed}


class GrantCreditsRequest(BaseModel):
    amount: int
    request_id: str  # minted client-side (UUID) per click; a retry of the SAME
    # click reuses it (idempotent no-op), a new click mints a new one


@router.post("/users/{user_id}/grant-credits")
async def admin_grant_credits(user_id: str, request: GrantCreditsRequest):
    """Grant credits to any user. Admin only.

    Idempotency key is (admin, request_id) -- a retried request_id changes
    nothing (structurally impossible to double-grant, T5840 AC), so unlike the
    old SQLite path this can safely 503 on a durability failure and be retried.
    """

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    admin_id = get_current_user_id()
    key = f"admin:{admin_id}:{request.request_id}"
    try:
        result = credit_ledger.grant(user_id, request.amount, "admin_grant", key)
    except CreditsUnavailable:
        raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
    # M3: surface `applied` -- False means this request_id already ran (a
    # retry), so the 200 must not read as "credits granted just now". Without
    # this a stale-key retry (e.g. a UI bug reusing an old id) shows a green
    # "Credits granted!" while the balance silently did not move.
    return {"balance": result["balance"], "applied": result["applied"]}


class SetCreditsRequest(BaseModel):
    amount: int
    request_id: str


@router.post("/users/{user_id}/set-credits")
async def admin_set_credits(user_id: str, request: SetCreditsRequest):
    """Set a user's credit balance to an exact value. Admin only."""

    if request.amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    admin_id = get_current_user_id()
    key = f"adminset:{admin_id}:{request.request_id}"
    try:
        result = credit_ledger.set_balance(user_id, request.amount, key)
    except CreditsUnavailable:
        raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
    # M3: applied is False both for a same-key retry (delta==0 short circuit
    # OR a reused key with a different target amount, refused) -- either way
    # the caller must be told nothing changed just now.
    return {"balance": result["balance"], "applied": result["applied"]}


# ---------------------------------------------------------------------------
# T5840: Credits -> Postgres backfill + cutover gate.
#
# Dry-run report (no writes) vs apply, per design 3b -- this is a tool, not a
# versioned migration file: money needs a human-reviewed dry run, and a
# migration's up(conn) has no user context to force-download R2 with.
# Both idempotent/re-runnable: a second run only inserts ledger rows Postgres
# is still missing and recomputes balance = SUM(pg ledger).
# ---------------------------------------------------------------------------

class BackfillRequest(BaseModel):
    user_ids: list[str] | None = None
    limit: int | None = None
    offset: int = 0


@router.get("/credits/backfill-report")
async def credits_backfill_report(
    user_ids: str | None = Query(None),
    limit: int | None = Query(None, description="Chunk the full enumeration (M7) -- omit for all users"),
    offset: int = Query(0),
):
    """Dry run -- no writes. `user_ids` is an optional comma-separated list for a
    targeted preview; omitted means every user (optionally chunked via
    limit/offset -- each user costs an R2 download + several PG round trips,
    so an unbounded scan can run minutes past a proxy timeout once the user
    base is nontrivial). A COMPLETE unchunked run is saved as the stored
    report POST /credits/open-gate consumes."""
    from ...services.credit_backfill import reconcile_against_stripe, run_backfill

    ids = [u.strip() for u in user_ids.split(",") if u.strip()] if user_ids else None
    report = run_backfill(user_ids=ids, apply=False, limit=limit, offset=offset)
    # Stripe reconciliation is itself a full-population pass (PaymentIntent.list) --
    # skip it for a chunked page, it isn't scoped to `limit`/`offset` and would be
    # misleadingly repeated (and costly) on every page.
    if limit is None:
        report["stripe_reconciliation"] = reconcile_against_stripe()
    return report


@router.post("/credits/backfill")
async def credits_backfill_apply(request: BackfillRequest):
    """Apply -- inserts missing ledger rows and re-derives balances. Safe to
    re-run (idempotent); `user_ids` targets a re-run for specific accounts;
    `limit`/`offset` chunk a full-population apply run (M7)."""
    from ...services.credit_backfill import run_backfill

    return run_backfill(user_ids=request.user_ids, apply=True, limit=request.limit, offset=request.offset)


class OpenGateRequest(BaseModel):
    # Flag NAMES (e.g. "divergent", "ledger_mismatch", "negative_balance") the
    # admin has manually reviewed and accepts -- a row carrying ONLY
    # acknowledged flags (and zero delta) no longer blocks the gate.
    acknowledge_flags: list[str] = []
    # Raw override: opens the gate regardless of any remaining anomaly.
    # Logged loudly (WARNING) with the full anomalous user list for audit.
    force: bool = False


def _gate_blocking_rows(rows: list[dict], acknowledged: set[str]) -> list[dict]:
    """Rows that must block the gate. `no_user_db` is informational ONLY --
    it is the EXPECTED, permanent state for every purged/guest/never-synced
    account (BLOCKING-2: with unbounded real-world enumeration this flag is
    guaranteed on staging/prod, so treating it as blocking means the gate can
    never open). Any OTHER flag blocks unless explicitly acknowledged; a
    nonzero delta always blocks (it means backfill has real unapplied work --
    the fix is POST /credits/backfill, not an acknowledgement)."""
    blocking = []
    for r in rows:
        if r["status"] == "no_user_db":
            continue
        if (set(r["flags"]) - acknowledged) or r["delta"] != 0:
            blocking.append(r)
    return blocking


# M7: open-gate consumes the STORED report from the most recent COMPLETE
# GET backfill-report call instead of recomputing (a second full unbounded
# scan -- R2 downloads + Stripe list -- synchronously inside this request).
# A report older than this is refused (not silently reused) unless force=true.
GATE_REPORT_MAX_AGE_SECONDS = 1800  # 30 minutes


@router.post("/credits/open-gate")
async def credits_open_gate(request: OpenGateRequest = OpenGateRequest()):
    """Open the credits_ready cutover gate (design 4a/4b) -- mutations 503 until
    this runs. Refuses unless the STORED backfill report (from the most recent
    GET /credits/backfill-report) shows zero drift and no unacknowledged
    anomalies, so the gate can only open on a verified-clean (or explicitly
    human-reviewed) state. `no_user_db` never blocks -- it is the expected
    state for purged/guest accounts, not drift."""
    from datetime import UTC, datetime

    from ...services.credit_backfill import load_last_report
    from ...services.credit_ledger import reset_ready_cache_for_tests

    stored = load_last_report()
    if stored is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "no_report",
                "message": "No backfill report on file -- run GET /credits/backfill-report (full, unchunked) first.",
            },
        )

    age_seconds = (datetime.now(UTC) - stored["generated_at"]).total_seconds()
    if age_seconds > GATE_REPORT_MAX_AGE_SECONDS and not request.force:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "stale_report",
                "message": (
                    f"Stored report is {int(age_seconds)}s old (max {GATE_REPORT_MAX_AGE_SECONDS}s) -- "
                    "re-run GET /credits/backfill-report, or pass force=true to use it anyway."
                ),
                "report_generated_at": stored["generated_at"].isoformat(),
            },
        )

    report = stored["report"]
    acknowledged = set(request.acknowledge_flags)
    anomalous = _gate_blocking_rows(report["rows"], acknowledged)

    if anomalous and not request.force:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "drift_present",
                "message": (
                    "The stored backfill report shows drift or unacknowledged flags -- "
                    "run POST /credits/backfill, then GET /credits/backfill-report again "
                    "to refresh the stored report, or pass acknowledge_flags (after manual "
                    "review) / force=true to open anyway."
                ),
                "anomalous_count": len(anomalous),
                "anomalous_user_ids": [r["user_id"] for r in anomalous][:50],
                "report_generated_at": stored["generated_at"].isoformat(),
            },
        )

    if anomalous and request.force:
        logger.warning(
            f"[Admin] credits_ready gate FORCE-opened by {get_current_user_id()} with "
            f"{len(anomalous)} unresolved anomalous users: "
            f"{[r['user_id'] for r in anomalous]}"
        )

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO credit_migration_state (id, ready_at, backfilled_users)
               VALUES (1, now(), %s)
               ON CONFLICT (id) DO UPDATE SET ready_at = now(), backfilled_users = %s""",
            (report["summary"]["total_users"], report["summary"]["total_users"]),
        )
    reset_ready_cache_for_tests()
    logger.info(f"[Admin] credits_ready gate OPENED by {get_current_user_id()}")
    return {"opened": True, "backfilled_users": report["summary"]["total_users"]}
