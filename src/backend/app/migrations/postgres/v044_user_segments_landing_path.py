"""v044 (T15010): `user_segments.landing_path` -- the landing page (app-relative pathname)
that first brought the visit, relayed by the landing's attribution.ts as `lp=` and
validated by routers/auth.py before create_user_segment writes it. Feeds the admin step
inspector's "landing_path" breakdown and the user detail panel.

Existing rows stay NULL: no sign-up recorded a landing page before this change. A page
class does not identify a person, so account deletion keeps it (not in
_DEIDENTIFY_SEGMENT_COLUMNS).

Additive and idempotent. Until this runs, create_user_segment probes for the column and
writes the segment without it (logged), so a sign-up never fails.
"""

from ..base import BaseMigration


class V044UserSegmentsLandingPath(BaseMigration):
    version = 44
    description = "Add user_segments.landing_path (T15010 landing page dimension)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS landing_path TEXT")
