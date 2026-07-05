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
from .v014_collapse_duplicate_keyframes import V014CollapseDuplicateKeyframes
from .v015_add_last_playhead_position import V015AddLastPlayheadPosition
from .v016_clip_game_start_time import V016ClipGameStartTime
from .v017_backfill_missing_storage_refs import V017BackfillMissingStorageRefs
from .v018_heal_lost_publish_proj41 import V018HealLostPublishProj41
from .v019_heal_sweep_reel_metadata import V019HealSweepReelMetadata
from .v020_archive_published_auto_projects import V020ArchivePublishedAutoProjects
from .v021_unpublish_unframed_sweep_reels import V021UnpublishUnframedSweepReels

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
    V014CollapseDuplicateKeyframes(),
    V015AddLastPlayheadPosition(),
    V016ClipGameStartTime(),
    V017BackfillMissingStorageRefs(),
    V018HealLostPublishProj41(),
    V019HealSweepReelMetadata(),
    V020ArchivePublishedAutoProjects(),
    V021UnpublishUnframedSweepReels(),
]

RUNNER = MigrationRunner(MIGRATIONS)
