"""T8620: backfill the append-only `payments` ledger from live Stripe history.

Standalone, dry-run by default, idempotent (re-runnable with no duplicate rows --
every insert goes through the SAME `ON CONFLICT (stripe_object_id, kind) DO
NOTHING` helpers the live write path uses). See
docs/plans/tasks/revenue-integrity/T8620-design.md §7 for the full spec.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\backfill_payments_ledger.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\backfill_payments_ledger.py --env dev --write

Non-dev `--write` is an OPERATOR step, never run from the container:
    ... --env staging --write --i-am-the-operator
    ... --env prod    --write --i-am-the-operator

What it does per succeeded live PaymentIntent (via `fetch_stripe_intents`,
which expands `latest_charge` + its `dispute`):
  1. Writes one `purchase` row (amount = amount_received, charge id from the
     expanded latest_charge, pack/credits from metadata if present).
  2. Writes one negative `refund` row per individual Stripe refund on the
     charge (`re_...`), for any charge with `amount_refunded > 0`.
  3. Writes one negative `dispute_lost` row if the expanded dispute is in a
     terminal LOST status (`dp_...`). WON/open disputes write nothing.
  4. Fills `stripe_charge_id` on any row (live-written or just backfilled)
     that is still NULL, via the same `fill_missing_charge_id` the live
     background fill uses.

NEVER calls `bump_total_spent` / touches `total_spent_cents` (ruling 4d) --
this script only ever writes ledger rows.

The 2026-08-24 orphan PI (`pi_3U7p5aIxob3dHqK01QfOa5qu`, user
`fb40690a-edcf-4504-a51f-f9df6f84ac4f`, no matching `users` row) is IN SCOPE
and is the point: `payments.user_id` has no FK, so it inserts cleanly. Do not
filter rows by "user exists".
"""

import argparse
import sys
from pathlib import Path
from urllib.parse import urlparse

import stripe

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))

# Terminal-lost dispute statuses (mirrors revenue_reconciliation.LOST_DISPUTE_STATUSES).
LOST_DISPUTE_STATUSES = frozenset({"lost", "charge_refunded"})


class BackfillSafetyError(RuntimeError):
    """A preflight or reconciliation failure that makes a write unsafe."""


def _validate_target(config: dict) -> None:
    """Fail closed when credentials and the requested environment disagree."""
    env_name = config.get("APP_ENV")
    if env_name == "production":
        env_name = "prod"
    database_url = config.get("DATABASE_URL", "")
    stripe_key = config.get("STRIPE_SECRET_KEY", "")
    host = (urlparse(database_url).hostname or "").lower()

    if env_name == "staging":
        if "staging" not in host:
            raise BackfillSafetyError(
                f"staging requested but DATABASE_URL host is not a staging host: {host or '<missing>'}"
            )
        if not stripe_key.startswith("sk_test_"):
            raise BackfillSafetyError("staging requires a Stripe test-mode secret key")
    elif env_name == "prod":
        if not host or "staging" in host or host in {"localhost", "127.0.0.1"}:
            raise BackfillSafetyError(
                f"prod requested but DATABASE_URL host is not a production host: {host or '<missing>'}"
            )
        if not stripe_key.startswith("sk_live_"):
            raise BackfillSafetyError("prod requires a Stripe live-mode secret key")
    elif env_name != "dev":
        raise BackfillSafetyError(f"unknown APP_ENV: {env_name!r}")


def _assert_database_guards(cur) -> None:
    """Verify the append-only table, idempotency index, and triggers before writing."""
    cur.execute("SELECT to_regclass('public.payments') AS table_name")
    if not cur.fetchone()["table_name"]:
        raise BackfillSafetyError("payments table is missing; run migrations before backfill")

    cur.execute(
        "SELECT indexdef FROM pg_indexes "
        "WHERE schemaname = 'public' AND indexname = 'uq_payments_object_kind'"
    )
    index_row = cur.fetchone()
    if not index_row or "UNIQUE INDEX" not in index_row["indexdef"].upper():
        raise BackfillSafetyError("payments idempotency unique index is missing")

    cur.execute(
        "SELECT tgname FROM pg_trigger "
        "WHERE tgrelid = 'public.payments'::regclass AND NOT tgisinternal"
    )
    triggers = {row["tgname"] for row in cur.fetchall()}
    required = {"trg_payments_append_only", "trg_payments_no_truncate"}
    missing = required - triggers
    if missing:
        raise BackfillSafetyError(
            f"payments safety trigger(s) missing: {', '.join(sorted(missing))}"
        )


