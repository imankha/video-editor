"""T13932: alert when an R2 source or the billing cycle crosses its Class A threshold.

The T13920 sweep hot loop ran for 12 days before a Cloudflare billing email surfaced it.
This hourly pass turns T13930's per-source attribution into a same-day signal.

Runs only in production, but evaluates all three env prefixes: the bucket and its free
tier are shared, and staging/dev do not run the loop, so the same data is not alerted
three times. It reuses T13931's load_merged_usage() (same shards, same 10 min cache).

Rules (env-overridable, read at module load):
  - any (env, source) with >= R2_ALERT_SOURCE_DAILY_CLASS_A Class A on a UTC day (today
    or yesterday, so a day's last hour still alerts after shard upload lag);
  - cycle-to-date Class A >= R2_ALERT_CYCLE_FRACTION of the free tier, or, once
    R2_ALERT_PROJECTION_MIN_DAYS have elapsed, a linear projection past the free tier.

Once per period, not once per machine -- the T8670 shape with the marker moved to R2
(no Postgres rows):
  1. pg_try_advisory_lock(13930) on one held connection: mutual exclusion for passes
     that overlap in time. Writes no data. Released explicitly; a failed unlock
     force-closes the connection so the lock cannot ride back into the pool.
  2. An R2 marker `production/analytics/r2_usage_alerts.json` = {"sent": {key: iso}}:
     dedup for passes that do not overlap. Keys are `{day}|source_daily|{env}|{source}`
     and `{cycle_start}|cycle_half` / `{cycle_start}|cycle_projection`, so a sustained
     source re-alerts once per day and each cycle rule once per cycle. The marker is read
     only when something crossed, and written HEAD-etag-checked + PUT. A failed marker
     write logs CRITICAL "may re-alert": a rare loud duplicate beats a silent alarm.

Channel: a CRITICAL log line always, then an email to every admin (reconciliation_alert's
channel). A failed email is logged and swallowed.
"""

import asyncio
import json
import logging
import os
from datetime import UTC, date, datetime, timedelta

from ..r2_usage import OpClass, R2Source, r2_source_scope
from .analytics_store import _is_not_found
from .auth_db import get_admin_emails
from .email import body_text_to_html, send_admin_update_email
from .r2_usage_report import R2_FREE_TIER_CLASS_A, billing_cycle, load_merged_usage

logger = logging.getLogger(__name__)

_alert_task: asyncio.Task | None = None

# Fixed, greppable advisory-lock key: the attribution epic's id (T8670 uses 8670).
R2_USAGE_ALERT_LOCK_ID = 13930

R2_ALERT_SOURCE_DAILY_CLASS_A = int(os.getenv("R2_ALERT_SOURCE_DAILY_CLASS_A", "20000"))
R2_ALERT_CYCLE_FRACTION = float(os.getenv("R2_ALERT_CYCLE_FRACTION", "0.5"))
R2_ALERT_PROJECTION_MIN_DAYS = float(os.getenv("R2_ALERT_PROJECTION_MIN_DAYS", "2"))

MARKER_KEY = "production/analytics/r2_usage_alerts.json"
STARTUP_DELAY_SECONDS = 120
INTERVAL_SECONDS = 3600


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def start_r2_usage_alert_loop():
    """Start the hourly alert loop -- production only. Called at startup."""
    global _alert_task
    from ..storage import APP_ENV

    if APP_ENV != "production":
        logger.info(f"[R2UsageAlert] not started (APP_ENV={APP_ENV}; production evaluates all envs)")
        return
    _alert_task = asyncio.create_task(_run_r2_usage_alert_loop())
    logger.info("[R2UsageAlert] Background R2 usage alert loop started")


async def stop_r2_usage_alert_loop():
    """Cancel the alert loop. Called at shutdown."""
    global _alert_task
    if _alert_task:
        _alert_task.cancel()
        try:
            await _alert_task
        except asyncio.CancelledError:
            pass
        _alert_task = None
        logger.info("[R2UsageAlert] Background R2 usage alert loop stopped")


async def _run_r2_usage_alert_loop():
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        try:
            await run_r2_usage_alert_pass()
        except asyncio.CancelledError:
            logger.info("[R2UsageAlert] Shutdown")
            break
        except Exception:
            logger.exception("[R2UsageAlert] pass failed, retrying in 1h")
        await asyncio.sleep(INTERVAL_SECONDS)


