# Revenue Projection: 2,000 Users

**Date:** 2026-08-17
**Status:** Model / estimate, not a forecast backed by real conversion data (see caveat below).

## TL;DR

At current pack pricing, a highly-engaged user (modeled on the most active real account,
`arshia.kalantari@gmail.com`) generates **~$15-19/month** once their one-time free credits
are exhausted. Applying that per-user rate across a realistic engagement mix for 2,000
total signups lands in the **$3,000-$9,000/month** range — see [Scenarios](#scenarios-at-2000-users)
for the assumptions driving that spread. The single biggest lever is what fraction of 2,000
users behave like a super-user vs. a casual/free rider, and **we don't have that data yet**
(see caveat).

## Caveat: production has 12 total users

Prod currently has **12 total registered users** and only **6 credit-purchase transactions,
ever** (queried directly from the prod `credits`/`credit_transactions`/`users` tables,
2026-08-17). That's dev + friends/family accounts, not a market sample. There is no real
conversion-rate, churn, or ARPU data to extrapolate from. Everything below is a **usage-cost
model**: it converts observed *usage volume* into dollars at real pricing, then scales by
assumption, not by measured cohort behavior. Treat the scenario table as "what would it take
to hit $X" not "we will hit $X."

## How credits & pricing actually work (from code)

Source: [`storage_credits.py`](../../src/backend/app/services/storage_credits.py),
[`payments.py`](../../src/backend/app/routers/payments.py), export routers.

**What costs credits:**
| Action | Cost | Formula |
|---|---|---|
| Game upload | `storage_cost + 1` | `ceil(size_gb * 0.015 $/GB/mo * (days/30) * 1.10 margin / credit_value)` — recovers R2 cost + 10% margin, so cheap for typical file sizes (1 GB ≈ 1 credit) |
| Storage extension | `storage_cost` | same formula, no +1 surcharge |
| Export (framing/overlay) | `1 credit/second` | `ceil(video_seconds)` |

**What gives credits for free (one-time only, never recurring):**
| Source | Amount |
|---|---|
| New account bonus | 8 credits |
| Quest rewards (4 quests, one-time each) | 15 + 25 + 25 + 15 = 80 credits |
| **Total free credits per real user, lifetime** | **88 credits** |

**Credit packs (Stripe, `CREDIT_PACKS` in `payments.py`, T4940 pricing):**
| Pack | Credits | Price | $/credit |
|---|---|---|---|
| Starter | 80 | $3.99 | $0.0499 |
| Popular | 160 | $6.99 | $0.0437 |
| Best Value | 340 | $12.99 | $0.0382 |

A user buying only Starter packs pays ~31% more per credit than one buying Best Value packs.
That spread (`$0.0382` to `$0.0499`) is the range used below.

## Case study: arshia (most active real account)

Queried directly from prod Postgres (read-only), 2026-08-17, account age 41 days
(created 2026-07-07):

| Metric | Value |
|---|---|
| Game uploads | 15 transactions, -31 credits total (~2.1 credits/upload) |
| Exports (framing) | 64 transactions, -495 credits total (~7.7 credits/export, i.e. ~7.7s avg clip) |
| **Total consumed** | **526 credits over 41 days ≈ 390 credits/month** |
| Credits received free | 8 (new account) + 80 (quests, all 4 claimed) + 500 (admin grant) |
| Credits actually purchased | 180 (one Stripe purchase, $12.99, pre-T4940 pricing) |
| Current balance | 260 |

**Important:** 500 of her 588 free credits came from an `admin_grant` — she's a known/friends
account subsidized well beyond what a real signup gets (88 lifetime, per the table above), so
her *purchase* behavior isn't representative. Her *usage volume* (390 credits/month) is the
useful number here — it's real product usage from real editing sessions, not a synthetic
estimate.

### Translating her usage into revenue

If a user consuming credits at arshia's rate (390/month) had to buy all of it via packs
(ignoring the 88 lifetime free credits, which wash out after month one):

| Pack used | $/credit | Monthly cost at 390 credits/mo |
|---|---|---|
| Starter only (worst case) | $0.0499 | **$19.46/mo** |
| Popular only | $0.0437 | **$17.04/mo** |
| Best Value only (best case) | $0.0382 | **$14.90/mo** |

Call it **~$15-19/month per super-active user**, depending on which pack they buy.

## Scenarios at 2,000 users

"2,000 users" is ambiguous (total signups vs. monthly active vs. paying) — the table below
treats it as **2,000 total registered users**, then applies an engagement-mix assumption on
top, since that's the unknown that actually drives the answer. Adjust the % splits to match
whatever growth/engagement assumption you're working from.

| Scenario | Super-users (arshia-like, ~$17/mo) | Light users (~1/4 her usage, ~$4/mo) | Free-tier only (never buy beyond 88 lifetime credits) | **Monthly revenue** |
|---|---|---|---|---|
| Conservative | 3% (60 users) | 15% (300 users) | 82% (1,640) | 60×$17 + 300×$4 = **~$2,220/mo** |
| Moderate | 8% (160 users) | 25% (500 users) | 67% (1,340) | 160×$17 + 500×$4 = **~$4,720/mo** |
| Optimistic | 15% (300 users) | 35% (700 users) | 50% (1,000) | 300×$17 + 700×$4 = **~$8,000/mo** |
| Upper bound (unrealistic) | 100% (2,000 users like arshia) | — | — | **~$34,000/mo** |

The upper bound is included only to show the ceiling — it assumes every one of 2,000 users
edits ~15 games and exports ~64 clips a month, which is not a realistic distribution for a
consumer app.

## Margin (revenue vs. Modal GPU + R2 cost)

Source for cost anchors: [`.claude/knowledge/modal-gpu.md`](../../.claude/knowledge/modal-gpu.md)
(E6 benchmark) and [`storage_credits.py`](../../src/backend/app/services/storage_credits.py).
All GPU-time costs are T4 instance pricing; the overlay pass cost is explicitly flagged
unmeasured in the knowledge doc, so it's an estimate, not a benchmark like the framing number.

**Framing/upscale export (the only Modal pass that's actually charged):**
- Benchmarked cost: T4 ≈ 681ms/frame → 10s clip ≈ 204 GPU-s ≈ **$0.03**, i.e. **$0.003/exported-second**.
- Charged: 1 credit/second.
- Revenue/credit: $0.0382 (Best Value) to $0.0499 (Starter).
- **Gross margin: ~92-94%** ((0.0382-0.003)/0.0382 to (0.0499-0.003)/0.0499). Very high — GPU-seconds are cheap relative to the credit price.

**Overlay render pass (2nd Modal call, ffmpeg compositing — NOT the GAN upscale):**
- Free to users by product decision — **zero credits charged**, per `export/overlay.py` (no credit deduction anywhere in that router).
- Its GPU cost was never benchmarked (Modal is unavailable inside /dotask containers where T4940 ran its sanity check). The knowledge doc's working estimate is "well under 0.1c/s."
- This is pure COGS with no offsetting revenue line — it rides free on every export that includes an overlay.

**Storage/upload credits — the one place margin is NOT what it looks like:**
- `calculate_storage_cost` targets a 10% margin, but it's computed by dividing by a fixed
  `CREDIT_VALUE = 0.05` ("worst-case, Starter-pack rate") — it does **not** know which pack
  the user actually buys credits from.
- Real R2 cost per credit charged ≈ `credit_value / 1.10 ≈ $0.0455`.
- A user paying via **Starter** ($0.0499/credit): margin ≈ **+8.9%** (roughly the intended 10%, rounding aside).
- A user paying via **Popular** ($0.0437/credit): margin ≈ **-4.0%** (below cost).
- A user paying via **Best Value** ($0.0382/credit): margin ≈ **-19%** (below cost).
- In other words: **the cheapest, most-incentivized pack (Best Value, the one we nudge whales toward) loses money on storage specifically.** The `max(1, ...)` credit floor cushions small uploads (charged more than their real cost), but a user uploading large files and buying only Best Value packs is charged below our storage cost. This is invisible in aggregate because framing exports dominate volume and carry a much fatter margin.

**Concrete example — arshia's real 41-day usage (526 credits: 31 upload + 495 export):**
| Line | Credits | Real infra cost | Revenue at current pricing |
|---|---|---|---|
| Uploads (storage) | 31 | ~$1.41 (upper bound; floor rounding likely makes it less) | $1.18-$1.55 |
| Exports (framing GPU) | 495 | ~$1.49 | $18.91-$24.70 |
| Overlay pass (free, rides along) | — | ~$0.10-0.25 (unmeasured, estimated) | $0 |
| **Total** | 526 | **~$3.00-3.15** | **$20.09 (Best Value) - $26.25 (Starter)** |

**Blended gross margin on this usage: ~84-88%**, driven almost entirely by the framing/export
line — storage credits are a rounding error at this volume, but would matter more for a
user profile skewed toward large uploads and few exports (uncommon — arshia's mix is 94%
export credits by volume, which looks typical for the product: upload once, export many clips).

**Not included above** (real costs that reduce net further, none of them in this repo to verify):
- Stripe fees, industry-standard ~2.9% + $0.30/transaction — knocks a few points off net margin on top of gross, worse on small Starter-pack purchases (fixed $0.30 is a bigger % of a $3.99 charge than a $12.99 one).
- Fly.io hosting, R2 API request costs (not per-GB storage, the request/egress side), engineering time — none are metered per-user in this codebase.
- The 88 lifetime free credits (+ any admin grants) per user are pure cost with zero revenue — a promo/CAC cost, not a margin drag on paid usage, but it does mean early usage per user is loss-making until those are exhausted.

## What would sharpen this

- **Real conversion rate**: % of signups who ever buy a pack, once the user base is bigger
  than 12 and not friends/family. This is the single biggest unknown.
- **Retention curve**: arshia's rate is measured over her first 41 days; whether usage holds,
  grows, or decays after that is unknown.
- **Free-tier drag**: how many users churn out entirely after their 88 free credits run out
  vs. convert to paying.
- Once there's a real cohort (even 100-200 organic signups with no admin grants), rerun this
  model against actual `source='stripe_purchase'` volume instead of the arshia proxy.
