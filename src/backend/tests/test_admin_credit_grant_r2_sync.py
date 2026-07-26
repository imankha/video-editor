"""Admin credit grants commit directly to Postgres -- no more per-user R2 sync (T5840).

Superseded incident context: a prod admin grant (2026-07-24) lived only on a
machine's local user.sqlite and was destroyed by a deploy, because the grant had
no idempotency key and the R2 upload of the GRANTEE's file (not the admin's) was
a separate, fallible step. T5840 removes that whole failure class: credits move
to Postgres, every grant/set carries a real idempotency key under a UNIQUE
constraint, and the write commits durably inside the SAME request -- there is no
more separate "grant committed but not synced" state, so this test module now
asserts NO R2 sync is attempted and that retries are idempotent.
"""

import pytest

ADMIN_ID = "admin-user-id"
TARGET_ID = "grantee-user-id"


@pytest.fixture
def admin_stub(monkeypatch):
    """Neutralise auth/db and record credit_ledger calls -- no R2 involved."""
    from app.routers import admin as m

    calls = {"grant": [], "set_balance": []}

    monkeypatch.setattr(m, "_require_admin", lambda: None)
    monkeypatch.setattr(m, "get_user_by_id", lambda uid: {"user_id": uid})
    monkeypatch.setattr(m, "get_current_user_id", lambda: ADMIN_ID)

    def _grant(user_id, amount, source, key):
        calls["grant"].append((user_id, amount, source, key))
        return {"applied": True, "balance": 400 + amount}

    def _set_balance(user_id, amount, key, reference_id=None):
        calls["set_balance"].append((user_id, amount, key))
        return {"applied": True, "balance": amount, "delta": amount}

    monkeypatch.setattr(m.credit_ledger, "grant", _grant)
    monkeypatch.setattr(m.credit_ledger, "set_balance", _set_balance)

    return m, calls


class TestSingleGrant:

    @pytest.mark.asyncio
    async def test_grant_hits_postgres_with_admin_scoped_key(self, admin_stub):
        """No R2 involved -- the grant is a single Postgres call keyed on
        (admin, request_id), never the grantee's file."""
        m, calls = admin_stub

        resp = await m.admin_grant_credits(
            TARGET_ID, m.GrantCreditsRequest(amount=400, request_id="req-1")
        )

        assert calls["grant"] == [(TARGET_ID, 400, "admin_grant", f"admin:{ADMIN_ID}:req-1")]
        assert resp == {"balance": 800, "applied": True}
        assert "synced" not in resp, "T5840: there is no more R2 sync field to report"

    @pytest.mark.asyncio
    async def test_retry_with_same_request_id_does_not_double_grant(self, admin_stub):
        """A retried request_id is a structural no-op at the ledger layer
        (applied=False) -- this test pins that admin.py passes the SAME key
        both times, letting credit_ledger's UNIQUE constraint do the work."""
        m, calls = admin_stub

        await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400, request_id="req-2"))
        await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400, request_id="req-2"))

        keys = [c[3] for c in calls["grant"]]
        assert keys == [f"admin:{ADMIN_ID}:req-2", f"admin:{ADMIN_ID}:req-2"]

    @pytest.mark.asyncio
    async def test_credits_unavailable_maps_to_503(self, admin_stub):
        """The cutover gate closed -> 503, retryable, never a silent partial grant."""
        from fastapi import HTTPException

        m, calls = admin_stub

        def _raise(*a, **k):
            raise m.CreditsUnavailable("gate closed")

        m.credit_ledger.grant = _raise

        with pytest.raises(HTTPException) as exc:
            await m.admin_grant_credits(TARGET_ID, m.GrantCreditsRequest(amount=400, request_id="req-3"))
        assert exc.value.status_code == 503


class TestSetCredits:

    @pytest.mark.asyncio
    async def test_set_credits_hits_postgres_with_adminset_key(self, admin_stub):
        m, calls = admin_stub

        resp = await m.admin_set_credits(
            TARGET_ID, m.SetCreditsRequest(amount=25, request_id="req-4")
        )

        assert calls["set_balance"] == [(TARGET_ID, 25, f"adminset:{ADMIN_ID}:req-4")]
        assert resp == {"balance": 25, "applied": True}


class TestBulkGrant:

    @pytest.mark.asyncio
    async def test_bulk_grant_keys_each_target_uniquely(self, admin_stub):
        """Each grantee gets its own key (admin, batch, target) -- one shared
        key across the batch would collide under the UNIQUE constraint."""
        m, calls = admin_stub
        uids = ["u1", "u2", "u3"]

        resp = await m.admin_bulk_grant_credits(
            m.BulkGrantCreditsRequest(user_ids=uids, amount=10, batch_id="batch-1")
        )

        keys = [c[3] for c in calls["grant"]]
        assert keys == [f"admin:{ADMIN_ID}:batch-1:u1", f"admin:{ADMIN_ID}:batch-1:u2", f"admin:{ADMIN_ID}:batch-1:u3"]
        assert resp["granted"] == 3
        assert all("synced" not in r for r in resp["results"])

    @pytest.mark.asyncio
    async def test_bulk_grant_retry_same_batch_id_is_safe(self, admin_stub):
        """Re-running a whole batch with the same batch_id must not double-grant
        any user in it -- each per-user key is identical across the retry."""
        m, calls = admin_stub
        uids = ["u1", "u2"]

        await m.admin_bulk_grant_credits(m.BulkGrantCreditsRequest(user_ids=uids, amount=10, batch_id="batch-2"))
        await m.admin_bulk_grant_credits(m.BulkGrantCreditsRequest(user_ids=uids, amount=10, batch_id="batch-2"))

        keys = [c[3] for c in calls["grant"]]
        assert keys == [
            f"admin:{ADMIN_ID}:batch-2:u1", f"admin:{ADMIN_ID}:batch-2:u2",
            f"admin:{ADMIN_ID}:batch-2:u1", f"admin:{ADMIN_ID}:batch-2:u2",
        ]

    @pytest.mark.asyncio
    async def test_unknown_user_skipped_not_fatal(self, admin_stub, monkeypatch):
        m, calls = admin_stub

        def _get_user(uid):
            return None if uid == "ghost" else {"user_id": uid}

        monkeypatch.setattr(m, "get_user_by_id", _get_user)

        resp = await m.admin_bulk_grant_credits(
            m.BulkGrantCreditsRequest(user_ids=["u1", "ghost"], amount=10, batch_id="batch-3")
        )

        assert resp["granted"] == 1
        assert resp["failed"] == 1
        by_id = {r["user_id"]: r for r in resp["results"]}
        assert by_id["ghost"]["ok"] is False
