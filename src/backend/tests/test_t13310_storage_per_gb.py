"""
T13310: storage is priced per GB-month (1 credit per GB per 30 days, GB rounded up,
minimum 1), decoupled from the credit-pack ladder.

PARITY_CASES is mirrored verbatim in src/frontend/src/utils/storageCost.test.js; the
preview, the modal and the charge must never disagree (T4940 invariant).
"""

import importlib
import importlib.util
import json
import sys
from pathlib import Path

import app as app_pkg
from app import pricing
from app.services import storage_credits
from app.services.storage_credits import (
    calculate_extension_cost,
    calculate_storage_cost,
    calculate_upload_cost,
)

GB = 1024 ** 3

# (size_gb, days, storage_credits)
PARITY_CASES = [
    (0.5, 30, 1), (0.5, 7, 1), (0.5, 60, 2),
    (1, 30, 1), (1, 7, 1), (1, 60, 2),
    (2.5, 30, 3), (2.5, 7, 1), (2.5, 60, 6),
    (6, 30, 6), (6, 7, 2), (6, 60, 12),
    (6.4, 30, 7), (6.4, 7, 2), (6.4, 60, 14),
    (20, 30, 20), (20, 7, 5), (20, 60, 40),
]


def test_parity_fixtures():
    for gb, days, expected in PARITY_CASES:
        assert calculate_storage_cost(int(gb * GB), days) == expected, (gb, days)
        assert calculate_extension_cost(int(gb * GB), days) == expected, (gb, days)


def test_acceptance_examples():
    assert calculate_upload_cost(6 * GB, 30) == 7
    assert calculate_extension_cost(6 * GB, 30) == 6
    assert calculate_upload_cost(int(2.5 * GB), 30) == 4
    assert calculate_upload_cost(int(0.5 * GB), 30) == 2


def test_minimum_one_credit_for_tiny_file():
    assert calculate_storage_cost(1, 1) == 1


def test_credit_value_and_margin_removed():
    assert not hasattr(pricing, "CREDIT_VALUE")
    assert not hasattr(storage_credits, "CREDIT_VALUE")
    assert not hasattr(storage_credits, "MARGIN")


def test_ladder_edit_leaves_storage_charges_unchanged(tmp_path, monkeypatch):
    before = [calculate_storage_cost(int(g * GB), d) for g, d, _ in PARITY_CASES]
    # Load a copy of app/pricing.py next to a tripled-price pricing.json and make it THE
    # `app.pricing` module, then re-import storage_credits against it.
    raw = json.loads(pricing.PRICING_JSON_PATH.read_text(encoding="utf-8"))
    for p in raw["credit_packs"]:
        p["price_cents"] *= 3
    (tmp_path / "pricing.json").write_text(json.dumps(raw), encoding="utf-8")
    alt_py = tmp_path / "pricing.py"
    alt_py.write_text(Path(pricing.__file__).read_text(encoding="utf-8"), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("app.pricing", alt_py)
    alt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(alt)
    monkeypatch.setitem(sys.modules, "app.pricing", alt)
    monkeypatch.setattr(app_pkg, "pricing", alt, raising=False)
    fresh = importlib.reload(storage_credits)
    try:
        after = [fresh.calculate_storage_cost(int(g * GB), d) for g, d, _ in PARITY_CASES]
    finally:
        monkeypatch.undo()
        importlib.reload(storage_credits)
    assert before == after
