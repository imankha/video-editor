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
from .v022_repoint_orphaned_final_video import V022RepointOrphanedFinalVideo
from .v023_repair_sourceless_active_games import V023RepairSourcelessActiveGames
from .v024_add_poster_filename import V024AddPosterFilename
from .v025_freeze_slowmo_section import V025FreezeSlowmoSection
from .v026_games_shared_by import V026GamesSharedBy
from .v027_working_video_detections_data import V027WorkingVideoDetectionsData
from .v028_export_job_stages import V028ExportJobStages
from .v029_working_clips_rotation import V029WorkingClipsRotation
from .v030_games_source_reference import V030GamesSourceReference
from .v031_reclassify_teammate_clips_to_team import V031ReclassifyTeammateClipsToTeam
from .v032_add_poster_marker_fields import V032AddPosterMarkerFields
from .v033_heal_moved_reel_attribution import V033HealMovedReelAttribution
from .v034_intro_card_library import V034IntroCardLibrary
from .v035_intro_card_subtitle import V035IntroCardSubtitle
from .v036_null_dead_intro_card_title_text import V036NullDeadIntroCardTitleText
from .v038_null_dead_intro_card_text_elements import V038NullDeadIntroCardTextElements
from .v040_backfill_intro_card_default import V040BackfillIntroCardDefault
from .v041_intro_min_duration import V041IntroMinDuration
from .v042_text_overlays_regions import V042TextOverlaysRegions
from .v043_drop_intro_min_duration import V043DropIntroMinDuration
from .v044_working_clips_framing_version import V044WorkingClipsFramingVersion
from .v045_canonicalize_working_clip_segments import V045CanonicalizeWorkingClipSegments
from .v046_working_video_framing_snapshot import V046WorkingVideoFramingSnapshot
from .v047_backfill_game_storage_refs import V047BackfillGameStorageRefs
from .v048_cleanup_sweep_orphan_raw_clips import V048CleanupSweepOrphanRawClips
from .v049_raw_clips_reel_source_window import V049RawClipsReelSourceWindow

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
    V022RepointOrphanedFinalVideo(),
    V023RepairSourcelessActiveGames(),
    V024AddPosterFilename(),
    V025FreezeSlowmoSection(),
    V026GamesSharedBy(),
    V027WorkingVideoDetectionsData(),
    V028ExportJobStages(),
    V029WorkingClipsRotation(),
    V030GamesSourceReference(),
    V031ReclassifyTeammateClipsToTeam(),
    V032AddPosterMarkerFields(),
    V033HealMovedReelAttribution(),
    V034IntroCardLibrary(),
    V035IntroCardSubtitle(),
    V036NullDeadIntroCardTitleText(),
    V038NullDeadIntroCardTextElements(),
    V040BackfillIntroCardDefault(),
    V041IntroMinDuration(),
    V042TextOverlaysRegions(),
    V043DropIntroMinDuration(),
    V044WorkingClipsFramingVersion(),
    V045CanonicalizeWorkingClipSegments(),
    V046WorkingVideoFramingSnapshot(),
    V047BackfillGameStorageRefs(),
    V048CleanupSweepOrphanRawClips(),
    V049RawClipsReelSourceWindow(),
]

RUNNER = MigrationRunner(MIGRATIONS)
