from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_game_ref_counts import V002GameRefCounts
from .v003_annotation_playback_share_type import V003AnnotationPlaybackShareType
from .v004_referral_graph import V004ReferralGraph
from .v005_user_milestones import V005UserMilestones
from .v006_daily_counters import V006DailyCounters
from .v007_user_flow_events import V007UserFlowEvents
from .v008_bug_reports_table import V008BugReportsTable
from .v009_normalize_analytics import V009NormalizeAnalytics
from .v010_campaign_utm_columns import V010CampaignUtmColumns
from .v011_daily_counters_tracking_gaps import V011DailyCountersTrackingGaps
from .v012_session_duration import V012SessionDuration
from .v013_analytics_indexes import V013AnalyticsIndexes
from .v014_platform_tracking import V014PlatformTracking
from .v015_platform_normalize import V015PlatformNormalize
from .v016_collection_shares import V016CollectionShares
from .v017_referral_inherited_sport import V017ReferralInheritedSport
from .v018_share_sharer_sport import V018ShareSharerSport

MIGRATIONS = [
    V001Baseline(),
    V002GameRefCounts(),
    V003AnnotationPlaybackShareType(),
    V004ReferralGraph(),
    V005UserMilestones(),
    V006DailyCounters(),
    V007UserFlowEvents(),
    V008BugReportsTable(),
    V009NormalizeAnalytics(),
    V010CampaignUtmColumns(),
    V011DailyCountersTrackingGaps(),
    V012SessionDuration(),
    V013AnalyticsIndexes(),
    V014PlatformTracking(),
    V015PlatformNormalize(),
    V016CollectionShares(),
    V017ReferralInheritedSport(),
    V018ShareSharerSport(),
]

RUNNER = MigrationRunner(MIGRATIONS)
