"""
Credit backfill (T5840) — admin dry-run report + apply tool that migrates each
user's legacy user.sqlite credit ledger into Postgres.

Deliberately NOT a versioned `user_db` migration file (design 3b): money needs a
dry-run report a human reads before anything is written, and a migration's
`up(conn)` gets no user context to force-download R2 with. This tool force-
downloads R2 itself for that reason -- it never trusts a live machine's cached
local snapshot for money (see `_force_download_user_db` below).

T5085 note: the `credits`/`credit_transactions`/`credit_reservations` tables
this tool reads are base `_USER_DB_SCHEMA` (user_db.py), never migration-
added, so there is no schema-version hazard here regardless of which
migration mechanism (JIT seam or the retired bulk runner) last touched the
DB -- this tool deliberately reads pre-migration-shape tables as part of its
contract, tolerate-permanent. It is a one-shot T5840 cutover tool; confirm
with the user whether it can be deleted alongside T5089.

Per-user algorithm (design 3c), one Postgres transaction per user:
  1. Force-download the R2 copy of user.sqlite (never trust a cached local
     snapshot for money) + read any local copy.
  2. Read ledger + balance + reservations from EACH copy present; check the
     historical invariant (balance == Sigma(ledger) - Sigma(reservations)) on each.
  3/4. Key every ledger row with the SAME derivation runtime uses
     (credit_ledger.credit_key) when it has a reference_id, else a
     content-only key `legacy:{(source, amount, created_at)}:{ordinal}` with
     ordinal count = multiset-max across the two copies (never origin- or
     rowid-tagged -- that re-keys the same row across a machine replacement
     and double-credits on the next catch-up run). Rows from R2 and local
     naturally coalesce under this key via ON CONFLICT DO NOTHING -- no
     separate dedup pass needed.
  5. Insert missing rows, then re-derive balance = SUM(pg ledger). Never copy a
     balance from SQLite -- this identity is what makes re-running always safe:
     a second run only inserts rows PG is still missing and recomputes the sum.

Open reservations are never carried forward -- dropping them credits their
amount back into the re-derived balance (mirrors recover_orphaned_reservations);
each one is reported, never silently applied.

`CHECK (balance >= 0)` on the `credits` table can refuse a user whose historical
ledger sum is negative (a past overdraft bug) -- that user is flagged
`negative_balance` and left untouched in Postgres pending manual review; the
transaction rolls back for them and the rest of the batch is unaffected.
"""

import logging
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path

from .credit_ledger import credit_key
from .pg import get_pg

logger = logging.getLogger(__name__)


def _force_download_user_db(user_id: str, local_path: Path) -> bool:
    """Download user.sqlite from R2 to local_path. True if found, False only if
    the object is GENUINELY ABSENT (404/NoSuchKey) or R2 isn't configured.

    Raises _UnreadableCopy for ANY other failure (throttle/SlowDown, socket
    timeout, credential error, wrong bucket). MAJOR-3: a bare `except Exception:
    return False` folded every transient error into "no account", so a download
    that never happened became `status: no_user_db` -- which `_gate_blocking_rows`
    skips unconditionally. R2 throttling ~5 of 400 downloads during the final dry
    run would then hide inside a legitimately large `no_user_db` count (purged/
    guest ghosts), the gate would open, and those users -- possibly mid-Stripe-
    pack -- would see balance 0 post-cutover. A transient failure must instead
    flag `unreadable_copy`, which DOES block the gate.

    Mirrors migrations/__init__.py:_download_profile_db but for the per-user (not
    per-profile) user.sqlite object.
    """
    from botocore.exceptions import ClientError

    from ..storage import APP_ENV, R2_BUCKET, get_r2_client

    client = get_r2_client()
    if not client:
        return False
    key = f"{APP_ENV}/users/{user_id}/user.sqlite"
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(R2_BUCKET, key, str(local_path))
        return True
    except ClientError as e:
        code = str((e.response.get("Error", {}) or {}).get("Code", ""))
        status = (e.response.get("ResponseMetadata", {}) or {}).get("HTTPStatusCode")
        if code in ("404", "NoSuchKey") or status == 404:
            logger.info(f"[CreditBackfill] no R2 user.sqlite for {user_id} (absent: {code or status})")
            return False
        logger.warning(
            f"[CreditBackfill] R2 download FAILED for {user_id} ({code or status}: {e}) -- "
            f"flagging unreadable, NOT treating as absent"
        )
        raise _UnreadableCopy(str(e)) from e
    except Exception as e:
        logger.warning(
            f"[CreditBackfill] R2 download error for {user_id} ({e}) -- "
            f"flagging unreadable, NOT treating as absent"
        )
        raise _UnreadableCopy(str(e)) from e


