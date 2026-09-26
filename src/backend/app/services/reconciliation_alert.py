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

At-most-once-per-interval across a multi-machine Fly deploy is enforced by TWO
distinct Postgres mechanisms, because either one alone is insufficient:

1. A SESSION-level advisory lock (``pg_try_advisory_lock``) gives MUTUAL EXCLUSION
   between passes that overlap IN TIME. It is taken on one connection held for the
   whole pass and released EXPLICITLY with ``pg_advisory_unlock``. We do NOT rely
   on "the connection closes" auto-release, because the connection comes from a
   pool and is returned to it alive, never disconnected. If the lock is already
   held, another machine is running RIGHT NOW -> log at INFO and skip.

2. A PERSISTED last-run marker (``reconciliation_alert_runs``, one row) gives
   DE-DUPLICATION across passes that do NOT overlap in time. Each Fly machine (and
   each restart) starts its own startup-delay-then-weekly timer, so two passes can
   run seconds or hours apart, never contending for the lock, and each would
   otherwise see the same drift and alert. Inside the SAME lock-held section the
   pass reads ``last_run_at``; if it is younger than one interval it skips
   (``skipped_recent``) without computing or alerting; otherwise it runs and, once
   the outcome is fixed, upserts ``last_run_at = now()`` on a FRESH, SEPARATE
   pooled connection -- NOT the lock-holding connection -- and only THEN releases
   the lock. Writing the marker off the lock connection is deliberate (round 3): a
   death of the lock connection at ANY point during the pass (mid-compute,
   mid-send, or on the unlock itself) can no longer prevent the marker from being
   recorded, so a mid-pass connection death after an alert has gone out cannot
   re-alert on the next pass. A persisted marker is used rather than holding a lock
   connection open for the process lifetime -- that would permanently consume one
   of only 10 pool connections for a weekly job.

Together the lock (concurrent passes) and the marker (non-overlapping passes) make
"at most once per interval, once per deploy not once per machine" hold regardless
of machine topology, without adding leader-election infrastructure.

The pass also runs ~60s after every boot/deploy (STARTUP_DELAY_SECONDS), not on a
fixed wall-clock weekly schedule; the marker is what stops those extra boot-time
passes from re-alerting within the same interval.

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

