"""T8670: scheduled reconciliation drift alert (Revenue Record Integrity epic 6/6).

Reconciliation used to be on-demand only: the 2026-08-24 orphan-payment drift sat
unnoticed until a human happened to open the admin panel on 2026-09-03. Standard
practice is the opposite -- Stripe is the source of truth, the local ledger is
reconciled against it on a schedule, and drift it CANNOT explain raises an alert
rather than waiting to be noticed (EPIC.md research).

This is a thin background caller around the SAME computation the admin panel uses.
It does not reimplement the query or the classifier:

- it runs ``_compute_reconciliation`` (routers/admin.py) with the panel's default
  filter (test accounts excluded), and
- alerts ONLY on drift that is genuinely unexplained: any row classified
  ``unknown`` (after T8640, ``aligned``/``test_mode_era``/``account_deleted``/
  ``dispute``/``refund`` are all explained states), plus any row carrying a
  pending dispute (a deadline worth surfacing even when nothing drifts).

READ-ONLY: this pass never heals, never calls ``set_total_spent``, never writes.
Healing stays an explicit admin gesture.

Single-machine coordination on a multi-machine Fly deploy: a Postgres SESSION-level
advisory lock (``pg_try_advisory_lock``) taken on one connection that is HELD for
the whole pass and released EXPLICITLY with ``pg_advisory_unlock`` in a ``finally``.
We do NOT rely on "the connection closes" auto-release, because the connection
comes from a pool and is returned to it alive, never disconnected. If the lock is
already held, another machine is running (or just ran) this cycle -> log at INFO
and skip; do not busy-retry. Postgres is the one resource every machine shares, so
this makes "once per deploy" true without adding leader-election infrastructure.

Scheduling reuses the existing background-loop pattern (see ``sweep_scheduler`` /
``cleanup``): start on app startup, stop on shutdown. Weekly is enough at current
volume; the interval is a named constant, not a magic number.

Alert channel:
- always a CRITICAL log line naming the drifted user_ids, causes and amounts
  (greppable, zero-dependency floor), and
- additionally an email to each admin address (``get_admin_emails``) via the
  existing ``send_admin_update_email``. Never a "nothing to report" email. A failed
  email send is logged and swallowed -- it must never crash or kill the loop.
"""

import asyncio
import logging

from .auth_db import get_admin_emails
from .email import body_text_to_html, send_admin_update_email
from .revenue_reconciliation import DriftCause

logger = logging.getLogger(__name__)

_alert_task: asyncio.Task | None = None

# Fixed, greppable advisory-lock key. Nonzero bigint, chosen as the task id so it
# is self-documenting and collision-free (grep confirmed no other advisory-lock
# use in this codebase). Every machine that runs this pass contends on THIS key.
RECONCILIATION_ALERT_LOCK_ID = 8670

# Weekly cadence -- the task explicitly says weekly is enough at current volume.
WEEKLY_INTERVAL_SECONDS = 7 * 24 * 60 * 60

# Let the app stabilize before the first pass (mirrors sweep_scheduler).
STARTUP_DELAY_SECONDS = 60

# Back-off after an unexpected error so a transient failure doesn't hot-loop.
ERROR_RETRY_SECONDS = 3600


async def start_reconciliation_alert_loop():
    """Start the reconciliation-alert loop as a background task. Called at startup."""
    global _alert_task
    _alert_task = asyncio.create_task(_run_reconciliation_alert_loop())
    logger.info("[ReconAlert] Background reconciliation alert loop started")


async def stop_reconciliation_alert_loop():
    """Cancel the reconciliation-alert loop. Called at shutdown."""
    global _alert_task
    if _alert_task:
        _alert_task.cancel()
        try:
            await _alert_task
        except asyncio.CancelledError:
            pass
        _alert_task = None
        logger.info("[ReconAlert] Background reconciliation alert loop stopped")