class _UnreadableCopy(Exception):
    """The file EXISTS but could not be read (corrupt/locked/etc). Distinct
    from "absent" (N2) -- silently treating an unreadable copy the same as a
    genuinely absent one degrades to R2-only (or local-only) with no signal
    that a copy which might hold the missing money simply couldn't be opened.
    """


def _read_copy(db_path: Path, user_id: str) -> dict | None:
    """Read {balance, ledger, reservations} from a user.sqlite.
    Returns None if the file is genuinely ABSENT.
    Raises _UnreadableCopy if it EXISTS but could not be read."""
    if not db_path.exists():
        return None
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            brow = conn.execute(
                "SELECT balance FROM credits WHERE user_id = ?", (user_id,)
            ).fetchone()
            balance = brow["balance"] if brow else None
            ledger_rows = conn.execute(
                """SELECT id, amount, source, reference_id, video_seconds, created_at
                   FROM credit_transactions WHERE user_id = ? ORDER BY id""",
                (user_id,),
            ).fetchall()
            resv_rows = conn.execute(
                "SELECT job_id, amount, video_seconds FROM credit_reservations"
            ).fetchall()
            return {
                "balance": balance,
                "ledger": [dict(r) for r in ledger_rows],
                "reservations": [dict(r) for r in resv_rows],
            }
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.warning(f"[CreditBackfill] could not read {db_path}: {e}")
        raise _UnreadableCopy(str(e)) from e


def _check_invariant(copy: dict) -> bool:
    """balance == Sigma(ledger.amount) - Sigma(reservations.amount). Holds by construction
    unless a historical bug (or manual DB edit) corrupted the file."""
    if copy["balance"] is None:
        return True
    ledger_sum = sum(r["amount"] for r in copy["ledger"])
    resv_sum = sum(r["amount"] for r in copy["reservations"])
    return copy["balance"] == ledger_sum - resv_sum


def _content_sig(row: dict) -> tuple:
    """Cross-copy identity for a NULL-reference_id row: there is no natural key
    (unlike a Stripe/quest/export row), so content is all we have to match on."""
    return (row["source"], row["amount"], row["created_at"])


