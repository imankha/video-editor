from ..base import NoOpMigration


class V001Baseline(NoOpMigration):
    version = 1
    description = "Baseline: mark Postgres schema as migrated"
