"""
v041 (T14180): `ip_rate_events` -- per-IP limits on OTP sends and account
creation, counted in Postgres so they survive a restart and hold across
machines (`app.services.ip_rate_limit`).

Additive and idempotent; `_SCHEMA_DDL` carries the same statements.
"""

from ..base import BaseMigration


class V041IpRateEvents(BaseMigration):
    version = 41
    description = "Add ip_rate_events (T14180 per-IP OTP/signup limits)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            """CREATE TABLE IF NOT EXISTS ip_rate_events (
                   id BIGSERIAL PRIMARY KEY,
                   action TEXT NOT NULL,
                   ip TEXT NOT NULL,
                   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
               )"""
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_ip_rate_events_key ON ip_rate_events(action, ip, created_at)"
        )
