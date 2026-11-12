"""Paid-tier Gemini API prices, USD per 1M tokens.

Source: https://aistudio.google.com/docs/pricing (read 2026-11-12).
`future` holds an announced price change: (effective date, input, output).
`audio_in` is set only where the page lists a separate audio input price.
Batch is half the standard price on every model listed here.
"""

PRICING = {
    "gemini-4-argon":         {"input": 2.00, "output": 10.00, "future": ("2026-12-01", 4.00, 20.00)},
    "gemini-4-carbon":        {"input": 2.00, "output": 10.00, "future": ("2026-12-01", 4.00, 20.00)},
    "gemini-4-hydrogen":      {"input": 1.50, "output": 7.50},
    "gemini-3.8-flash":       {"input": 0.75, "output": 3.75, "future": ("2027-01-01", 1.50, 7.50)},
    "gemini-3.6-flash":       {"input": 0.75, "output": 3.75, "future": ("2027-01-01", 1.50, 7.50)},
    "gemini-3.5-flash-lite":  {"input": 0.30, "output": 2.50},
    "gemini-3.1-pro-preview": {"input": 2.00, "output": 12.00, "over_200k": (4.00, 18.00)},
    "gemini-3-flash-preview": {"input": 0.50, "output": 3.00, "audio_in": 1.00},
    "gemini-3.1-flash-lite":  {"input": 0.25, "output": 1.50, "audio_in": 0.50},
}

# Listed by the API but left out on purpose:
#   gemini-3.7-flash, gemini-3.5-flash   - no price on the pricing page
#   gemini-2.5-*                         - closed to new users, rerouted 2026-12-01
#   gemini-omni-*                        - video generation models
#
# Owner decision 2026-11-12: only these two go forward; the lite models gave poor results.
# The other prices stay above so `--models <id>` still works for a comparison run.
MODELS = ["gemini-4-hydrogen", "gemini-3.6-flash"]


def cost_usd(model: str, text_video_in: int, audio_in: int, out: int, when: str = "now") -> float:
    """Cost of one call. `out` includes thinking tokens. `when` is 'now' or 'future'."""
    p = PRICING[model]
    in_price, out_price = p["input"], p["output"]
    if when == "future" and "future" in p:
        _, in_price, out_price = p["future"]
    if "over_200k" in p and text_video_in + audio_in > 200_000:
        in_price, out_price = p["over_200k"]
    audio_price = p.get("audio_in", in_price)
    return (text_video_in * in_price + audio_in * audio_price + out * out_price) / 1_000_000
