from ..base import BaseMigration

# T8110: the seven known internal/test accounts on prod (dev, admin, seed). A
# missing email on an environment (staging/dev have their own test accounts) is a
# no-op, not an error -- the UPDATE simply matches zero rows there. New test
# accounts are flagged from the admin UI afterwards, never by another deploy.
_SEED_TEST_EMAILS = [
    "spampoopers@gmail.com",
    "imankh@gmail.com",
    "sarkarati@gmail.com",
    "hello@reelballers.com",
    "drewsoccerati@gmail.com",
    "themaryam14@gmail.com",
    "iman@launchitlabs.io",
]


class V026TestAccountFlag(BaseMigration):
    version = 26
    description = (
        "T8110: add users.is_test_account flag (seed the 7 known internal "
        "accounts)"
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "is_test_account BOOLEAN NOT NULL DEFAULT false"
        )
        # Seed the known internal accounts. ANY(%s) matches by email; emails
        # absent on this env match nothing (documented no-op, not an error).
        cur.execute(
            "UPDATE users SET is_test_account = true WHERE email = ANY(%s)",
            (_SEED_TEST_EMAILS,),
        )
        # No covering index here -- EXPLAIN ANALYZE at realistic scale (see
        # pg.py's _SCHEMA_DDL note above the user_actions table) showed a plain
        # seq scan is already cheap (~7ms/40k rows/5k users) for this unfiltered
        # whole-table GROUP BY; an index would only add write amplification.
