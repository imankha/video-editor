from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_user_activity import V002UserActivity
from .v003_action_log import V003ActionLog

MIGRATIONS = [
    V001Baseline(),
    V002UserActivity(),
    V003ActionLog(),
]

RUNNER = MigrationRunner(MIGRATIONS)
