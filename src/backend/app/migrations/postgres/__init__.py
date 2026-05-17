from ..base import MigrationRunner
from .v001_baseline import V001Baseline
from .v002_game_ref_counts import V002GameRefCounts
from .v003_annotation_playback_share_type import V003AnnotationPlaybackShareType

MIGRATIONS = [
    V001Baseline(),
    V002GameRefCounts(),
    V003AnnotationPlaybackShareType(),
]

RUNNER = MigrationRunner(MIGRATIONS)