def _key_rows_for_backfill(r2_ledger: list[dict], local_ledger: list[dict]) -> list[tuple[str, dict]]:
    """Key every ledger row from BOTH copies for insertion. Never drops a row
    (BLOCKING-1 fix) and never re-keys the SAME row differently depending on
    which copies happen to be present at run time (BLOCKING-A fix).

    Rows WITH a reference_id key via the SAME derivation the runtime uses
    (`credit_key`) -- critical for Stripe redelivery safety, and it also means
    the identical event recorded in both copies naturally shares a key (handled
    by the caller's dedup pass / Postgres ON CONFLICT), no special-casing needed.

    Rows WITHOUT a reference_id (admin_grant / new_account_bonus / dev
    selfgrant) have no natural cross-copy identity, so content
    (source, amount, created_at) is the key. Content-only keying is DELIBERATE
    (not origin- or rowid-tagged): a key that depends on which copies were
    readable at run time re-keys the same physical row across a machine
    replacement (design 4b's D2 cutover deploy wipes the local volume), and a
    catch-up backfill run afterward sees a "new" key for a row it already
    inserted -- double-crediting every signup bonus and admin grant
    (BLOCKING-A). Multiplicity per signature is the MAX across the two copies
    (Counter `|`, i.e. multiset union) -- if two copies each show the grant
    once, count=1 (never re-inserted regardless of which copy is present on a
    later run); if one copy shows it twice (e.g. a genuine double-grant bug),
    count=2 so both still survive (BLOCKING-1: over-crediting on an ambiguous
    fork is the accepted tradeoff, silently dropping a real grant is not).
    """
    keyed: list[tuple[str, dict]] = []

    for row in r2_ledger + local_ledger:
        if row["reference_id"] is not None:
            try:
                keyed.append((credit_key(row["source"], row["reference_id"]), row))
            except ValueError:
                keyed.append((f"legacy:ref:{row['source']}:{row['reference_id']}", row))

    r2_null = [r for r in r2_ledger if r["reference_id"] is None]
    local_null = [r for r in local_ledger if r["reference_id"] is None]

    rows_by_sig: dict[tuple, list[dict]] = {}
    for row in r2_null + local_null:
        rows_by_sig.setdefault(_content_sig(row), []).append(row)

    r2_counts = Counter(_content_sig(r) for r in r2_null)
    local_counts = Counter(_content_sig(r) for r in local_null)
    multiplicity = r2_counts | local_counts  # multiset union == elementwise max

    for sig, count in multiplicity.items():
        representative = rows_by_sig[sig][0]
        for ordinal in range(count):
            keyed.append((f"legacy:{sig}:{ordinal}", representative))

    return keyed


def _dedupe_new_rows(keyed_rows: list[tuple[str, dict]], existing_keys: set[str]) -> list[tuple[str, dict]]:
    """Return [(key, row), ...] for rows not already in Postgres. `keyed_rows`
    already carries each row's final key (see `_key_rows_for_backfill`) -- this
    only drops a row when its key is a genuine duplicate (already in Postgres,
    or repeated within this same batch), never on cross-copy ambiguity."""
    seen: set[str] = set()
    out: list[tuple[str, dict]] = []
    for key, row in keyed_rows:
        if key in existing_keys or key in seen:
            continue
        seen.add(key)
        out.append((key, row))
    return out


