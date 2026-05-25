from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_game_storage import V002GameStorage
from .v003_fix_shared_clip_athletes import V003FixSharedClipAthletes
from .v004_overlay_tuning import V004OverlayTuning

MIGRATIONS = [
    V001Baseline(),
    V002GameStorage(),
    V003FixSharedClipAthletes(),
    V004OverlayTuning(),
]

RUNNER = MigrationRunner(MIGRATIONS)
