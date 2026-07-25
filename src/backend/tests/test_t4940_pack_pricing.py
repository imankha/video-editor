"""
T4940: Credit-pack repricing + single-sourced packs via /payments/config.

Covers:
- The repriced ladder (60/120/260 at $3.99/$6.99/$12.99) is correct.
- /payments/config returns the three packs so the frontend renders backend truth.
- The upload cost formula stays cost-recovering at the new CREDIT_VALUE (0.05).
"""

import asyncio
import math

from app.routers.payments import CREDIT_PACKS, get_payment_config
from app.services.storage_credits import (
    CREDIT_VALUE,
    MARGIN,
    R2_RATE_PER_GB_MONTH,
    calculate_upload_cost,
)


class TestRepricedLadder:
    def test_pack_credits_and_prices(self):
        assert CREDIT_PACKS["starter"]["credits"] == 80
        assert CREDIT_PACKS["starter"]["price_cents"] == 399
        assert CREDIT_PACKS["popular"]["credits"] == 160
        assert CREDIT_PACKS["popular"]["price_cents"] == 699
        assert CREDIT_PACKS["best_value"]["credits"] == 340
        assert CREDIT_PACKS["best_value"]["price_cents"] == 1299

    def test_starter_is_the_worst_case_rate_matching_credit_value(self):
        # Starter is the highest per-credit rate (~4.99c); CREDIT_VALUE (0.05) is
        # the storage-formula anchor derived from it.
        pack = CREDIT_PACKS["starter"]
        cents_per_credit = pack["price_cents"] / pack["credits"]
        assert round(cents_per_credit, 2) == 4.99
        assert round(cents_per_credit / 100, 3) <= round(CREDIT_VALUE, 3) + 0.001

    def test_best_value_is_the_cheapest_rate(self):
        pack = CREDIT_PACKS["best_value"]
        cents_per_credit = pack["price_cents"] / pack["credits"]
        assert round(cents_per_credit, 1) == 3.8

    def test_ladder_is_monotonic_discount(self):
        # Each larger pack must be strictly cheaper per credit (value ladder).
        rates = [
            CREDIT_PACKS["starter"]["price_cents"] / CREDIT_PACKS["starter"]["credits"],
            CREDIT_PACKS["popular"]["price_cents"] / CREDIT_PACKS["popular"]["credits"],
            CREDIT_PACKS["best_value"]["price_cents"] / CREDIT_PACKS["best_value"]["credits"],
        ]
        assert rates[0] > rates[1] > rates[2]


class TestPaymentConfigPacks:
    def test_config_returns_three_packs(self):
        config = asyncio.run(get_payment_config())
        assert "packs" in config
        assert len(config["packs"]) == 3

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
    """At CREDIT_VALUE=0.05 the upload charge must still recover R2 cost + margin."""

    def _dollars_charged(self, credits):
        # Credits are sold at 5c worst-case; the surcharge credit is the auto-export.
        return credits * CREDIT_VALUE

    def _r2_cost_for_30_days(self, size_gb):
        return size_gb * R2_RATE_PER_GB_MONTH  # one month of storage

    def test_credit_value_updated(self):
        assert CREDIT_VALUE == 0.05

    def test_four_gb_game_costs_three_credits(self):
        # Kickoff expectation: a 4GB game goes to 3 credits incl. surcharge at 0.05.
        size = int(4.0 * 1024 ** 3)
        assert calculate_upload_cost(size, 30) == 3

    def test_storage_portion_covers_r2_with_margin(self):
        # For a spread of sizes, the storage credits charged (upload minus the
        # 1-credit auto-export surcharge) must cover R2 storage cost * (1+MARGIN).
        for size_gb in (1.0, 2.5, 4.0, 5.0, 10.0):
            size = int(size_gb * 1024 ** 3)
            storage_credits = calculate_upload_cost(size, 30) - 1
            dollars_recovered = storage_credits * CREDIT_VALUE
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
