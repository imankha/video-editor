"""Admin credit writes must sync the TARGET user's user.sqlite to R2.

Prod incident (2026-07-24): an admin granted 400 credits to another user. The
grant committed to that user's user.sqlite on the machine's local disk, but the
request middleware only syncs the SESSION user's databases (the admin's), so the
grant never reached R2. The next deploy replaced the machine; the fresh volume
restored the grantee's user.sqlite from R2 -- which had never seen the +400 --
and the credits silently vanished.

The Stripe webhook got this exact fix in T4940 (it is auth-allowlisted, so it
also skips the middleware sync, and calls sync_user_db_to_r2_explicit itself).
The admin write paths that target a user OTHER than the caller need the same.

Guards: the sync is called with the GRANTEE's id (never the admin's), and a
failed sync is surfaced + marked sync-pending rather than silently swallowed.
"""

import pytest

ADMIN_ID = "admin-user-id"
TARGET_ID = "grantee-user-id"


@pytest.fixture
def admin_stub(monkeypatch):
    """Neutralise auth/db, and record R2-sync + sync-pending calls."""
    from app.routers import admin as m

    calls = {"synced": [], "pending": [], "granted": [], "set": []}

    monkeypatch.setattr(m, "_require_admin", lambda: None)
    monkeypatch.setattr(m, "get_user_by_id", lambda uid: {"user_id": uid})
    monkeypatch.setattr(m, "get_current_user_id", lambda: ADMIN_ID)

    def _grant(uid, amount, source=None, reference_id=None):
        calls["granted"].append((uid, amount))
        return 400 + amount

    monkeypatch.setattr(m, "grant_credits", _grant)

    def _sync(uid, lock_timeout=None):
        calls["synced"].append(uid)
        return calls.get("sync_result", True)

    monkeypatch.setattr(m, "sync_user_db_to_r2_explicit", _sync)
    monkeypatch.setattr(m, "mark_sync_pending", lambda uid: calls["pending"].append(uid))
    return m, calls


class TestSingleGrant:

    @pytest.mark.asyncio
    async def test_grant_syncs_grantee_not_admin(self, admin_stub):
        """The R2 sync must target the GRANTEE -- syncing the admin loses the grant."""
        m, calls = admin_stub

        resp = await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400))

        assert calls["granted"] == [(TARGET_ID, 400)]
        assert calls["synced"] == [TARGET_ID], (
            f"expected user.sqlite sync for grantee {TARGET_ID}, got {calls['synced']}"
        )
        assert ADMIN_ID not in calls["synced"]
        assert resp["balance"] == 800
        assert resp["synced"] is True

    @pytest.mark.asyncio
    async def test_sync_failure_is_surfaced_and_marked_pending(self, admin_stub):
        """A failed upload must not be silent: report synced=False + mark pending.

        Not a 5xx on purpose -- admin_grant has no idempotency key, so a client
        retry would double-grant. The sync-pending marker makes the middleware
        retry the upload on the grantee's next write instead.
        """
        m, calls = admin_stub
        calls["sync_result"] = False

        resp = await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400))

        assert resp["balance"] == 800, "credits were still granted locally"
        assert resp["synced"] is False
        assert calls["pending"] == [TARGET_ID]


class TestSetCredits:

    @pytest.mark.asyncio
    async def test_set_credits_syncs_target(self, admin_stub, monkeypatch):
        m, calls = admin_stub
        from app.services import user_db
        monkeypatch.setattr(user_db, "set_credits", lambda uid, amount: amount)

        resp = await m.admin_set_credits(TARGET_ID, m.SetCreditsRequest(amount=25))

        assert calls["synced"] == [TARGET_ID]
        assert resp["balance"] == 25
        assert resp["synced"] is True


class TestBulkGrant:

    @pytest.mark.asyncio
    async def test_bulk_grant_syncs_every_target(self, admin_stub):
        """Each grantee needs its own upload -- one sync for the batch loses the rest."""
        m, calls = admin_stub
        uids = ["u1", "u2", "u3"]

        resp = await m.admin_bulk_grant_credits(
            m.BulkGrantCreditsRequest(user_ids=uids, amount=10)
        )

        assert calls["synced"] == uids
        assert resp["granted"] == 3
        assert all(r["synced"] is True for r in resp["results"])
