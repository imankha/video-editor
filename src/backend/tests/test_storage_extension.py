"""
Tests for T1581: Storage extension cost calculations and expiry logic.
"""

import math
from datetime import datetime, timedelta

from app.services.storage_credits import (
    calculate_extension_cost,
    calculate_upload_cost,
    storage_expires_at,
    R2_RATE_PER_GB_MONTH,
    CREDIT_VALUE,
    MARGIN,
)


class TestCalculateExtensionCost:
    def test_extension_cost_matches_upload_cost(self):
        size = 2_500_000_000  # 2.5 GB
        assert calculate_extension_cost(size, 30) == calculate_upload_cost(size, 30)

    def test_minimum_1_credit(self):
        assert calculate_extension_cost(100_000, 1) == 1

    def test_small_game_30_days(self):
        size = int(1.0 * 1024 ** 3)  # 1 GB
        cost = calculate_extension_cost(size, 30)
        assert cost == 1

    def test_large_game_30_days(self):
        size = int(5.0 * 1024 ** 3)  # 5 GB
        cost = calculate_extension_cost(size, 30)
        assert cost == 2

    def test_very_large_game_30_days(self):
        size = int(10.0 * 1024 ** 3)  # 10 GB
        cost = calculate_extension_cost(size, 30)
        assert cost == 3

    def test_cost_scales_with_days(self):
        size = int(5.0 * 1024 ** 3)
        cost_30 = calculate_extension_cost(size, 30)
        cost_90 = calculate_extension_cost(size, 90)
        assert cost_90 > cost_30

    def test_cost_scales_with_size(self):
        cost_small = calculate_extension_cost(int(1.0 * 1024 ** 3), 30)
        cost_large = calculate_extension_cost(int(10.0 * 1024 ** 3), 30)
        assert cost_large > cost_small

    def test_365_day_extension(self):
        size = int(2.5 * 1024 ** 3)
        cost = calculate_extension_cost(size, 365)
        expected = max(1, math.ceil(
            2.5 * R2_RATE_PER_GB_MONTH * (365 / 30) * (1 + MARGIN) / CREDIT_VALUE
        ))
        assert cost == expected


class TestStorageExpiresAt:
    def test_defaults_to_30_days_from_now(self):
        before = datetime.utcnow()
        result = storage_expires_at()
        after = datetime.utcnow()
        assert before + timedelta(days=30) <= result <= after + timedelta(days=30)

    def test_custom_base_date(self):
        base = datetime(2026, 6, 1, 12, 0, 0)
        result = storage_expires_at(from_dt=base, days=30)
        assert result == datetime(2026, 7, 1, 12, 0, 0)

    def test_custom_days(self):
        base = datetime(2026, 1, 1)
        result = storage_expires_at(from_dt=base, days=90)
        assert result == datetime(2026, 4, 1)

    def test_extension_from_future_expiry(self):
        future = datetime.utcnow() + timedelta(days=10)
        result = storage_expires_at(from_dt=future, days=30)
        expected = future + timedelta(days=30)
        assert abs((result - expected).total_seconds()) < 1


class TestDaysPerCreditFormula:
    """Verify the frontend daysPerCredit formula matches backend cost formula."""

    def _days_per_credit(self, file_size_bytes):
        size_gb = file_size_bytes / (1024 ** 3)
        if size_gb <= 0:
            return 30
        return max(1, math.floor(
            30 * CREDIT_VALUE / (size_gb * R2_RATE_PER_GB_MONTH * (1 + MARGIN))
        ))

    def test_2_5_gb_game(self):
        size = int(2.5 * 1024 ** 3)
        dpc = self._days_per_credit(size)
        assert dpc == 52
        assert calculate_extension_cost(size, dpc) == 1
        assert calculate_extension_cost(size, dpc + 1) >= 1

    def test_5_gb_game(self):
        size = int(5.0 * 1024 ** 3)
        dpc = self._days_per_credit(size)
        assert dpc == 26
        assert calculate_extension_cost(size, dpc) == 1

    def test_10_gb_game(self):
        size = int(10.0 * 1024 ** 3)
        dpc = self._days_per_credit(size)
        assert dpc == 13
        assert calculate_extension_cost(size, dpc) == 1

    def test_1_gb_game(self):
        size = int(1.0 * 1024 ** 3)
        dpc = self._days_per_credit(size)
        assert calculate_extension_cost(size, dpc) == 1

    def test_n_credits_equals_n_steps(self):
        size = int(2.5 * 1024 ** 3)
        dpc = self._days_per_credit(size)
        for n in range(1, 8):
            cost = calculate_extension_cost(size, dpc * n)
            assert cost == n, f"{n} steps of {dpc}d should cost {n} credits, got {cost}"
