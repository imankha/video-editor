"""
v038 (T13980): `campaigns` -- admin-created attribution campaigns.

`id` is the short code carried in the link (`/?ref=<id>`) and stored verbatim in
`user_segments.origin` when a signup's attribution fields carry it; `name` is
the text the admin typed and the only thing the admin UI displays. Names are
unique case-insensitively so two campaigns never display identically. No delete
path exists: removing a row would turn attributed users back into an opaque code.

Additive and idempotent. Until this runs, `_determine_origin` treats the missing
table as "no registry match" (logged) and never fails a signup.
"""

from ..base import BaseMigration


class V038Campaigns(BaseMigration):
    version = 38
    description = "Add campaigns table (T13980 admin-created attribution campaigns)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS campaigns (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_name_lower ON campaigns (lower(name))"
        )