def load_env(env_name: str) -> dict:
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"ERROR: {env_file} not found")
        sys.exit(1)

    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()

    for key in ("DATABASE_URL", "STRIPE_SECRET_KEY"):
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}")
            sys.exit(1)

    config.setdefault("APP_ENV", env_name)
    return config


def _target_host(database_url: str) -> str:
    """Best-effort host extraction for the printed guardrail line (no creds)."""
    try:
        after_at = database_url.split("@", 1)[1]
        return after_at.split("/", 1)[0]
    except Exception:
        return "<unparsable DATABASE_URL>"


def _charge_of(intent: dict) -> dict | None:
    charge = intent.get("latest_charge")
    if not charge or isinstance(charge, str):
        return None
    return charge


def _dispute_lost_row(intent: dict, charge: dict | None):
    """Return (dp_id, amount_cents) for a terminal-LOST dispute, else None.

    Mirrors revenue_reconciliation.build_stripe_net_by_user's netting: a
    dispute resolved by refunding the charge (status ``charge_refunded``)
    sets BOTH ``amount_refunded`` and the dispute amount for the SAME money
    leaving us. Net the dispute against the charge's cumulative refunded
    amount so that money is subtracted once, not twice -- otherwise the
    backfilled ledger permanently double-counts that charge's loss (append-
    only, so a re-run cannot self-correct it). A genuine lost dispute (funds
    withdrawn directly, no refund) has refunded == 0, so the full amount
    still applies.
    """
    if not charge:
        return None
    dispute = charge.get("dispute")
    if not dispute or isinstance(dispute, str):
        return None
    if dispute.get("status") not in LOST_DISPUTE_STATUSES:
        return None
    dp_id = dispute.get("id")
    raw_amount = dispute.get("amount", 0) or 0
    refunded = charge.get("amount_refunded", 0) or 0
    amount = max(raw_amount - refunded, 0)
    if not dp_id or amount <= 0:
        return None
    return dp_id, amount


def _refund_rows(charge: dict):
    """Yield (re_id, amount, created) for every SUCCEEDED individual refund on a
    charge with a nonzero cumulative amount_refunded. Retrieves the refund list
    explicitly -- `fetch_stripe_intents`'s expand does not include the per-refund
    list. Status rule matches the live webhook branch and the reconciler
    (`amount_refunded` advances only for succeeded refunds), so pending/failed/
    canceled refunds are skipped (T8620-design.md §G3)."""
    if not charge or (charge.get("amount_refunded", 0) or 0) <= 0:
        return
    charge_id = charge.get("id")
    if not charge_id:
        return
    refund_list = stripe.Refund.list(charge=charge_id, limit=100)
    for refund in refund_list.auto_paging_iter():
        if refund.get("status") != "succeeded":
            continue
        amount = refund.get("amount", 0) or 0
        refund_id = refund.get("id")
        if refund_id and amount > 0:
            yield refund_id, amount, refund.get("created")


def _iso(created_epoch):
    from datetime import UTC, datetime

    return datetime.fromtimestamp(created_epoch, tz=UTC)