@r2_source_scope(R2Source.R2_USAGE_ALERT)
async def run_r2_usage_alert_pass() -> dict:
    """One pass under the advisory lock. Returns {"status", "keys"}; status is one of
    skipped_locked, silent, skipped_already_sent, alerted."""
    import psycopg2

    from .pg import get_pg

    # Once the outcome is fixed (an alert may already be out), no cleanup error may
    # escape: the loop would treat the pass as failed and the next one could re-send.
    outcome: dict | None = None
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT pg_try_advisory_lock(%s) AS acquired", (R2_USAGE_ALERT_LOCK_ID,))
            if not cur.fetchone()["acquired"]:
                logger.info(f"[R2UsageAlert] advisory lock {R2_USAGE_ALERT_LOCK_ID} held by another machine -- skipping")
                return {"status": "skipped_locked", "keys": []}
            try:
                outcome = await _evaluate_and_alert()
                return outcome
            finally:
                _release_lock(conn, cur)
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        if outcome is not None:
            logger.critical(
                f"[R2UsageAlert] connection error after the pass completed (outcome={outcome['status']}) "
                "-- swallowed so the alert is not re-sent on retry"
            )
            return outcome
        raise


def _release_lock(conn, cur) -> None:
    try:
        cur.execute("SELECT pg_advisory_unlock(%s) AS released", (R2_USAGE_ALERT_LOCK_ID,))
    except Exception:
        # A session lock left on a pooled connection would make every later pass
        # skipped_locked -- silently. Close the connection so Postgres drops it.
        logger.critical(
            f"[R2UsageAlert] pg_advisory_unlock({R2_USAGE_ALERT_LOCK_ID}) FAILED -- forcing connection close "
            "so the lock cannot leak onto a pooled connection and stall every future pass"
        )
        try:
            conn.close()
        except Exception:
            pass


async def _evaluate_and_alert() -> dict:
    now = _utcnow()
    merged = await asyncio.to_thread(load_merged_usage)
    if merged.partial:
        logger.error("[R2UsageAlert] usage is partial (a shard was unreadable); evaluating what was read")
    findings = _findings(merged.counts, now)
    if not findings:
        logger.info("[R2UsageAlert] all sources and the cycle are under threshold")
        return {"status": "silent", "keys": []}

    sent, marker_etag = await asyncio.to_thread(_read_marker)
    new = {key: line for key, line in findings.items() if key not in sent}
    if not new:
        logger.info(f"[R2UsageAlert] {len(findings)} crossing(s) already alerted -- skipping")
        return {"status": "skipped_already_sent", "keys": []}

    keys = sorted(new)
    lines = [new[key] for key in keys]
    logger.critical("[R2UsageAlert] R2 USAGE ALERT: " + " ; ".join(f"[{key}] {new[key]}" for key in keys))
    await _send_admin_alert(lines)

    stamped = now.isoformat()
    sent.update({key: stamped for key in keys})
    await asyncio.to_thread(_write_marker, _prune(sent, now.date()), marker_etag)
    return {"status": "alerted", "keys": keys}


def _findings(counts: dict, now: datetime) -> dict[str, str]:
    """{alert key: human line} for every rule currently crossed."""
    today = now.date()
    recent_days = {today.isoformat(), (today - timedelta(days=1)).isoformat()}
    cycle_start, cycle_end = billing_cycle(today)
    source_daily: dict[tuple[str, str, str], int] = {}
    cycle_class_a = 0
    for (day, env, source, op_class), count in counts.items():
        if op_class != OpClass.A.value:
            continue
        if day in recent_days:
            source_daily[(day, env, source)] = source_daily.get((day, env, source), 0) + count
        if cycle_start.isoformat() <= day <= cycle_end.isoformat():
            cycle_class_a += count

    findings = {
        f"{day}|source_daily|{env}|{source}": (
            f"{env} source '{source}' made {n:,} Class A ops on {day} "
            f"(threshold {R2_ALERT_SOURCE_DAILY_CLASS_A:,}/day)"
        )
        for (day, env, source), n in source_daily.items()
        if n >= R2_ALERT_SOURCE_DAILY_CLASS_A
    }

    cycle_days = (cycle_end - cycle_start).days + 1
    elapsed_days = (now - datetime.combine(cycle_start, datetime.min.time(), UTC)).total_seconds() / 86400
    projected = round(cycle_class_a / max(elapsed_days, 1.0) * cycle_days)
    cycle_span = f"cycle {cycle_start.isoformat()}..{cycle_end.isoformat()}"
    if cycle_class_a >= R2_ALERT_CYCLE_FRACTION * R2_FREE_TIER_CLASS_A:
        findings[f"{cycle_start.isoformat()}|cycle_half"] = (
            f"{cycle_span}: {cycle_class_a:,} Class A so far, "
            f">= {R2_ALERT_CYCLE_FRACTION:.0%} of the {R2_FREE_TIER_CLASS_A:,} free tier"
        )
    if elapsed_days >= R2_ALERT_PROJECTION_MIN_DAYS and projected > R2_FREE_TIER_CLASS_A:
        findings[f"{cycle_start.isoformat()}|cycle_projection"] = (
            f"{cycle_span}: {cycle_class_a:,} Class A in {elapsed_days:.1f} days projects to "
            f"{projected:,}, past the {R2_FREE_TIER_CLASS_A:,} free tier"
        )
    return findings