def _backfill_one_user(user_id: str, email: str | None, apply: bool) -> dict:
    from .user_db import USER_DATA_BASE

    local_path = USER_DATA_BASE / user_id / "user.sqlite"
    local_unreadable = False
    try:
        local_copy = _read_copy(local_path, user_id)
    except _UnreadableCopy:
        local_copy = None
        local_unreadable = True

    r2_unreadable = False
    with tempfile.TemporaryDirectory() as tmp:
        r2_path = Path(tmp) / "user.sqlite"
        # MAJOR-3: the download itself now raises _UnreadableCopy on a transient
        # R2 failure (distinct from a genuine 404, which returns False), so it
        # must sit INSIDE this guard alongside the read -- a failed download is
        # every bit as much "a copy we couldn't read" as a corrupt one.
        try:
            downloaded = _force_download_user_db(user_id, r2_path)
            r2_copy = _read_copy(r2_path, user_id) if downloaded else None
        except _UnreadableCopy:
            r2_copy = None
            r2_unreadable = True

    base = {
        "user_id": user_id,
        "email": email,
        "r2_balance": r2_copy["balance"] if r2_copy else None,
        "local_balance": local_copy["balance"] if local_copy else None,
    }

    # N2: an unreadable (not just absent) copy must never silently degrade to
    # "as if it never existed" -- it might hold the very data we're missing.
    # Report it for human review rather than folding it into `no_user_db`
    # (which means "genuinely nothing to migrate", a different, safe state).
    if r2_copy is None and local_copy is None:
        if local_unreadable or r2_unreadable:
            return {
                **base,
                "status": "flagged_needs_review",
                "flags": ["unreadable_copy"],
                "ledger_sum": 0,
                "open_reservations": 0,
                "tx_count": 0,
                "pg_balance_now": None,
                "pg_balance_after": None,
                "delta": 0,
            }
        return {
            **base,
            "status": "no_user_db",
            "flags": ["no_user_db"],
            "ledger_sum": 0,
            "open_reservations": 0,
            "tx_count": 0,
            "pg_balance_now": None,
            "pg_balance_after": None,
            "delta": 0,
        }

    flags: list[str] = []
    if local_unreadable or r2_unreadable:
        flags.append("unreadable_copy")
    for copy in (r2_copy, local_copy):
        if copy is not None and not _check_invariant(copy):
            flags.append("ledger_mismatch")

    if r2_copy is not None and local_copy is not None:
        # N3: multiset (Counter), not set -- a set comparison treats "row X
        # twice in R2, once in local" as equal to "row X once in each",
        # silently losing multiplicity differences.
        r2_multiset = Counter((r["source"], r["reference_id"], r["amount"], r["created_at"]) for r in r2_copy["ledger"])
        local_multiset = Counter((r["source"], r["reference_id"], r["amount"], r["created_at"]) for r in local_copy["ledger"])
        if r2_multiset != local_multiset:
            flags.append("divergent")

    all_rows: list[dict] = []
    for copy in (r2_copy, local_copy):
        if copy is not None:
            all_rows.extend(copy["ledger"])
    ledger_sum = sum(r["amount"] for r in all_rows)

    open_reservations = 0
    seen_jobs: set[str] = set()
    for copy in (r2_copy, local_copy):
        if copy is None:
            continue
        for r in copy["reservations"]:
            if r["job_id"] not in seen_jobs:
                seen_jobs.add(r["job_id"])
                open_reservations += 1

    with get_pg() as conn:
        cur = conn.cursor()
        # Ensure the row exists, then lock it for the rest of this transaction --
        # a concurrent grant/debit/reserve on this user during the recompute
        # below would otherwise race the re-derive (this tool runs unattended,
        # possibly on a live user, per design 4b's catch-up pass).
        cur.execute(
            "INSERT INTO credits (user_id, balance) VALUES (%s, 0) ON CONFLICT DO NOTHING",
            (user_id,),
        )
        cur.execute("SELECT balance FROM credits WHERE user_id = %s FOR UPDATE", (user_id,))
        row = cur.fetchone()
        # N1: a concurrent account purge (_purge_user_data) can remove the row
        # between our INSERT and this SELECT -- treat as a fresh zero rather
        # than raising TypeError on None["balance"].
        pg_balance_now = row["balance"] if row else 0

        cur.execute(
            "SELECT idempotency_key FROM credit_transactions WHERE user_id = %s", (user_id,)
        )
        existing_keys = {r["idempotency_key"] for r in cur.fetchall()}

        keyed_rows = _key_rows_for_backfill(
            r2_copy["ledger"] if r2_copy else [],
            local_copy["ledger"] if local_copy else [],
        )
        to_insert = _dedupe_new_rows(keyed_rows, existing_keys)
        new_sum = sum(row_data["amount"] for _key, row_data in to_insert)

        # M1/M2 fix: re-derive from the ACTUAL Postgres ledger + open
        # reservations, not from `pg_balance_now + new_sum`. Two reasons:
        #  - M1: post-cutover, `reserve_credits` debits `balance` WITHOUT a
        #    ledger row (confirm later writes the row without touching
        #    balance again) -- so the true invariant is
        #    balance = Sigma(ledger) - Sigma(open reservations). Re-deriving as
        #    just Sigma(ledger) silently re-credits every open reservation's
        #    amount back to the user on every re-run (free credits, and it
        #    breaks the invariant permanently for as long as the export is in
        #    flight).
        #  - M2: `pg_balance_now + new_sum` only ever reflects NEW rows -- a
        #    user whose stored balance already drifted from Sigma(ledger) (a
        #    historical bug, a manual DB edit) reports `delta == 0` and passes
        #    the credits_ready gate's "zero drift" check even though a real
        #    apply would change their balance. Computing PROJECTED balance
        #    from scratch (not incrementally) makes the dry run predict
        #    exactly what apply would do, drift included.
        cur.execute(
            "SELECT COALESCE(SUM(amount), 0) AS s FROM credit_transactions WHERE user_id = %s",
            (user_id,),
        )
        current_ledger_sum = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount), 0) AS s FROM credit_reservations WHERE user_id = %s",
            (user_id,),
        )
        pg_open_reservations = cur.fetchone()["s"]
        projected_balance = current_ledger_sum + new_sum - pg_open_reservations

        if projected_balance < 0:
            flags.append("negative_balance")
            conn.rollback()
            return {
                **base,
                "status": "flagged_needs_review",
                "flags": flags,
                "ledger_sum": ledger_sum,
                "open_reservations": open_reservations,
                "tx_count": len(to_insert),
                "pg_balance_now": pg_balance_now,
                "pg_balance_after": pg_balance_now,
                "delta": 0,
            }

        if apply:
            for key, row_data in to_insert:
                cur.execute(
                    """INSERT INTO credit_transactions
                        (user_id, amount, source, idempotency_key, reference_id, video_seconds, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (user_id, idempotency_key) DO NOTHING""",
                    (
                        user_id, row_data["amount"], row_data["source"], key,
                        row_data["reference_id"], row_data["video_seconds"], row_data["created_at"],
                    ),
                )
            cur.execute(
                "UPDATE credits SET balance = %s, updated_at = now() WHERE user_id = %s",
                (projected_balance, user_id),
            )
            pg_balance_after = projected_balance
        else:
            conn.rollback()
            pg_balance_after = projected_balance

    return {
        **base,
        "status": "ok",
        "flags": flags,
        "ledger_sum": ledger_sum,
        "open_reservations": open_reservations,
        "tx_count": len(to_insert),
        "pg_balance_now": pg_balance_now,
        "pg_balance_after": pg_balance_after,
        "delta": pg_balance_after - pg_balance_now,
    }


