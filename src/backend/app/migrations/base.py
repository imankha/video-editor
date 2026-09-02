import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class BelowMigrationFloor(Exception):
    """A DB's schema version is BELOW the hard floor (T5089): the migrations
    that would lift it to head have been PRUNED and no longer exist, so it
    cannot be upgraded at all. This is UNRECOVERABLE by the serving process —
    deliberately DISTINCT from ``MigrationBlocked`` (retryable 503): retrying a
    below-floor DB can never succeed, so it must NOT be funneled into the
    ``pending_migration`` retry path (that would loop forever). It surfaces as a
    loud, non-retryable failure (CRITICAL log + HTTP 500 ``schema_below_floor``);
    the operator hand-recovers the account (restore from backup / bespoke
    migrate). Applies to the SQLite tracks only — postgres is exempt (§ _check_floor).
    """

    def __init__(self, db_type: str, current: int, floor: int):
        self.db_type = db_type
        self.current = current
        self.floor = floor
        super().__init__(
            f"{db_type} DB at schema v{current:03d} is below the pruned-migration "
            f"floor v{floor:03d}; the migrations to upgrade it were deleted"
        )


class BaseMigration(ABC):
    version: int
    description: str

    @abstractmethod
    def up(self, conn) -> None:
        pass


class NoOpMigration(BaseMigration):
    def up(self, conn) -> None:
        pass


class MigrationRunner:
    def __init__(self, migrations: list[BaseMigration], floor: int = 0):
        self.migrations = sorted(migrations, key=lambda m: m.version)
        self.latest_version = migrations[-1].version if migrations else 0
        # T5089: hard floor. A DB whose schema version is below `floor` has had
        # the migrations needed to lift it PRUNED, so it must be refused loudly
        # rather than partially upgraded onto a schema those deleted migrations
        # never expected. floor=0 (default) = inert: no DB can be below v0, so
        # the gate never fires until a real floor is configured after the
        # cross-env floor sweep proves it (see T5089 task file).
        self.floor = floor

    def get_current_version(self, conn, db_type: str) -> int:
        if db_type == "postgres":
            cur = conn.cursor()
            cur.execute("SELECT MAX(version) FROM schema_migrations")
            row = cur.fetchone()
            if row is None:
                return 0
            max_val = row[0] if isinstance(row, tuple) else row.get("max")
            return max_val or 0
        else:
            return conn.execute("PRAGMA user_version").fetchone()[0]

    def get_applied_versions(self, conn) -> set[int]:
        """Postgres only: the SET of every version present in schema_migrations.

        Pending is computed as 'registered version NOT IN this set', NOT
        'version > MAX(applied)'. A migration numbered BELOW an already-applied
        version — branches merging out of numeric order, e.g. T5770's v022
        landing before v020/v021 were merged — must still be applied. A MAX
        comparison skips it silently and permanently (no error, no log), while
        run_all_migrations() reports success (T6345). schema_migrations is a
        per-version ledger (one row per applied migration), so it can express a
        gap; the PRAGMA user_version tracks cannot.
        """
        cur = conn.cursor()
        cur.execute("SELECT version FROM schema_migrations")
        applied: set[int] = set()
        for row in cur.fetchall():
            version = row[0] if isinstance(row, tuple) else row.get("version")
            if version is not None:
                applied.add(version)
        return applied

    def get_pending(self, conn, db_type: str) -> list[BaseMigration]:
        if db_type == "postgres":
            # Set membership, not MAX(version): a version numbered below the max
            # but absent from the ledger (out-of-order branch merges) must still
            # be applied. self.migrations is sorted ascending in __init__, so the
            # pending list stays ascending for deterministic apply order (T6345).
            applied = self.get_applied_versions(conn)
            return [m for m in self.migrations if m.version not in applied]
        # SQLite tracks (user_db / profile_db) hold a single PRAGMA user_version
        # integer that CANNOT express a gap on disk, so '> current' is correct
        # here. Assessed for the same silent-skip shape (T6345): a migration
        # numbered BELOW the stored user_version — a merge landing a lower number
        # — is <= current and never runs, but there is no per-version ledger to
        # diff against, so no set test can recover it. That is a numbering-
        # discipline hazard (never renumber below an applied version), not a
        # runner bug; the postgres ledger fix above does not translate here.
        current = self.get_current_version(conn, db_type)
        return [m for m in self.migrations if m.version > current]

    def _check_floor(self, conn, db_type: str) -> None:
        """T5089: refuse a below-floor DB LOUDLY before applying anything.

        Placed in `run()` (the single mutating entry point), NOT in
        `get_pending` — the read-only status probes call `get_pending`, and a
        status query must never raise. This is the one bypass-proof choke point:
        every seam primitive and `migrate_postgres` funnels through `run`.

        Postgres is EXEMPT: a fresh postgres DB runs `_SCHEMA_DDL` (head) but
        leaves `schema_migrations` EMPTY, so `get_current_version` returns 0 —
        a nonzero postgres floor would refuse every fresh deploy. Postgres is
        also one shared, deploy-migrated DB per env with no lazy per-user long
        tail, so a below-floor postgres DB is an operational impossibility, not
        a population to guard. floor stays 0 for PG_RUNNER forever; this early
        return is belt-and-suspenders so even a mistaken nonzero pg floor can't
        brick a deploy.
        """
        if self.floor <= 0 or db_type == "postgres":
            return
        current = self.get_current_version(conn, db_type)
        if current < self.floor:
            logger.critical(
                "[Migration] BELOW-FLOOR REFUSAL: %s DB at v%03d < floor v%03d — "
                "migration history pruned, cannot upgrade; refusing access",
                db_type, current, self.floor,
            )
            raise BelowMigrationFloor(db_type, current, self.floor)

    def run(self, conn, db_type: str) -> list[BaseMigration]:
        self._check_floor(conn, db_type)
        pending = self.get_pending(conn, db_type)
        for migration in pending:
            logger.info(f"[Migration] Applying v{migration.version:03d}: {migration.description} ({db_type})")
            migration.up(conn)
            if db_type == "postgres":
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO schema_migrations (version, description) VALUES (%s, %s)",
                    (migration.version, migration.description),
                )
            else:
                conn.execute(f"PRAGMA user_version = {migration.version}")
        if db_type != "postgres" and pending:
            conn.commit()
        return pending
