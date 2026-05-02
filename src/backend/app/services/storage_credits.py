"""
Storage credits — size-based upload cost and R2 cleanup.

Game videos are metered: users pay credits on upload, get 30 days of storage,
and can extend via T1581. Final/working videos are prepaid at export time.

The cost formula ensures R2 costs are recovered with a 10% margin:
    cost = max(1, ceil(size_gb * R2_RATE * (days / 30) * (1 + MARGIN) / CREDIT_VALUE))
"""

import logging
import math
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# R2 cost basis
R2_RATE_PER_GB_MONTH = 0.015  # $/GB/month
CREDIT_VALUE = 0.072  # worst-case per-credit (Best Value pack)
MARGIN = 0.10

# Storage defaults
STORAGE_DURATION_DAYS = 30
EXPIRY_VISIBLE_DAYS = 28
NEW_ACCOUNT_CREDITS = 8


def calculate_upload_cost(file_size_bytes: int, days: int = STORAGE_DURATION_DAYS) -> int:
    size_gb = file_size_bytes / (1024 ** 3)
    return max(1, math.ceil(
        size_gb * R2_RATE_PER_GB_MONTH * (days / 30) * (1 + MARGIN) / CREDIT_VALUE
    ))


def calculate_extension_cost(file_size_bytes: int, days: int) -> int:
    return calculate_upload_cost(file_size_bytes, days)


def storage_expires_at(from_dt: datetime = None, days: int = STORAGE_DURATION_DAYS) -> datetime:
    base = from_dt or datetime.utcnow()
    return base + timedelta(days=days)
