from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_game_ref_counts import V002GameRefCounts

MIGRATIONS = [
    V001Baseline(),
    V002GameRefCounts(),
]

RUNNER = MigrationRunner(MIGRATIONS)