def _enumerate_users() -> list[dict]:
    """Postgres-derived enumeration, NO user_segments join (T4970 -- segmentless
    users, e.g. test-login/X-User-ID accounts, must not be silently excluded)."""
    from .auth_db import get_all_users_for_admin
    return get_all_users_for_admin()


def run_backfill(
    user_ids: list[str] | None = None,
    apply: bool = False,
    limit: int | None = None,
    offset: int = 0,
) -> dict:
    """Dry-run report (apply=False) or apply (apply=True). Re-runnable forever --
    a second call only inserts rows Postgres is still missing and recomputes sums.

    M7 (review round 2): `limit`/`offset` chunk the full (user_ids=None)
    enumeration -- each user pays an R2 download + several PG round trips, so
    an unbounded scan is minutes of synchronous wall time in one HTTP request
    (a real Fly proxy timeout risk) once the user base is nontrivial. Only a
    COMPLETE, unchunked, full-enumeration run (user_ids=None AND limit=None)
    is saved as "the" stored report -- a partial page or a targeted re-run
    would corrupt the whole-population snapshot open-gate reads.
    """
    is_full_enumeration = user_ids is None and limit is None

    if user_ids is not None:
        from .auth_db import get_user_by_id
        targets = []
        for uid in user_ids:
            user = get_user_by_id(uid)
            targets.append({"user_id": uid, "email": user["email"] if user else None})
        total_enumerated = len(targets)
        # MAJOR-2: `limit`/`offset` must chunk the targeted branch too. Slicing
        # lived ONLY in the else branch, so a targeted run processed EVERY id
        # regardless of `limit` while the summary still advertised
        # limit/total_enumerated/has_more -- an operator passing 300 ids + a
        # safety `limit` ran 300 synchronous R2 downloads + PG round trips in one
        # request (the Fly proxy timeout M7 chunking exists to prevent), got a
        # 502 with no report while _backfill_one_user had already committed
        # per-user, then was told has_more to re-run and re-process everything.
        if limit is not None:
            targets = targets[offset:offset + limit]
    else:
        all_users = _enumerate_users()
        total_enumerated = len(all_users)
        page = all_users[offset:offset + limit] if limit is not None else all_users
        targets = [{"user_id": u["user_id"], "email": u.get("email")} for u in page]

    rows = [_backfill_one_user(t["user_id"], t["email"], apply) for t in targets]

    def _anomaly_rank(r: dict) -> int:
        # A pure `no_user_db` row is an expected, harmless ghost (purged/guest
        # account) -- ranking it alongside real anomalies buries the ones a
        # human actually needs to review under a wall of ghosts.
        if not r["flags"]:
            return 2
        if set(r["flags"]) == {"no_user_db"}:
            return 1
        return 0

    rows.sort(key=_anomaly_rank)

    summary = {
        "total_users": len(rows),
        "ok": sum(1 for r in rows if r["status"] == "ok"),
        "no_user_db": sum(1 for r in rows if r["status"] == "no_user_db"),
        "flagged_needs_review": sum(1 for r in rows if r["status"] == "flagged_needs_review"),
        "divergent": sum(1 for r in rows if "divergent" in r["flags"]),
        "ledger_mismatch": sum(1 for r in rows if "ledger_mismatch" in r["flags"]),
        "negative_balance": sum(1 for r in rows if "negative_balance" in r["flags"]),
        "total_delta": sum(r["delta"] for r in rows),
        "open_reservations_released": sum(r["open_reservations"] for r in rows),
        "applied": apply,
    }
    if limit is not None:
        summary["limit"] = limit
        summary["offset"] = offset
        summary["total_enumerated"] = total_enumerated
        summary["has_more"] = offset + limit < total_enumerated

    result = {"rows": rows, "summary": summary}
    if is_full_enumeration:
        save_report(result)
    return result


