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

    def get_pending(self, conn, db_type: str) -> list[BaseMigration]:
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
