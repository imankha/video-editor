"""T12900: reset_all_accounts must keep the staging-gate alias fixture accounts."""
import unittest

import reset_all_accounts as r


class GateFixtureProtection(unittest.TestCase):
    def test_protected_ids_are_the_gate_aliases_only(self):
        emails = {
            "u1": "imankh@gmail.com",
            "u2": "e2e-gate@test.local",
            "u3": "e2e-gate2@test.local",
            "u4": "e2e@test.local",
        }
        self.assertEqual(r.protected_user_ids(emails), {"u2", "u3"})

    def test_users_table_delete_spares_protected(self):
        sql, params = r.pg_clear_statement("users", {"u2", "u3"})
        self.assertIn("user_id <> ALL", sql)
        self.assertEqual(sorted(params[0]), ["u2", "u3"])

    def test_sharer_keyed_table_uses_its_own_column(self):
        sql, _ = r.pg_clear_statement("shares", {"u2"})
        self.assertIn("sharer_user_id <> ALL", sql)

    def test_table_without_owner_column_is_not_cleared_when_protecting(self):
        self.assertIsNone(r.pg_clear_statement("r2_grace_deletions", {"u2"}))

    def test_nothing_protected_clears_whole_table(self):
        self.assertEqual(r.pg_clear_statement("users", set()), ("DELETE FROM users", ()))


if __name__ == "__main__":
    unittest.main()
