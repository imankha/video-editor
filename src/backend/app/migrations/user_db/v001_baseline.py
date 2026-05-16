from ..base import NoOpMigration


class V001Baseline(NoOpMigration):
    version = 1
    description = "Baseline: mark user.sqlite as migrated"
