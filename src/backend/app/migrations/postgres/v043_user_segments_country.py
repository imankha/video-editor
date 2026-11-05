"""
v043 (T15100): `user_segments.country` -- the ISO 3166-1 alpha-2 country the Cloudflare
edge saw for the browser that signed up, sent by the client and validated by
`create_user_segment`. Feeds the admin Channels and Journey country dimensions.

Existing rows stay NULL: no sign-up recorded a country before this change, and a guess
from IP history would be fiction. A country does not identify a person, so account
deletion keeps it (not in `_DEIDENTIFY_SEGMENT_COLUMNS`).

Additive and idempotent. Until this runs, `create_user_segment` probes for the column and
writes the segment without it (logged), so a sign-up never fails.
"""

from ..base import BaseMigration


class V043UserSegmentsCountry(BaseMigration):
    version = 43
    description = "Add user_segments.country (T15100 country dimension)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS country TEXT")
