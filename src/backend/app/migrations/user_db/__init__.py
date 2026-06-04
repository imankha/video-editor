from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_user_activity import V002UserActivity
from .v003_action_log import V003ActionLog
from .v004_session_duration import V004SessionDuration

MIGRATIONS = [
    V001Baseline(),
    V002UserActivity(),
    V003ActionLog(),
    V004SessionDuration(),
]

RUNNER = MigrationRunner(MIGRATIONS)
