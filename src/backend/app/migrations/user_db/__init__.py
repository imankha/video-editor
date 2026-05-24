from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_user_activity import V002UserActivity

MIGRATIONS = [
    V001Baseline(),
    V002UserActivity(),
]

RUNNER = MigrationRunner(MIGRATIONS)
