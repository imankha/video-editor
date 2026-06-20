from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_game_storage import V002GameStorage
from .v003_fix_shared_clip_athletes import V003FixSharedClipAthletes
from .v004_overlay_tuning import V004OverlayTuning
from .v005_highlight_shape import V005HighlightShape
from .v006_backfill_current_mode import V006BackfillCurrentMode
from .v007_collection_metadata import V007CollectionMetadata
from .v008_freeze_game_ids import V008FreezeGameIds
from .v009_season_rank import V009SeasonRank
from .v010_ranking_columns import V010RankingColumns
from .v011_drop_game_aggregates import V011DropGameAggregates
from .v012_flip_inverted_clip_ranges import V012FlipInvertedClipRanges
from .v013_auto_export_attempts import V013AutoExportAttempts

MIGRATIONS = [
    V001Baseline(),
    V002GameStorage(),
    V003FixSharedClipAthletes(),
    V004OverlayTuning(),
    V005HighlightShape(),
    V006BackfillCurrentMode(),
    V007CollectionMetadata(),
    V008FreezeGameIds(),
    V009SeasonRank(),
    V010RankingColumns(),
    V011DropGameAggregates(),
    V012FlipInvertedClipRanges(),
    V013AutoExportAttempts(),
]

RUNNER = MigrationRunner(MIGRATIONS)
