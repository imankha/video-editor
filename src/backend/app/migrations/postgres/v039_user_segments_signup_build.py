"""
v039 (T14000): `user_segments.signup_build` + `signup_commit` -- the deploy build
(`APP_BUILD`) and commit (`APP_VERSION`) the server was running when the account
signed up, stamped server-side by `create_user_segment`. Feeds the admin panel's
Builds dimension (`GET /api/admin/analytics/builds`).

Existing rows stay NULL: the build was not recorded before this change, and a
guessed backfill would be fiction. Neither column identifies a person, so account
deletion keeps them (not in `_DEIDENTIFY_SEGMENT_COLUMNS`).

Additive and idempotent. Until this runs, `create_user_segment` probes for the
column and writes the segment without it (logged), so a signup never fails.
"""

from ..base import BaseMigration


class V039UserSegmentsSignupBuild(BaseMigration):
    version = 39
    description = "Add user_segments.signup_build/signup_commit (T14000 Builds dimension)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS signup_build INTEGER")
        cur.execute("ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS signup_commit TEXT")