# Floor on the loop's re-sleep after a skipped_recent pass, so that reading the
# marker's own "time until next due" can never collapse into a busy-loop when a
# pass is skipped a hair before it becomes due.
MIN_RESLEEP_SECONDS = 60


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
    """Weekly cadence: sleep, run one pass, sleep again.

    A boot-time pass that finds a recent marker returns ``skipped_recent`` with the
    time REMAINING until the run is actually due (``next_run_in_seconds``). We sleep
    only that remainder rather than a full ``WEEKLY_INTERVAL_SECONDS``, so a machine
    that boots just after another already ran does not stretch the effective spacing
    toward ~2x the nominal interval; it re-checks right when the run comes due.
    Every other outcome sleeps a full interval.
    """
    await asyncio.sleep(STARTUP_DELAY_SECONDS)

    while True:
        try:
            result = await run_reconciliation_alert_pass()
            sleep_for = result.get("next_run_in_seconds") or WEEKLY_INTERVAL_SECONDS
            await asyncio.sleep(sleep_for)
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
    - ``skipped_locked`` -- another machine holds the lock RIGHT NOW (concurrent
      pass); the advisory lock refused.
    - ``skipped_recent`` -- a pass already completed less than one interval ago
      (a non-overlapping earlier machine/boot); de-duplicated via the persisted
      ``last_run_at`` marker. No compute, no alert, no write.
    - ``silent`` -- every row explained, no pending dispute; no alert emitted.
    - ``alerted`` -- unexplained drift and/or a pending dispute; alert emitted.
    """
    import stripe

    if not stripe.api_key:
        logger.info("[ReconAlert] Stripe not configured -- skipping reconciliation pass")
        return {"status": "skipped_not_configured", "user_ids": []}

    import psycopg2

    from .pg import get_pg

    # The outcome is fixed the moment we decide skip/silent/alerted (and, for
    # alerted, once the email has been attempted). Once set, NOTHING in the cleanup
    # tail may turn into an exception that ESCAPES this function: a propagated error
    # makes the outer loop treat the whole pass as failed and retry in 1h, which
    # would RE-SEND an alert that already went out (round-2 fix #2).
    outcome: dict | None = None

    # Hold ONE connection for the entire pass so the session-level advisory lock
    # stays held across the compute and the email send, then release it
    # explicitly. The pass's own DB reads inside _compute_reconciliation use
    # SEPARATE pooled connections (different sessions), so they never collide
    # with this lock -- it exists purely to coordinate across machines/processes.
    try:
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
                # De-duplicate across NON-overlapping passes (see module docstring
                # mechanism 2): if a pass completed less than one interval ago,
                # skip WITHOUT computing or alerting, and write nothing beyond the
                # lock itself. The comparison is done in Postgres (now() vs the
                # stored TIMESTAMPTZ) to avoid any client-clock/timezone skew.
                cur.execute(
                    "SELECT last_run_at, "
                    "       (now() - last_run_at) < make_interval(secs => %s) AS recent, "
                    "       EXTRACT(EPOCH FROM "
                    "         (last_run_at + make_interval(secs => %s) - now())) AS remaining_secs "
                    "FROM reconciliation_alert_runs WHERE id = 1",
                    (WEEKLY_INTERVAL_SECONDS, WEEKLY_INTERVAL_SECONDS),
                )
                marker = cur.fetchone()
                if marker is not None and marker["recent"]:
                    # Tell the loop how long is actually LEFT until this run is due,
                    # floored so it never busy-loops, so it re-checks right on time
                    # instead of sleeping another full interval (the ~2x-spacing
                    # slop the round-3 verifier flagged).
                    remaining = max(
                        MIN_RESLEEP_SECONDS, int(marker["remaining_secs"] or 0)
                    )
                    logger.info(
                        "[ReconAlert] a pass already ran within the last interval "
                        "(last_run_at=%s) -- skipping (skipped_recent), next due in %ss",
                        marker["last_run_at"],
                        remaining,
                    )
                    outcome = {
                        "status": "skipped_recent",
                        "user_ids": [],
                        "next_run_in_seconds": remaining,
                    }
                    return outcome

                # Reuse the panel's exact computation (no second query, no second
                # classifier). Run it off the event loop -- it does synchronous
                # Stripe pagination + Postgres reads. Default filter: test accounts
                # excluded, matching the panel's default.
                rows = await asyncio.to_thread(_compute_rows)
                alert = _build_alert(rows)
                if alert is None:
                    logger.info("[ReconAlert] reconciliation clean -- no unexplained drift, no pending dispute")
                    outcome = {"status": "silent", "user_ids": []}
                else:
                    # Zero-dependency floor: a CRITICAL log line always, before the email.
                    logger.critical(alert["log_line"])
                    await _send_admin_alert(alert)
                    outcome = {"status": "alerted", "user_ids": alert["user_ids"]}
                return outcome
            finally:
                # The pass RAN (not skipped_recent) iff we produced a silent/alerted
                # outcome -- only then do we stamp the marker.
                ran = outcome is not None and outcome["status"] in ("silent", "alerted")
                _finish_pass(conn, cur, ran)
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        # get_pg RE-RAISES a connection error from its exit-time commit (it does
        # NOT swallow it). If we already produced an outcome -- including a
        # delivered alert -- the pass SUCCEEDED and only the cleanup connection
        # died; swallow so the outer loop does not retry-and-duplicate. With no
        # outcome yet the failure is real (we never got as far as computing), so
        # let it propagate to the loop's normal 1h back-off.
        if outcome is not None:
            logger.critical(
                "[ReconAlert] connection error after the pass completed (outcome=%s) -- "
                "swallowed so the alert is not re-sent on retry",
                outcome["status"],
            )
            return outcome
        raise


def _finish_pass(conn, cur, ran: bool) -> None:
    """Best-effort cleanup tail: stamp the last-run marker, then release the lock.

    Runs in the pass's ``finally``, so it fires whether the pass alerted, was
    silent, or was skipped_recent. NEITHER step may propagate an exception: the
    alert (if any) has already gone out, and an escaped cleanup error would make
    the outer loop retry the whole pass and re-send it.

    The marker is stamped on a FRESH, SEPARATE pooled connection -- NOT ``conn``,
    the lock-holding connection (round-3 fix). The earlier version wrote it through
    the lock connection's own cursor, so ANY death of that connection during the
    pass (not just a death on the unlock statement) skipped the marker entirely:
    the alert had already gone out, but the next pass, seeing no recent marker,
    re-sent it. Writing on an independent connection means a lock-connection death
    at any point up to and including the unlock still leaves the marker persisted,
    so the next pass sees a recent run and does NOT re-alert. The marker write is
    done BEFORE the unlock so the lock is released only after the marker is durable.
    """
    # 1) Stamp the marker -- ONLY when the pass actually ran. A skipped_recent
    #    pass writes nothing beyond the lock (round-2 fix #1). Use a fresh get_pg()
    #    connection so this write does not depend on the lock connection surviving.
    if ran:
        try:
            from .pg import get_pg
            with get_pg() as marker_conn:
                marker_conn.cursor().execute(
                    "INSERT INTO reconciliation_alert_runs (id, last_run_at) VALUES (1, now()) "
                    "ON CONFLICT (id) DO UPDATE SET last_run_at = now()"
                )
        except Exception:
            # If the marker write itself fails -- on its OWN fresh connection, so
            # this is a genuine Postgres/pool failure, not a side effect of the lock
            # connection dying -- last_run_at stays stale and the NEXT pass may
            # re-alert for the same drift. That trade is DELIBERATE: a rare, LOUD
            # (CRITICAL below) duplicate alert is strictly better than the
            # alternative -- swallowing the failure in a way that could wedge the
            # marker and leave the alarm permanently silent. We optimize for never
            # going silent; a double alarm is merely noise. (This is now the ONLY
            # residual double-alert path; the mid-pass lock-connection death that
            # round-2's fix left open is closed by writing on this fresh connection.)
            logger.critical(
                "[ReconAlert] failed to persist last_run_at marker on a fresh "
                "connection -- the next pass may re-alert for the same drift "
                "(accepted: a rare loud duplicate beats a silent stall)"
            )

    # 2) Release the advisory lock on the ORIGINAL lock connection.
    try:
        cur.execute(
            "SELECT pg_advisory_unlock(%s) AS released", (RECONCILIATION_ALERT_LOCK_ID,)
        )
    except Exception:
        # The unlock statement itself failed -- almost always because the
        # connection died during the (potentially long) pass (Stripe pagination +
        # N admin emails; Fly closes idle client sockets, which is why get_pg
        # pre-pings). A SESSION-level advisory lock would otherwise ride this
        # connection back into the pool ALIVE and make every future weekly pass
        # return skipped_locked forever -- and skipped_locked emits no CRITICAL and
        # no email, so the alerting system would fail SILENTLY. Force the connection
        # closed so its server session ends and Postgres releases the lock
        # unconditionally, and log loudly. The subsequent get_pg exit-commit on the
        # now-closed conn raises, which get_pg re-raises; the caller catches it
        # above (outcome already set) and returns without re-alerting.
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
