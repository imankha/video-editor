from ..base import BaseMigration


class V034ReconciliationAlertRuns(BaseMigration):
    """T8670 round 2: a single-row marker recording when the scheduled
    reconciliation drift-alert pass last completed.

    The advisory lock alone only prevents two passes that overlap IN TIME from
    both running. Two Fly machines (or one machine restarted) each start their
    own startup-delay-then-weekly timer, so two passes that never overlap can
    each acquire the lock in turn, each see the same drift, and each alert. The
    acceptance criterion is "once per deploy, not once per machine", so a
    PERSISTED last-run marker de-duplicates across non-overlapping passes: inside
    the same lock-held critical section the pass reads last_run_at and skips if it
    is less than one interval old, otherwise runs and upserts last_run_at.

    A persisted marker is used instead of holding a lock connection open for the
    process lifetime -- that would permanently consume one of only 10 pool
    connections for a once-a-week job.

    Single row (id = 1, CHECK-enforced): this is bookkeeping about the ALERT JOB
    itself, not revenue data. Idempotent (CREATE TABLE IF NOT EXISTS); mirrored
    in pg.py _SCHEMA_DDL.
    """

    version = 34
    description = (
        "T8670 r2: reconciliation_alert_runs single-row last-run marker so the "
        "scheduled drift alert cannot double-fire across non-overlapping passes"
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS reconciliation_alert_runs (
                id          SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                last_run_at TIMESTAMPTZ NOT NULL
            )
        """)
