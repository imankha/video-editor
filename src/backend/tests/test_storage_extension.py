"""
Tests for T1581/T1582: Storage extension costs, upload surcharge, and expiry logic.
"""

import math
from datetime import datetime, timedelta

from app.services.storage_credits import (
    calculate_extension_cost,
    calculate_storage_cost,
    calculate_upload_cost,
    storage_expires_at,
    AUTO_EXPORT_SURCHARGE,
    R2_RATE_PER_GB_MONTH,
    CREDIT_VALUE,
    MARGIN,
)


class TestUploadCostIncludesSurcharge:
    def test_upload_cost_equals_storage_plus_surcharge(self):
        size = int(2.5 * 1024 ** 3)
        assert calculate_upload_cost(size, 30) == calculate_storage_cost(size, 30) + AUTO_EXPORT_SURCHARGE

    def test_1gb_upload_cost(self):
        size = int(1.0 * 1024 ** 3)
        assert calculate_upload_cost(size, 30) == 2  # 1 storage + 1 surcharge

    def test_2_5gb_upload_cost(self):
        size = int(2.5 * 1024 ** 3)
        assert calculate_upload_cost(size, 30) == 2  # 1 storage + 1 surcharge

    def test_5gb_upload_cost(self):
        size = int(5.0 * 1024 ** 3)
        assert calculate_upload_cost(size, 30) == 3  # 2 storage + 1 surcharge

    def test_10gb_upload_cost(self):
        size = int(10.0 * 1024 ** 3)
        assert calculate_upload_cost(size, 30) == 4  # 3 storage + 1 surcharge


class TestExtensionCostNoSurcharge:
    def test_extension_has_no_surcharge(self):
        size = int(2.5 * 1024 ** 3)
        assert calculate_extension_cost(size, 30) == calculate_storage_cost(size, 30)

    def test_extension_less_than_upload(self):
        size = int(2.5 * 1024 ** 3)
        assert calculate_extension_cost(size, 30) < calculate_upload_cost(size, 30)

    def test_minimum_1_credit(self):
        assert calculate_extension_cost(100_000, 1) == 1

    def test_small_game_30_days(self):
        size = int(1.0 * 1024 ** 3)
        assert calculate_extension_cost(size, 30) == 1

    def test_large_game_30_days(self):
        size = int(5.0 * 1024 ** 3)
        assert calculate_extension_cost(size, 30) == 2

    def test_very_large_game_30_days(self):
        size = int(10.0 * 1024 ** 3)
        assert calculate_extension_cost(size, 30) == 3

    def test_cost_scales_with_days(self):
        size = int(5.0 * 1024 ** 3)
        assert calculate_extension_cost(size, 90) > calculate_extension_cost(size, 30)

    def test_cost_scales_with_size(self):
        assert calculate_extension_cost(int(10.0 * 1024 ** 3), 30) > calculate_extension_cost(int(1.0 * 1024 ** 3), 30)

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
    """Verify the frontend daysPerCredit formula matches backend extension cost formula."""

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