async def _run_reconciliation_alert_loop():
    """Fixed weekly cadence: sleep, run one pass, sleep again."""
    await asyncio.sleep(STARTUP_DELAY_SECONDS)

    while True:
        try:
            await run_reconciliation_alert_pass()
            await asyncio.sleep(WEEKLY_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("[ReconAlert] Shutdown")
            break
        except Exception:
            logger.exception("[ReconAlert] Error, retrying in 1h")
            await asyncio.sleep(ERROR_RETRY_SECONDS)


async def run_reconciliation_alert_pass() -> dict:
    """Run one reconciliation pass under the advisory lock. Returns a status dict.

    ``status`` is one of:
    - ``skipped_not_configured`` -- Stripe key absent (local dev); nothing to do.
    - ``skipped_locked`` -- another machine holds the lock this cycle.
    - ``silent`` -- every row explained, no pending dispute; no alert emitted.
    - ``alerted`` -- unexplained drift and/or a pending dispute; alert emitted.
    """
    import stripe

    if not stripe.api_key:
        logger.info("[ReconAlert] Stripe not configured -- skipping reconciliation pass")
        return {"status": "skipped_not_configured", "user_ids": []}

    from .pg import get_pg

    # Hold ONE connection for the entire pass so the session-level advisory lock
    # stays held across the compute and the email send, then release it
    # explicitly. The pass's own DB reads inside _compute_reconciliation use
    # SEPARATE pooled connections (different sessions), so they never collide
    # with this lock -- it exists purely to coordinate across machines/processes.
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT pg_try_advisory_lock(%s) AS acquired", (RECONCILIATION_ALERT_LOCK_ID,)
        )
        if not cur.fetchone()["acquired"]:
            logger.info(
                "[ReconAlert] advisory lock %s held by another machine -- skipping this cycle",
                RECONCILIATION_ALERT_LOCK_ID,
            )
            return {"status": "skipped_locked", "user_ids": []}

        try:
            # Reuse the panel's exact computation (no second query, no second
            # classifier). Run it off the event loop -- it does synchronous
            # Stripe pagination + Postgres reads. Default filter: test accounts
            # excluded, matching the panel's default.
            rows = await asyncio.to_thread(_compute_rows)
            alert = _build_alert(rows)
            if alert is None:
                logger.info("[ReconAlert] reconciliation clean -- no unexplained drift, no pending dispute")
                return {"status": "silent", "user_ids": []}

            # Zero-dependency floor: a CRITICAL log line always, before the email.
            logger.critical(alert["log_line"])

            await _send_admin_alert(alert)
            return {"status": "alerted", "user_ids": alert["user_ids"]}
        finally:
            try:
                cur.execute(
                    "SELECT pg_advisory_unlock(%s) AS released", (RECONCILIATION_ALERT_LOCK_ID,)
                )
            except Exception:
                # The unlock statement itself failed -- almost always because the
                # connection died during the (potentially long) pass (Stripe
                # pagination + N admin emails; Fly closes idle client sockets,
                # which is why get_pg pre-pings). A SESSION-level advisory lock
                # would otherwise ride this connection back into the pool ALIVE
                # and make every future weekly pass return skipped_locked forever
                # -- and skipped_locked is the ONE status that emits no CRITICAL
                # and no email, so the alerting system would fail SILENTLY. Force
                # the connection closed so its server session ends and Postgres
                # releases the lock unconditionally, and log loudly. (The
                # subsequent get_pg commit on the now-closed conn raises an
                # InterfaceError that get_pg swallows into a pool discard, and the
                # loop logs + retries in an hour -- loud and self-correcting, never
                # silent.)
                logger.critical(
                    "[ReconAlert] pg_advisory_unlock(%s) FAILED -- forcing connection close "
                    "so the lock cannot leak onto a pooled connection and stall every future pass",
                    RECONCILIATION_ALERT_LOCK_ID,
                )
                try:
                    conn.close()
                except Exception:
                    pass


