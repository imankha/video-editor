# Epic: Storage Credits (R2 Cost Recovery)

**Goal:** No free tenants on R2. Game videos are metered with expiration and renewal. Final/working videos are prepaid at export time (cost is negligible, baked into Framing).

## Why

R2 storage costs scale linearly with users and compound over time. Without metering, 10K users cost ~$3,200/month in R2 alone. Game videos (1-5 GB each) are the real cost driver. Final/working videos (10-30 MB) cost almost nothing — prepay 5 years upfront and forget about them.

## R2 Cost Basis

| Video Type | Typical Size | R2 Cost/Month | 5-Year R2 Cost | Strategy |
|---|---|---|---|---|
| Game video | ~2.5 GB | $0.038 | $2.25 | Metered: size-based upload + renewal |
| Final video | ~15 MB | $0.000225 | $0.014 | Prepaid: absorbed into Framing export cost |
| Working video | ~15 MB | $0.000225 | $0.014 | Prepaid: absorbed into Framing export cost |

5 years of R2 for a 15 MB video costs $0.014 — less than 1 credit ($0.072). There is no reason to meter, expire, or renew final/working videos. Just bake the cost into the existing Framing credit charge.

## Pricing

### Game Videos (metered)

Size-based upload cost, 30-day storage, renewal via extension UX:

```
cost_credits = max(1, ceil(size_gb * 0.015 * (days / 30) * 1.10 / 0.072))
```

| Game Size | Upload Cost (30 days) |
|---|---|
| 1.0 GB | 1 credit |
| 2.5 GB | 1 credit |
| 5.0 GB | 2 credits |
| 10.0 GB | 3 credits |

### Final/Working Videos (prepaid)

No change to existing Framing credit cost. The R2 storage for 5 years ($0.014) is already covered by the margin on the GPU credits the user pays. No expiration, no badges, no extension UX needed.

**New accounts start with 8 credits.**

## Task Breakdown

| # | Task | Priority | Status | Description |
|---|---|---|---|---|
| 1 | **T1580** | P1 | TESTING | Game Upload & Storage Credits — size-based upload cost, 30-day expiry, renewal |
| 2 | **T1581** | P2 | TESTING | Storage Extension UX — credit-based extension modal + ExpirationBadge for game cards |
| 3 | **T1582** | P2 | TESTING | Upload surcharge (+1 credit) to pre-fund auto-export GPU costs |

The auto-export pipeline (recap generation + brilliant clip export) was split out to [T1583](../T1583-auto-export-pipeline.md) as a standalone task outside this epic, so the Storage Credits epic can be tested independently.