def _build_plan(intents: list) -> list[dict]:
    """Resolve and validate the complete Stripe plan before any DB write."""
    plan, errors, keys = [], [], set()

    def add(row):
        key = (row["stripe_object_id"], row["kind"])
        if key in keys:
            errors.append(f"duplicate Stripe event: kind={key[1]} object={key[0]}")
        else:
            keys.add(key)
            plan.append(row)

    for pi in intents:
        if pi.get("status") != "succeeded":
            continue
        pi_id = pi.get("id")
        meta = pi.get("metadata") or {}
        user_id = meta.get("user_id")
        amount = pi.get("amount_received", 0) or 0
        currency = (pi.get("currency") or "").lower()
        if not pi_id:
            errors.append("succeeded PaymentIntent has no id")
            continue
        if not user_id:
            errors.append(f"succeeded PaymentIntent {pi_id} has no metadata.user_id")
            continue
        if amount <= 0:
            errors.append(f"succeeded PaymentIntent {pi_id} has invalid amount_received={amount}")
            continue
        if currency != "usd":
            errors.append(f"PaymentIntent {pi_id} has unsupported currency={currency!r}")
            continue
        try:
            credits = int(meta["credits"]) if meta.get("credits") else None
        except (TypeError, ValueError):
            errors.append(f"PaymentIntent {pi_id} has invalid metadata.credits={meta.get('credits')!r}")
            continue

        charge = _charge_of(pi)
        charge_id = charge.get("id") if charge else None
        occurred_at = _iso(pi.get("created") or 0)
        add({"kind": "purchase", "user_id": user_id, "amount_cents": amount,
             "currency": currency, "stripe_object_id": pi_id,
             "stripe_charge_id": charge_id, "pack": meta.get("pack"),
             "credits": credits, "occurred_at": occurred_at})

        refunds = list(_refund_rows(charge))
        if charge:
            expected = charge.get("amount_refunded", 0) or 0
            actual = sum(value for _, value, _ in refunds)
            if actual != expected:
                errors.append(
                    f"charge {charge_id or '<missing>'} refund rows total {actual}, "
                    f"Stripe amount_refunded={expected}"
                )
        for refund_id, refund_amount, refund_created in refunds:
            add({"kind": "refund", "user_id": user_id,
                 "amount_cents": -refund_amount, "currency": currency,
                 "stripe_object_id": refund_id, "stripe_charge_id": charge_id,
                 "pack": None, "credits": None,
                 "occurred_at": _iso(refund_created) if refund_created else occurred_at})

        dispute = _dispute_lost_row(pi, charge)
        if dispute:
            dispute_id, dispute_amount = dispute
            add({"kind": "dispute_lost", "user_id": user_id,
                 "amount_cents": -dispute_amount, "currency": currency,
                 "stripe_object_id": dispute_id, "stripe_charge_id": charge_id,
                 "pack": None, "credits": None, "occurred_at": occurred_at})

    if errors:
        raise BackfillSafetyError("Stripe preflight failed:\n  - " + "\n  - ".join(errors))
    return plan


def _verify_rows_and_totals(cur, plan: list[dict], stripe_net: dict) -> None:
    mismatches = []
    for expected in plan:
        cur.execute(
            "SELECT user_id, amount_cents, currency, stripe_charge_id FROM payments "
            "WHERE stripe_object_id = %s AND kind = %s",
            (expected["stripe_object_id"], expected["kind"]),
        )
        actual = cur.fetchone()
        if not actual:
            mismatches.append(
                f"missing kind={expected['kind']} object={expected['stripe_object_id']}"
            )
            continue
        for field in ("user_id", "amount_cents", "currency", "stripe_charge_id"):
            if actual[field] != expected[field]:
                mismatches.append(
                    f"kind={expected['kind']} object={expected['stripe_object_id']} "
                    f"field={field} ledger={actual[field]!r} stripe={expected[field]!r}"
                )

    cur.execute("SELECT user_id, COALESCE(SUM(amount_cents), 0) AS total FROM payments GROUP BY user_id")
    ledger = {row["user_id"]: row["total"] for row in cur.fetchall()}
    expected = {uid: agg["net_cents"] for uid, agg in stripe_net.items()}
    for uid in sorted(set(ledger) | set(expected)):
        if ledger.get(uid, 0) != expected.get(uid, 0):
            mismatches.append(
                f"user={uid} ledger_sum={ledger.get(uid, 0)} stripe_net={expected.get(uid, 0)}"
            )
    if mismatches:
        raise BackfillSafetyError(
            "post-write verification failed; transaction rolled back:\n  - "
            + "\n  - ".join(mismatches)
        )


