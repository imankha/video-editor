"""
T4940 / T10210: Credit-pack pricing is single-sourced from app/pricing.json.

Covers the INVARIANTS of the ladder, not its current numbers, so a reprice is a one-file
edit to pricing.json and nothing here needs touching:
- packs are a value ladder (ascending price, strictly decreasing per-credit rate);
- CREDIT_VALUE (the storage-cost anchor) is the worst-case rate rounded UP to a whole cent;
- /payments/config returns exactly the ladder so the frontend renders backend truth;
- the upload cost formula stays cost-recovering at whatever CREDIT_VALUE derives to.
"""

import asyncio
import json
import math
from itertools import pairwise

from app.pricing import CREDIT_PACKS, CREDIT_VALUE, PRICING_JSON_PATH, pack_display_name, pack_rate_cents
from app.routers import payments
from app.routers.payments import get_payment_config
from app.services import storage_credits
from app.services.storage_credits import MARGIN, R2_RATE_PER_GB_MONTH, calculate_upload_cost


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

    def test_payments_and_storage_credits_reexport_the_same_objects(self):
        # Guards against someone re-adding a local pack table / anchor in either module.
        assert payments.CREDIT_PACKS is CREDIT_PACKS
        assert storage_credits.CREDIT_VALUE == CREDIT_VALUE

    def test_analytics_amount_map_covers_the_current_ladder(self):
        # admin money-spent maps purchase credit amounts to cents; a stale map reports $0.
        from app.analytics import CREDIT_AMOUNT_TO_CENTS
        for p in CREDIT_PACKS.values():
            assert CREDIT_AMOUNT_TO_CENTS[p["credits"]] == p["price_cents"]

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

    def test_shape_rules_credits_in_tens_prices_x99_anchor_in_band(self):
        # T4940 rule: credits in multiples of 10, prices $X.99. Catches a fat-fingered
        # pricing.json ("credits": 8 -> a 10x storage anchor) without pinning any number a
        # legitimate reprice would change.
        for p in _ladder():
            assert p["credits"] % 10 == 0
            assert p["price_cents"] % 100 == 99
        assert 0.01 <= CREDIT_VALUE <= 0.10

    def test_prices_ascend(self):
        prices = [p["price_cents"] for p in _ladder()]
        assert prices == sorted(prices) and len(set(prices)) == len(prices)

    def test_ladder_is_monotonic_discount(self):
        # Each larger pack must be strictly cheaper per credit (value ladder).
        rates = [pack_rate_cents(p) for p in _ladder()]
        assert all(a > b for a, b in pairwise(rates))

    def test_credit_value_is_worst_case_rate_rounded_up_to_a_cent(self):
        worst_cents = max(pack_rate_cents(p) for p in _ladder())
        assert math.ceil(worst_cents) / 100 == CREDIT_VALUE
        # Never sell a credit for more than the anchor assumes it is worth.
        assert all(pack_rate_cents(p) / 100 <= CREDIT_VALUE for p in _ladder())


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


class TestUploadFormulaCostRecovering:
    """At the derived CREDIT_VALUE the upload charge must still recover R2 cost + margin."""

    def _r2_cost_for_30_days(self, size_gb):
        return size_gb * R2_RATE_PER_GB_MONTH  # one month of storage

    def test_storage_portion_covers_r2_with_margin(self):
        # For a spread of sizes, the storage credits charged (upload minus the
        # 1-credit auto-export surcharge) must cover R2 storage cost * (1+MARGIN).
        for size_gb in (1.0, 2.5, 4.0, 5.0, 10.0):
            size = int(size_gb * 1024 ** 3)
            storage_credits_charged = calculate_upload_cost(size, 30) - 1
            dollars_recovered = storage_credits_charged * CREDIT_VALUE
            r2_cost_with_margin = self._r2_cost_for_30_days(size_gb) * (1 + MARGIN)
            assert dollars_recovered >= r2_cost_with_margin, (
                f"{size_gb}GB: recovered ${dollars_recovered:.4f} < "
                f"required ${r2_cost_with_margin:.4f}"
            )

    def test_matches_ceil_formula(self):
        size = int(4.0 * 1024 ** 3)
        expected_storage = max(1, math.ceil(
            4.0 * R2_RATE_PER_GB_MONTH * (30 / 30) * (1 + MARGIN) / CREDIT_VALUE
        ))
        assert calculate_upload_cost(size, 30) == expected_storage + 1
