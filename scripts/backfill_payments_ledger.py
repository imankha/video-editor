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

import stripe

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))

# Terminal-lost dispute statuses (mirrors revenue_reconciliation.LOST_DISPUTE_STATUSES).
LOST_DISPUTE_STATUSES = frozenset({"lost", "charge_refunded"})


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
    """Yield (re_id, amount) for every individual refund on a charge with a
    nonzero cumulative amount_refunded. Retrieves the refund list explicitly --
    `fetch_stripe_intents`'s expand does not include the per-refund list."""
    if not charge or (charge.get("amount_refunded", 0) or 0) <= 0:
        return
    charge_id = charge.get("id")
    if not charge_id:
        return
    refund_list = stripe.Refund.list(charge=charge_id)
    for refund in refund_list.auto_paging_iter():
        amount = refund.get("amount", 0) or 0
        refund_id = refund.get("id")
        if refund_id and amount > 0:
            yield refund_id, amount


def _iso(created_epoch):
    from datetime import UTC, datetime

    return datetime.fromtimestamp(created_epoch, tz=UTC)


def run_backfill(config: dict, write: bool):
    sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))
    import os

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

    inserted = {"purchase": 0, "refund": 0, "dispute_lost": 0}
    skipped = {"purchase": 0, "refund": 0, "dispute_lost": 0}
    charge_ids_filled = 0
    would_be_rows = []

    for pi in intents:
        if pi.get("status") != "succeeded":
            continue

        meta = pi.get("metadata") or {}
        user_id = meta.get("user_id")
        pi_id = pi["id"]
        if not user_id:
            print(f"  SKIP purchase pi={pi_id}: no metadata.user_id, cannot key a row")
            continue

        amount_cents = pi.get("amount_received", 0) or 0
        charge = _charge_of(pi)
        charge_id = charge.get("id") if charge else None
        occurred_at = _iso(pi.get("created") or 0)
        pack = meta.get("pack")
        credits = int(meta["credits"]) if meta.get("credits") else None

        would_be_rows.append(("purchase", user_id, amount_cents, pi_id))

        if write:
            with get_pg() as conn:
                cur = conn.cursor()
                did_insert = payments_ledger.record_purchase(
                    cur, user_id=user_id, stripe_object_id=pi_id,
                    amount_cents=amount_cents, currency=pi.get("currency") or "usd",
                    stripe_charge_id=charge_id, pack=pack, credits=credits,
                    occurred_at=occurred_at, source="backfill",
                )
            inserted["purchase"] += 1 if did_insert else 0
            skipped["purchase"] += 0 if did_insert else 1
        else:
            print(f"  purchase kind=purchase user={user_id} amount_cents={amount_cents} stripe_object_id={pi_id}")

        # Refund rows (one per individual re_... id).
        for refund_id, refund_amount in _refund_rows(charge):
            would_be_rows.append(("refund", user_id, -refund_amount, refund_id))
            if write:
                with get_pg() as conn:
                    cur = conn.cursor()
                    did_insert = payments_ledger.record_refund(
                        cur, user_id=user_id, stripe_object_id=refund_id,
                        amount_cents=-refund_amount, currency=pi.get("currency") or "usd",
                        stripe_charge_id=charge_id, occurred_at=occurred_at, source="backfill",
                    )
                inserted["refund"] += 1 if did_insert else 0
                skipped["refund"] += 0 if did_insert else 1
            else:
                print(f"  refund kind=refund user={user_id} amount_cents={-refund_amount} stripe_object_id={refund_id}")

        # Terminal-lost dispute row.
        dispute_row = _dispute_lost_row(pi, charge)
        if dispute_row:
            dp_id, dp_amount = dispute_row
            would_be_rows.append(("dispute_lost", user_id, -dp_amount, dp_id))
            if write:
                with get_pg() as conn:
                    cur = conn.cursor()
                    did_insert = payments_ledger.record_dispute_lost(
                        cur, user_id=user_id, stripe_object_id=dp_id,
                        amount_cents=-dp_amount, currency=pi.get("currency") or "usd",
                        stripe_charge_id=charge_id, occurred_at=occurred_at, source="backfill",
                    )
                inserted["dispute_lost"] += 1 if did_insert else 0
                skipped["dispute_lost"] += 0 if did_insert else 1
            else:
                print(f"  dispute_lost kind=dispute_lost user={user_id} amount_cents={-dp_amount} stripe_object_id={dp_id}")

        # Charge-id completion pass: fill NULL stripe_charge_id using the
        # already-expanded latest_charge.id (no extra Stripe call).
        if charge_id and write:
            with get_pg() as conn:
                cur = conn.cursor()
                if payments_ledger.fill_missing_charge_id(
                    cur, stripe_object_id=pi_id, stripe_charge_id=charge_id,
                ):
                    charge_ids_filled += 1
        elif charge_id:
            would_be_rows.append(("fill_charge_id", user_id, 0, pi_id))

    if write:
        print("\n--- Backfill summary ---")
        for kind in ("purchase", "refund", "dispute_lost"):
            print(f"  {kind}: inserted={inserted[kind]} skipped_existing={skipped[kind]}")
        print(f"  charge_ids_filled={charge_ids_filled}")

        stripe_net = build_stripe_net_by_user(intents)
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT user_id, COALESCE(SUM(amount_cents), 0) AS total FROM payments GROUP BY user_id")
            ledger_sums = {row["user_id"]: row["total"] for row in cur.fetchall()}
        mismatches = 0
        for uid, agg in stripe_net.items():
            ledger_sum = ledger_sums.get(uid, 0)
            if ledger_sum != agg["net_cents"]:
                mismatches += 1
                print(f"  MISMATCH user={uid}: ledger_sum={ledger_sum} stripe_net={agg['net_cents']}")
        print(f"  Sanity check: {len(stripe_net) - mismatches}/{len(stripe_net)} users match Stripe net.")
    else:
        print(f"\nDry run: {len(would_be_rows)} would-be rows/fills listed above. Pass --write to insert.")


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

    run_backfill(config, write=args.write)


if __name__ == "__main__":
    main()
