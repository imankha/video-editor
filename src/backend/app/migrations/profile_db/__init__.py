from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_game_storage import V002GameStorage
from .v003_fix_shared_clip_athletes import V003FixSharedClipAthletes
from .v004_overlay_tuning import V004OverlayTuning
from .v005_highlight_shape import V005HighlightShape
from .v006_backfill_current_mode import V006BackfillCurrentMode

MIGRATIONS = [
    V001Baseline(),
    V002GameStorage(),
    V003FixSharedClipAthletes(),
    V004OverlayTuning(),
    V005HighlightShape(),
    V006BackfillCurrentMode(),
]

RUNNER = MigrationRunner(MIGRATIONS)
