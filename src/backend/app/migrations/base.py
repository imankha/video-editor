import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


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
    def __init__(self, migrations: list[BaseMigration]):
        self.migrations = sorted(migrations, key=lambda m: m.version)
        self.latest_version = migrations[-1].version if migrations else 0

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

    def run(self, conn, db_type: str) -> list[BaseMigration]:
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
