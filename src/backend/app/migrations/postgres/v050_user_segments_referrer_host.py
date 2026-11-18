"""v050 (T16900): `user_segments.referrer_host` -- the normalized external referrer hostname
at sign-up (routers/auth.py validates it through analytics.normalize_referrer_host). The
channel is derived from it on read, so a longer bucket list relabels past sign-ups. Feeds
the admin Campaigns "Referring website" grouping.

Existing rows stay NULL: the host was read once at sign-up and then discarded, so it can
never be recovered. A site is not a person, so account deletion keeps it (not in
_DEIDENTIFY_SEGMENT_COLUMNS).

Additive and idempotent. Until this runs, create_user_segment probes for the column and
writes the segment without it (logged), so a sign-up never fails.
"""

from ..base import BaseMigration


class V050UserSegmentsReferrerHost(BaseMigration):
    version = 50
    description = "Add user_segments.referrer_host (T16900 referring website)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS referrer_host TEXT")