def run_backfill(config: dict, write: bool):
    """Validated, atomic, idempotent ledger backfill.

    Stripe and refund pagination complete before a transaction is opened. The
    entire plan then writes and verifies in one transaction, so any exception or
    mismatch rolls back every row from this run.
    """
    import os

    _validate_target(config)
    os.environ["DATABASE_URL"] = config["DATABASE_URL"]
    os.environ.setdefault("APP_ENV", config["APP_ENV"])
    stripe.api_key = config["STRIPE_SECRET_KEY"]

    from app.services import payments_ledger
    from app.services.pg import get_pg, init_pg_pool
    from app.services.revenue_reconciliation import build_stripe_net_by_user, fetch_stripe_intents

    init_pg_pool()
    print(f"Target DB host: {_target_host(config['DATABASE_URL'])}")
    print(f"Mode: {'WRITE' if write else 'DRY RUN'}")

    intents = fetch_stripe_intents()
    print(f"Fetched {len(intents)} PaymentIntents from Stripe.")
    plan = _build_plan(intents)
    counts = {kind: sum(row["kind"] == kind for row in plan)
              for kind in ("purchase", "refund", "dispute_lost")}
    for row in plan:
        print(
            f"  {row['kind']} user={row['user_id']} amount_cents={row['amount_cents']} "
            f"stripe_object_id={row['stripe_object_id']}"
        )
    print("\n--- Validated plan ---")
    print(f"  purchase={counts['purchase']} refund={counts['refund']} "
          f"dispute_lost={counts['dispute_lost']}")
    if not write:
        print(f"Dry run: {len(plan)} validated rows; zero database writes.")
        return

    inserted = {kind: 0 for kind in counts}
    skipped = {kind: 0 for kind in counts}
    charge_ids_filled = 0
    stripe_net = build_stripe_net_by_user(intents)

    with get_pg() as conn:
        cur = conn.cursor()
        _assert_database_guards(cur)
        for row in plan:
            common = dict(
                user_id=row["user_id"], stripe_object_id=row["stripe_object_id"],
                amount_cents=row["amount_cents"], currency=row["currency"],
                stripe_charge_id=row["stripe_charge_id"], occurred_at=row["occurred_at"],
                source="backfill",
            )
            if row["kind"] == "purchase":
                changed = payments_ledger.record_purchase(
                    cur, pack=row["pack"], credits=row["credits"], **common
                )
            elif row["kind"] == "refund":
                changed = payments_ledger.record_refund(cur, **common)
            else:
                changed = payments_ledger.record_dispute_lost(cur, **common)
            inserted[row["kind"]] += int(changed)
            skipped[row["kind"]] += int(not changed)

            if row["kind"] == "purchase" and row["stripe_charge_id"]:
                charge_ids_filled += int(payments_ledger.fill_missing_charge_id(
                    cur, stripe_object_id=row["stripe_object_id"],
                    stripe_charge_id=row["stripe_charge_id"],
                ))

        _verify_rows_and_totals(cur, plan, stripe_net)

    print("\n--- Backfill committed and verified ---")
    for kind in ("purchase", "refund", "dispute_lost"):
        print(f"  {kind}: inserted={inserted[kind]} skipped_existing={skipped[kind]}")
    print(f"  charge_ids_filled={charge_ids_filled}")
    print(f"  Stripe reconciliation: {len(stripe_net)}/{len(stripe_net)} users match.")


def main():
    parser = argparse.ArgumentParser(description="Backfill the append-only payments ledger from live Stripe history.")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--write", action="store_true", default=False, help="Actually insert rows (default: dry run)")
    parser.add_argument(
        "--i-am-the-operator", action="store_true", default=False,
        help="Required alongside --write when --env is staging/prod (operator confirmation).",
    )
    args = parser.parse_args()

    config = load_env(args.env)

    if args.write and args.env != "dev" and not args.i_am_the_operator:
        print(
            f"ERROR: refusing --write against --env {args.env} without "
            "--i-am-the-operator. Target host would have been: "
            f"{_target_host(config['DATABASE_URL'])}"
        )
        sys.exit(1)

    try:
        run_backfill(config, write=args.write)
    except BackfillSafetyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
