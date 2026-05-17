from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_game_storage import V002GameStorage

MIGRATIONS = [
    V001Baseline(),
    V002GameStorage(),
]

RUNNER = MigrationRunner(MIGRATIONS)