def _prune(sent: dict[str, str], today: date) -> dict[str, str]:
    """Keep keys from the previous billing cycle onwards (each key starts with its date)."""
    current_start, _ = billing_cycle(today)
    previous_start, _ = billing_cycle(current_start - timedelta(days=1))
    return {key: at for key, at in sent.items() if key.split("|", 1)[0] >= previous_start.isoformat()}


def _read_marker() -> tuple[dict[str, str], str | None]:
    """(sent keys, etag). 404 is an empty marker. An unreadable marker alerts anyway:
    a duplicate is better than a dedup failure turning into silence."""
    from ..storage import R2_BUCKET, get_r2_client

    client = get_r2_client()
    try:
        resp = client.get_object(Bucket=R2_BUCKET, Key=MARKER_KEY)
    except Exception as e:
        if _is_not_found(e):
            return {}, None
        logger.critical(f"[R2UsageAlert] marker {MARKER_KEY} unreadable ({e}) -- alerting without dedup, may re-alert")
        return {}, None
    try:
        return json.loads(resp["Body"].read())["sent"], resp["ETag"]
    except (ValueError, KeyError, TypeError) as e:
        logger.critical(f"[R2UsageAlert] marker {MARKER_KEY} malformed ({e}) -- alerting without dedup, may re-alert")
        return {}, resp["ETag"]


def _write_marker(sent: dict[str, str], expected_etag: str | None) -> None:
    """HEAD-etag check, then PUT. Never raises: the alert is already out."""
    from ..storage import R2_BUCKET, get_r2_client

    client = get_r2_client()
    try:
        try:
            found_etag = client.head_object(Bucket=R2_BUCKET, Key=MARKER_KEY)["ETag"]
        except Exception as e:
            if not _is_not_found(e):
                raise
            found_etag = None
        if found_etag != expected_etag:
            raise RuntimeError(f"marker changed since read (expected {expected_etag}, found {found_etag})")
        client.put_object(
            Bucket=R2_BUCKET,
            Key=MARKER_KEY,
            Body=json.dumps({"sent": sent}, sort_keys=True).encode(),
            ContentType="application/json",
        )
    except Exception as e:
        logger.critical(
            f"[R2UsageAlert] failed to write alert marker {MARKER_KEY} ({e}) -- the next pass may re-alert "
            "(accepted: a rare loud duplicate beats a silent stall)"
        )


async def _send_admin_alert(lines: list[str]) -> None:
    try:
        recipients = get_admin_emails()
    except Exception:
        logger.exception("[R2UsageAlert] could not resolve admin recipients -- email skipped (CRITICAL log already emitted)")
        return
    if not recipients:
        logger.warning("[R2UsageAlert] no admin recipients configured -- email skipped (CRITICAL log already emitted)")
        return

    noun = "threshold" if len(lines) == 1 else "thresholds"
    subject = f"ReelBallers R2 usage: {len(lines)} {noun} crossed"
    body_html = body_text_to_html(
        "The hourly R2 usage check found Class A operations past an alert threshold. "
        "Counts cover server-side boto3 calls in all three environments (the bucket and "
        "its free tier are shared).\n\n"
        + "\n".join(lines)
        + "\n\nPer-source daily detail is in the admin panel's R2 usage section."
    )
    for email in recipients:
        try:
            if not await send_admin_update_email(email, subject, body_html):
                logger.error(f"[R2UsageAlert] alert email to {email} reported failure")
        except Exception:
            logger.exception(f"[R2UsageAlert] alert email to {email} raised -- continuing")
