"""
Security regression: POST /api/credits/grant must be unreachable in production.

The endpoint grants the CURRENT user a CLIENT-SUPPLIED amount. Before this gate,
any authenticated production user could mint unlimited credits for free, bypassing
Stripe entirely (the only validation was `amount > 0`).

It is test-only infrastructure: no production frontend code calls it (only the e2e
specs do), and every real grant path is server-side --
quests.py (server picks the reward), admin.py (admin-gated), payments.py (Stripe),
session_init.py (signup bonus).
"""

import pytest
from fastapi import HTTPException

from app.routers import credits


class _Req:
    """Minimal stand-in for GrantRequest."""

    def __init__(self, amount=1000, source="e2e_test", reference_id=None):
        self.amount = amount
        self.source = source
        self.reference_id = reference_id


@pytest.mark.asyncio
async def test_grant_is_404_in_production(monkeypatch):
    """Production must hard-404 -- the credit-minting hole stays closed."""
    monkeypatch.setattr(credits, "APP_ENV", "production")

    granted = []
    monkeypatch.setattr(
        credits, "grant_credits",
        lambda *a, **k: granted.append(a) or 999,
    )

    with pytest.raises(HTTPException) as exc:
        await credits.grant(_Req(amount=1_000_000))

    assert exc.value.status_code == 404
    # The gate must short-circuit BEFORE any credit is granted.
    assert granted == [], "grant_credits must not run in production"


@pytest.mark.parametrize("env", ["dev", "development", "local", "staging"])
@pytest.mark.asyncio
async def test_grant_still_works_outside_production(monkeypatch, env):
    """Non-prod keeps working so the e2e specs that seed credits still pass."""
    monkeypatch.setattr(credits, "APP_ENV", env)
    monkeypatch.setattr(credits, "get_current_user_id", lambda: "user-1")
    monkeypatch.setattr(credits, "grant_credits", lambda *a, **k: 1234)

    result = await credits.grant(_Req(amount=1000))
    assert result == {"balance": 1234}


@pytest.mark.asyncio
async def test_non_positive_amount_still_rejected(monkeypatch):
    """The pre-existing amount guard is unchanged outside production."""
    monkeypatch.setattr(credits, "APP_ENV", "dev")
    monkeypatch.setattr(credits, "get_current_user_id", lambda: "user-1")

    with pytest.raises(HTTPException) as exc:
        await credits.grant(_Req(amount=0))
    assert exc.value.status_code == 400
