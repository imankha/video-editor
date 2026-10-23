"""
Credit-pack pricing, loaded from the single source of truth `app/pricing.json` (T10210).

Everything price-shaped derives from that file. Storage is NOT priced from this ladder
(T13310: 1 credit per GB per 30 days, see ``storage_credits``).

The ladder:

- ``CREDIT_PACKS``: the billing ladder, keyed by pack key, in file order. ``name`` is the
  Stripe-facing display name ("Starter — 80 Credits"), composed here so the JSON holds
  only the bare pack name.

The frontend mirror is ``src/frontend/src/config/pricing.js`` (same file, same rules);
the app's purchase UI still reads packs at runtime from ``GET /api/payments/config``.
"""

import json
from pathlib import Path

PRICING_JSON_PATH = Path(__file__).resolve().parent / "pricing.json"


def _load_pricing() -> dict:
    with PRICING_JSON_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def pack_display_name(name: str, credits: int) -> str:
    """Stripe-facing pack name, e.g. 'Starter — 80 Credits'.

    The em dash is DELIBERATE and frozen (test_display_name_format_is_stripe_frozen): it is
    the live Stripe product-name format since T4940. Do not "ASCII-clean" it; changing it
    renames every product in Stripe reporting.
    """
    return f"{name} — {credits} Credits"


def pack_rate_cents(pack: dict) -> float:
    """Price per credit, in cents."""
    return pack["price_cents"] / pack["credits"]


_PRICING = _load_pricing()

CREDIT_PACKS: dict[str, dict] = {
    p["key"]: {
        "credits": p["credits"],
        "price_cents": p["price_cents"],
        "name": pack_display_name(p["name"], p["credits"]),
    }
    for p in _PRICING["credit_packs"]
}
