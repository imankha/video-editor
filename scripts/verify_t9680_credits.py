"""
T9680 production verification (READ-ONLY): confirm the credits/rounding/retry facts
established from code against real production numbers.

Background
----------
T9680 (docs/plans/tasks/T9680-confirm-credits-retention-required-fields.md) needed the
walkthrough's billing complaints (different free-credit wording, a 6.027s clip charged 7
credits) checked against live production rather than assumed. The code-side mechanism is
fully established (see that task file's Decision Record) - this script confirms the live
numbers behind it. It performs NO writes; the session is opened `readonly=True`.

Usage
-----
Requires a Fly proxy tunnel to prod Postgres (per scripts/fix_storage_refs.py /
scripts/copy_user_between_envs.py's existing convention):

    fly proxy 15433:5432 --app reel-ballers-db-prod

then, from a shell where FLY_ACCESS_TOKEN/`fly auth login` is already set up:

    cd src/backend && .venv/Scripts/python.exe ../../scripts/verify_t9680_credits.py

Prints only derived findings (counts, amounts, timestamps) - never the DATABASE_URL itself,
and only as much user_id/reference_id as needed to spot-check a finding.

Checks
------
1. credits_ready gate status (credit_migration_state.ready_at) - is the cutover gate open?
2. A sample of recent full-signup grants (new_account_bonus + quest_upfront) - do they sum
   to 88 in practice, matching storage_credits.py's NEW_ACCOUNT_CREDITS=8 and
   quest_config.py's QUEST_CHAIN_CREDIT_TOTAL=80?
3. Any framing_usage transaction with video_seconds in [6.0, 6.2] - confirms the
   walkthrough's charge really was a Focus render and its exact amount (expect 7, from
   ceil(6.027)).
3b/3c. framing_usage vs framing_refund volume, and refund-less debits (candidates only, not
   proof of a bug - a successful render has no refund by design).
4. clip_upload_refund recency - is the hourly reconciliation loop (services/cleanup.py)
   actually running on the prod machine?
"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
ENV_FILE = PROJECT_ROOT / ".env.prod"


def load_database_url() -> str:
    if not ENV_FILE.exists():
        print(f"ERROR: {ENV_FILE} not found", file=sys.stderr)
        sys.exit(1)
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.partition("=")[2].strip()
    print("ERROR: DATABASE_URL not found in .env.prod", file=sys.stderr)
    sys.exit(1)


def main():
    import psycopg2
    from psycopg2.extras import RealDictCursor

    conn = psycopg2.connect(load_database_url(), cursor_factory=RealDictCursor)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()

    print("=" * 70)
    print("1. credits_ready gate")
    print("=" * 70)
    cur.execute("SELECT ready_at, backfilled_users FROM credit_migration_state WHERE id = 1")
    print(cur.fetchone())

    print()
    print("=" * 70)
    print("2. Recent full-signup grants (new_account_bonus + quest_upfront, per user)")
    print("=" * 70)
    cur.execute(
        """
        SELECT user_id,
               SUM(amount) FILTER (WHERE idempotency_key LIKE 'signup:%%') AS signup_amt,
               SUM(amount) FILTER (WHERE idempotency_key LIKE 'questbank:%%') AS questbank_amt,
               MIN(created_at) AS first_grant_at
        FROM credit_transactions
        WHERE source IN ('new_account_bonus', 'quest_upfront')
        GROUP BY user_id
        ORDER BY first_grant_at DESC
        LIMIT 10
        """
    )
    for r in cur.fetchall():
        print(dict(r))

    print()
    print("=" * 70)
    print("3. framing_usage charges near 6.0-6.2s (the walkthrough's 6.027s clip)")
    print("=" * 70)
    cur.execute(
        """
        SELECT user_id, amount, video_seconds, reference_id, created_at
        FROM credit_transactions
        WHERE source = 'framing_usage' AND video_seconds BETWEEN 6.0 AND 6.2
        ORDER BY created_at DESC
        LIMIT 20
        """
    )
    hits = cur.fetchall()
    for r in hits:
        print(dict(r))
    if not hits:
        print("(none found in this window)")

    print()
    print("=" * 70)
    print("3b. framing_usage debits vs framing_refund credits (last 30 days, aggregate)")
    print("=" * 70)
    cur.execute(
        """
        SELECT source, COUNT(*) AS n, SUM(amount) AS total_amount
        FROM credit_transactions
        WHERE source IN ('framing_usage', 'framing_refund')
          AND created_at > now() - interval '30 days'
        GROUP BY source
        """
    )
    for r in cur.fetchall():
        print(dict(r))

    print()
    print("=" * 70)
    print("3c. framing_usage debits with no matching framing_refund idempotency key")
    print("    (candidates only - NOT proof of a bug; a successful render has no refund)")
    print("=" * 70)
    cur.execute(
        """
        SELECT d.user_id, d.reference_id AS export_id, d.amount, d.video_seconds, d.created_at
        FROM credit_transactions d
        WHERE d.source = 'framing_usage'
          AND d.created_at > now() - interval '30 days'
          AND NOT EXISTS (
              SELECT 1 FROM credit_transactions r
              WHERE r.source = 'framing_refund'
                AND r.idempotency_key = 'refund:' || d.reference_id
          )
        ORDER BY d.created_at DESC
        LIMIT 10
        """
    )
    for r in cur.fetchall():
        print(dict(r))

    print()
    print("=" * 70)
    print("4. clip_upload_refund evidence (hourly reconciliation loop liveness)")
    print("=" * 70)
    cur.execute(
        """
        SELECT COUNT(*) AS n, MAX(created_at) AS most_recent
        FROM credit_transactions
        WHERE source = 'clip_upload_refund'
        """
    )
    print(dict(cur.fetchone()))

    cur.close()
    conn.close()
    print()
    print("Done. Read-only session, no writes issued.")


if __name__ == "__main__":
    main()
