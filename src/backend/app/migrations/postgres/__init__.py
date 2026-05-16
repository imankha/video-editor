from ..base import MigrationRunner
from .v001_baseline import V001Baseline

MIGRATIONS = [
    V001Baseline(),
]

RUNNER = MigrationRunner(MIGRATIONS)