def _compute_rows() -> list:
    """Run the panel's reconciliation computation (rows only). Read-only.

    Imported lazily from the router: this background caller is an orchestrator, so
    reusing the router's already-tested computation avoids duplicating either the
    Postgres query or the classifier call site, and keeps ``revenue_reconciliation``
    a pure module. A lazy import (never at module load) avoids any import cycle.
    """
    from ..routers.admin import _compute_reconciliation
    rows, _ = _compute_reconciliation(exclude_test=True)
    return rows


def _fmt_dollars(cents: int) -> str:
    """Signed dollar string for a cents amount, e.g. -399 -> '-$3.99'."""
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) / 100:.2f}"


def _build_alert(rows: list) -> dict | None:
    """Build the alert payload from reconciliation rows, or None if nothing to alert.

    Alert conditions (pure over the rows the panel already produced):
    - any row classified ``unknown`` (money moved and we cannot say why), and/or
    - any row with a pending dispute (a deadline, surfaced even without drift).

    Every other cause -- aligned, test_mode_era, account_deleted, dispute (lost),
    refund -- is an explained state and never alerts.
    """
    alertable = []  # (row, [reasons]) preserving the panel's drift-first ordering
    for r in rows:
        reasons = []
        if r.get("cause") == DriftCause.UNKNOWN.value:
            reasons.append("unexplained drift")
        if r.get("has_pending_dispute"):
            reasons.append("pending dispute")
        if reasons:
            alertable.append((r, reasons))

    if not alertable:
        return None

    user_ids = [r["user_id"] for r, _ in alertable]

    lines = []
    for r, reasons in alertable:
        email = r.get("email") or "(no email)"
        lines.append(
            f"user={r['user_id']} email={email} cause={r.get('cause')} "
            f"reasons={'+'.join(reasons)} "
            f"local={_fmt_dollars(r.get('local_cents', 0))} "
            f"stripe_net={_fmt_dollars(r.get('stripe_net_cents', 0))} "
            f"delta={_fmt_dollars(r.get('delta_cents', 0))}"
        )

    count = len(alertable)
    noun = "user" if count == 1 else "users"
    log_line = (
        f"[ReconAlert] DRIFT DETECTED: {count} {noun} need attention -- "
        + " ; ".join(lines)
    )

    subject = f"ReelBallers revenue reconciliation: {count} {noun} need attention"
    body_text = (
        "The scheduled revenue reconciliation pass found drift it cannot explain "
        "on its own. Each line below is a user whose local total does not match "
        "Stripe (cause 'unknown'), and/or who has a pending dispute.\n\n"
        + "\n".join(lines)
        + "\n\nThis is a read-only alert. Healing stays an explicit action in the "
        "admin revenue reconciliation panel."
    )

    return {
        "user_ids": user_ids,
        "log_line": log_line,
        "subject": subject,
        "body_text": body_text,
    }


async def _send_admin_alert(alert: dict) -> None:
    """Email the alert to every admin address. Never raises: a failed send is
    logged and swallowed so it cannot crash or kill the background loop.

    The CRITICAL log line has already fired by the time this runs, so email is a
    best-effort upgrade on top of the zero-dependency floor, not the floor itself.
    """
    try:
        recipients = get_admin_emails()
    except Exception:
        logger.exception("[ReconAlert] could not resolve admin recipients -- email skipped (CRITICAL log already emitted)")
        return

    if not recipients:
        logger.warning("[ReconAlert] no admin recipients configured -- email skipped (CRITICAL log already emitted)")
        return

    body_html = body_text_to_html(alert["body_text"])
    for email in recipients:
        try:
            ok = await send_admin_update_email(email, alert["subject"], body_html)
            if not ok:
                logger.error("[ReconAlert] alert email to %s reported failure", email)
        except Exception:
            logger.exception("[ReconAlert] alert email to %s raised -- continuing", email)