def save_report(report: dict) -> None:
    """Persist the most recent FULL backfill report so open-gate can consume
    it without recomputing (M7)."""
    from psycopg2.extras import Json

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO credit_migration_state (id, last_report, last_report_at)
            VALUES (1, %s, now())
            ON CONFLICT (id) DO UPDATE SET last_report = %s, last_report_at = now()
            """,
            (Json(report), Json(report)),
        )


def load_last_report() -> dict | None:
    """Return {"report": dict, "generated_at": datetime} or None if no full
    report has ever been generated."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT last_report, last_report_at FROM credit_migration_state WHERE id = 1")
        row = cur.fetchone()
    if not row or row["last_report"] is None:
        return None
    return {"report": row["last_report"], "generated_at": row["last_report_at"]}


def reconcile_against_stripe() -> dict:
    """AC: 'purchases reconciled against Stripe'. Reuses T5760's builders UNCHANGED
    (design 3d) -- for every succeeded live-mode PI the expected ledger key is
    stripe:{pi.id} and the expected amount is int(pi.metadata['credits']), read off
    the PI (not CREDIT_PACKS), so T4940's reprice has zero effect on historical rows.
    """
    from .credit_ledger import credit_key, has_key
    from .revenue_reconciliation import fetch_stripe_intents

    intents = fetch_stripe_intents()
    rows = []
    seen_pi_ids: set[str] = set()
    for pi in intents:
        if pi.get("status") != "succeeded" or not pi.get("livemode"):
            continue
        metadata = pi.get("metadata") or {}
        user_id = metadata.get("user_id")
        credits = metadata.get("credits")
        if not user_id or not credits:
            continue
        seen_pi_ids.add(pi["id"])
        key = credit_key("stripe_purchase", pi["id"])
        if has_key(user_id, key):
            continue
        rows.append({
            "pi_id": pi["id"],
            "user_id": user_id,
            "expected_credits": int(credits),
            "flag": "missing_stripe_grant",
        })

    # unknown_stripe_grant: a stripe_purchase ledger row whose PI id has no
    # matching succeeded live-mode PI in this fetch (expected for test-mode-era
    # rows -- T5760's test_mode_era classification covers WHY, this only detects).
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, reference_id, amount FROM credit_transactions "
            "WHERE source = 'stripe_purchase' AND amount > 0"
        )
        purchase_rows = cur.fetchall()
    unknown = [
        {"pi_id": r["reference_id"], "user_id": r["user_id"], "amount": r["amount"], "flag": "unknown_stripe_grant"}
        for r in purchase_rows
        if r["reference_id"] not in seen_pi_ids
    ]

    return {"missing_stripe_grant": rows, "unknown_stripe_grant": unknown}
