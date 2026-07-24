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

    calls = {"synced": [], "pending": [], "granted": [], "set": [], "refreshed": []}

    monkeypatch.setattr(m, "_require_admin", lambda: None)
    monkeypatch.setattr(m, "get_user_by_id", lambda uid: {"user_id": uid})
    # Reading the authoritative copy first is covered by its own test; keep it
    # inert here so these assertions are about the write-back only.
    monkeypatch.setattr(m, "_refresh_target_user_db", lambda uid: calls["refreshed"].append(uid))

    def _grant(uid, amount, source, reference_id=None):
        calls["granted"].append((uid, amount))
        return 400 + amount

    monkeypatch.setattr(m, "grant_credits", _grant)

    def _sync(uid, lock_timeout=None):
        calls["synced"].append(uid)
        if uid in calls.get("sync_raises", ()):
            raise RuntimeError("boom")
        return uid not in calls.get("sync_fails", ())

    # Patch BOTH the source module and the router's binding. Patching only the
    # router would let a version that imports the symbol but never calls it pass;
    # this way the red lands on the assertion, not on fixture setup.
    monkeypatch.setattr("app.database.sync_user_db_to_r2_explicit", _sync)
    monkeypatch.setattr(m, "sync_user_db_to_r2_explicit", _sync, raising=False)
    monkeypatch.setattr("app.database.mark_sync_pending", lambda uid: None)
    monkeypatch.setattr(
        m, "mark_sync_pending", lambda uid: calls["pending"].append(uid), raising=False
    )
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
        calls["sync_fails"] = {TARGET_ID}

        resp = await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400))

        assert resp["balance"] == 800, "credits were still granted locally"
        assert resp["synced"] is False
        assert calls["pending"] == [TARGET_ID]

    @pytest.mark.asyncio
    async def test_reads_authoritative_copy_before_granting(self, admin_stub):
        """Refresh must happen BEFORE the grant, else we mutate a stale snapshot
        and force-push it over the grantee's newer state."""
        m, calls = admin_stub
        order = []
        m_refresh = m._refresh_target_user_db
        monkey_grant = m.grant_credits

        def _refresh(uid):
            order.append("refresh")
            return m_refresh(uid)

        def _grant(uid, amount, source, reference_id=None):
            order.append("grant")
            return monkey_grant(uid, amount, source, reference_id)

        m._refresh_target_user_db = _refresh
        m.grant_credits = _grant
        try:
            await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400))
        finally:
            m._refresh_target_user_db = m_refresh
            m.grant_credits = monkey_grant

        assert order == ["refresh", "grant"]
        assert calls["refreshed"] == [TARGET_ID]

    @pytest.mark.asyncio
    async def test_sync_runs_after_the_grant_commits(self, admin_stub):
        """The upload must push an already-committed DB, never precede it."""
        m, calls = admin_stub
        order = []
        real_grant = m.grant_credits

        def _grant(uid, amount, source, reference_id=None):
            order.append("grant")
            return real_grant(uid, amount, source, reference_id)

        m.grant_credits = _grant
        try:
            await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400))
        finally:
            m.grant_credits = real_grant

        assert order == ["grant"]
        assert calls["synced"] == [TARGET_ID]


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

    @pytest.mark.asyncio
    async def test_sync_failure_does_not_mark_the_grant_failed(self, admin_stub):
        """A committed grant whose upload failed must stay ok=True.

        Flipping it to ok=False makes the admin re-run the batch, and since
        admin_grant writes reference_id=NULL (distinct under the UNIQUE index)
        the second run double-grants.
        """
        m, calls = admin_stub
        calls["sync_fails"] = {"u2"}

        resp = await m.admin_bulk_grant_credits(
            m.BulkGrantCreditsRequest(user_ids=["u1", "u2"], amount=10)
        )

        by_id = {r["user_id"]: r for r in resp["results"]}
        assert by_id["u2"]["ok"] is True, "credits were committed -- must not read as failed"
        assert by_id["u2"]["synced"] is False
        assert resp["granted"] == 2
        assert resp["failed"] == 0

    @pytest.mark.asyncio
    async def test_sync_exception_does_not_mark_the_grant_failed(self, admin_stub):
        """Same guarantee when the upload RAISES rather than returning False."""
        m, calls = admin_stub
        calls["sync_raises"] = {"u2"}

        resp = await m.admin_bulk_grant_credits(
            m.BulkGrantCreditsRequest(user_ids=["u1", "u2"], amount=10)
        )

        by_id = {r["user_id"]: r for r in resp["results"]}
        assert by_id["u2"]["ok"] is True
        assert by_id["u2"]["synced"] is False
        assert resp["failed"] == 0
