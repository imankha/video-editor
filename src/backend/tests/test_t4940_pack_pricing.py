"""
T4940 / T10210: Credit-pack pricing is single-sourced from app/pricing.json.

Covers the INVARIANTS of the ladder, not its current numbers, so a reprice is a one-file
edit to pricing.json and nothing here needs touching:
- packs are a value ladder (ascending price, strictly decreasing per-credit rate);
- /payments/config returns exactly the ladder so the frontend renders backend truth;
- storage charges are NOT derived from the ladder (T13310; see test_t13310_storage_per_gb.py).
"""

import asyncio
import json
from itertools import pairwise

from app.pricing import CREDIT_PACKS, PRICING_JSON_PATH, pack_display_name, pack_rate_cents
from app.routers import payments
from app.routers.payments import get_payment_config


def _ladder():
    return list(CREDIT_PACKS.values())


class TestSingleSource:
    def test_packs_come_from_pricing_json(self):
        raw = json.loads(PRICING_JSON_PATH.read_text(encoding="utf-8"))["credit_packs"]
        assert [p["key"] for p in raw] == list(CREDIT_PACKS.keys())
        for p in raw:
            assert CREDIT_PACKS[p["key"]]["credits"] == p["credits"]
            assert CREDIT_PACKS[p["key"]]["price_cents"] == p["price_cents"]
            assert CREDIT_PACKS[p["key"]]["name"] == pack_display_name(p["name"], p["credits"])

    def test_payments_reexports_the_same_objects(self):
        # Guards against someone re-adding a local pack table in payments.
        assert payments.CREDIT_PACKS is CREDIT_PACKS

    def test_display_name_format_is_stripe_frozen(self):
        # The em dash is DELIBERATE: it is the live Stripe product-name format (T4940).
        # Do not "ASCII-clean" it; that renames every product in Stripe reporting.
        assert pack_display_name("Starter", 80) == "Starter — 80 Credits"


class TestLadderInvariants:
    def test_at_least_two_packs_with_positive_integers(self):
        packs = _ladder()
        assert len(packs) >= 2
        for p in packs:
            assert isinstance(p["credits"], int) and p["credits"] > 0
            assert isinstance(p["price_cents"], int) and p["price_cents"] > 0

    def test_shape_rules_credits_in_tens_prices_x99(self):
        # T4940 rule: credits in multiples of 10, prices $X.99. Catches a fat-fingered
        # pricing.json without pinning any number a
        # legitimate reprice would change.
        for p in _ladder():
            assert p["credits"] % 10 == 0
            assert p["price_cents"] % 100 == 99

    def test_prices_ascend(self):
        prices = [p["price_cents"] for p in _ladder()]
        assert prices == sorted(prices) and len(set(prices)) == len(prices)

    def test_ladder_is_monotonic_discount(self):
        # Each larger pack must be strictly cheaper per credit (value ladder).
        rates = [pack_rate_cents(p) for p in _ladder()]
        assert all(a > b for a, b in pairwise(rates))


class TestPaymentConfigPacks:
    def test_config_returns_the_whole_ladder(self):
        config = asyncio.run(get_payment_config())
        assert "packs" in config
        assert [p["key"] for p in config["packs"]] == list(CREDIT_PACKS.keys())

    def test_config_packs_match_constants(self):
        config = asyncio.run(get_payment_config())
        by_key = {p["key"]: p for p in config["packs"]}
        for key, pack in CREDIT_PACKS.items():
            assert by_key[key]["credits"] == pack["credits"]
            assert by_key[key]["price_cents"] == pack["price_cents"]
            assert by_key[key]["name"] == pack["name"]

    def test_config_still_returns_publishable_key(self):
        config = asyncio.run(get_payment_config())
        assert "publishable_key" in config
