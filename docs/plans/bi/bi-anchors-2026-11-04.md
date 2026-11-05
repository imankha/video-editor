# BI anchors for the revenue outlook (2026-11-04)

## Status: REFRESHED 2026-11-04 19:02 UTC (read-only prod aggregate pull)

Pulled by the read-only aggregate script (scratchpad `prod_aggregates.py`, `SET TRANSACTION READ ONLY`, aggregates only, no row dumps) over the prod Postgres proxy after the owner granted session-level prod read access. 7 test accounts excluded (`users.is_test_account`); admin accounts not excluded. The first attempt earlier the same day was denied by the permission classifier; the grant resolved it.

## Missing inputs (listed first)

1. US vs non-US sign-ups: no country column on sign-ups. Only Search Console clicks split by country (October 2026: US 77 of 129 clicks, 60%).
2. Sign-ups by arrival sport: `user_segments.utm_content` is empty for all 379 (T14930 not built).
3. Landing visits: no beacon (T7410). Visit-to-sign-up unknown.
4. Fixed infrastructure bills (Fly, Modal, R2, Cloudflare, Stripe, domain, email): not in the repo. Owner to read the billing pages.
5. Export event from the paid render: `exports_started` is 0 in the last 30 days, so T14710 has not shipped; `credits_consumed` remains the activation proxy.
6. Repeat at 120+ days: 0 of 47 renderers have reached a 120-day gap; the product is too young to measure.

## Definitions used

Activation = first `credits_consumed` within 14 days of `users.created_at`. Mature cohort = signed up 14+ days before the pull. Payer = `payments` row `kind = purchase`. Repeat renderer = a renderer with `user_usage_daily` activity in 2+ calendar months; 120-day repeat = last active day at least 120 days after first active day. K = referred sign-ups / all sign-ups. Upload failure share = `game_uploads_failed / (succeeded + failed)` from `daily_counters`, origin `all`.

## Anchor table (all M, prod, 2026-11-04 19:02 UTC, unless stated)

| Anchor | Value (N first) | Change vs 2026-11-03 |
|---|---|---|
| Real sign-ups, all time | 379 (7 test excluded) | +4 |
| Monthly sign-ups | May 2, Jun 2, Jul 2, Aug 42, Sep 148, Oct 169, Nov 14 (4 days) | pre-Aug now measured |
| Weekly sign-ups, last 8 full weeks (Mon start) | Sep 14: 29, Sep 21: 41, Sep 28: 42, Oct 5: 42, Oct 12: 39, Oct 19: 29, Oct 26: 35; Nov 2 partial: 12 | none |
| Sign-ups last 30 days / last 7 days | 152 / 29 | n/a |
| Sign-ups since 2026-10-24 reprice | 52 | +4 |
| Platform (by session platform) | webapp-mobile 199, webapp-desktop 164, pwa 8, no session row 44 | none |
| Activation within 14 days, all time | 48 of 379 = 12.7% | 12.8% |
| Activation, mature cohorts only (n 321) | 40 of 321 = 12.5% | new cut |
| Activation, last 100 mature sign-ups | 16 of 100 = 16.0% | new cut |
| Activation by cohort month | Aug 1 of 42 (2.4%); Sep 16 of 148 (10.8%); Oct 30 of 169 (17.8%, partly immature) | none |
| Exporters ever / renders / renders per exporter | 49 / 185 / 3.78 | none |
| Time to first render (n 49) | p50 15.9 min, p75 49.4 min, p90 1,394 min (23 h) | p90 was reported 9 h; this cut uses all 49 exporters |
| Payers / purchases / gross / refunds | 4 / 5 / $75.95 / $0 | none |
| Pack mix | best_value 4 ($71.96: three at $12.99 pre-reprice, one at $32.99 post), starter 1 ($3.99) | detail new |
| Purchases by month | Jul 1 ($12.99), Aug 1 ($3.99), Sep 2 ($25.98), Oct 1 ($32.99) | detail new |
| Purchases since 2026-10-24 reprice | 1 ($32.99), by a user who signed up before the reprice | was 0 |
| Days sign-up to first purchase (n 4) | 0, 0.2, 1.4, 16.5 (insufficient data) | none |
| Payers who rendered | 4 of 4 | none |
| Money ladder, sign-ups since reprice (n 52) | uploaded 14, rendered 7, paywall 1, buy modal 1, purchased 0 (insufficient data) | n/a |
| Money ladder, all time (distinct users) | upload succeeded 143, rendered 49, paywall shown 1, buy modal 1, payment started 6, purchased 4, downloaded 9, shared 5 | n/a |
| 30-day daily counters | exports_started 0, exports_completed 47, overlay_exports 46, framing_exports 0, credits_consumed 58, video_downloads 20, paywall_shown 1, buy_modal_opened 5, credit_purchases 1 | n/a |
| Repeat renderers | 4 of 47 with usage active in 2+ months; 0 of 47 active 120+ days after first use | was 6 of 190 on a different base |
| K-factor | 3 referred of 379 = 0.008; 9 referral rows; 22 shares by 9 sharers; 153 share views by 7 users; 0 claims | none |
| Upload outcomes, 90 days | 393 succeeded / 120 failed = 23.4% (N 513) | was 365 / 84 = 18.7% |
| Upload outcomes, 30 days | 204 succeeded / 82 failed = 28.7% (N 286) | new |
| Terminal upload failure rows, 90 days, by file size | unknown size 78 rows (8 users); under 2 GB 66 (17 users); 2 to 8 GB 19 (8 users); 16 GB+ 7 (4 users); 8 to 16 GB 1 | the "16 to 19 GB worst class" claim is not supported by row counts; rows include retries |
| WAU, last 4 full weeks | 34, 33, 28, 37 | none |
| Games uploaded / uploaders / per sign-up | 368 / 143 / 0.97 | model doc had 0.52 |
| Sign-ups that uploaded a game | 143 of 379 = 37.7% | n/a |
| UTM coverage | 0 of 379; origin organic 379 of 379; click_source empty | none |
| Search Console, Oct 2026 | 129 clicks (40 brand), 2,360 impressions, average position about 13 | 2026-10 export, unchanged |
| GPU per play, storage per game, Stripe | $0.025, $0.05, 2.9% + $0.30 | F |

Seasonality: not assumed. The weekly series (29 to 42 over eight weeks) shows no trend either way; the Aug to Sep step is the late-summer surge, not a seasonal shape.

## Findings from the refresh

1. Upload failure is rising, not falling: 28.7% of attempts in the last 30 days against 23.4% over 90 days and 18.7% in the model doc. By row count the failures are small or unknown-size files, not 16 to 19 GB files. This is the top near-term lever and it would poison any paid cohort's export rate.
2. The paid render still records no export event (`exports_started` 0 in 30 days); T14710 remains the prerequisite for a true export rate.
3. The post-reprice money ladder is still unusable (52 sign-ups, 1 paywall user, 0 purchases from that cohort).
4. Games per sign-up is 0.97, nearly double the model doc input, so the storage cost line roughly doubles (still small).

## Fixed infrastructure cost evidence found in the repo (none are bills)

| Item | Evidence | Label |
|---|---|---|
| Fly API machine, prod | `src/backend/fly.production.toml`: 1 dedicated (performance) vCPU, 4096 MB, `min_machines_running = 1`, single machine, region lax | M (config) |
| Fly API machine, staging | `src/backend/fly.staging.toml`: same VM block, `min_machines_running = 0` | M (config) |
| Fly price scale in planning docs | `docs/plans/tasks/deployment/T105-production-backend-scaling.md`: dedicated-1x 2 GB about $30/mo, dedicated-2x 4 GB about $60/mo; stale | A |
| Fly Postgres | `docs/plans/tasks/for-launch/T1960-migrate-auth-to-fly-postgres.md`: planned 256 MB about $2/mo; actual size unverified | A |
| Modal | T4 GPU functions, `MODAL_GPU_CONCURRENCY_LIMIT = 10` (Starter plan), no warm containers found; plan fee not in repo | M (config) |
| GPU per framing export | `docs/plans/revenue-projection-2000-users.md`: about $0.003 per exported second on T4 | benchmark in repo |
| R2 | $0.015/GB/month, egress $0; Cache Reserve $5/mo if enabled (unverified) | B/A |

Could not find: any invoice or monthly total for Fly, Modal, Cloudflare, R2 or Stripe fees; the Modal plan fee; domain, email-sending or other subscriptions. The fixed line stays an assumption until the owner reads the billing pages.

## What this does not show

No landing visits, no country or arrival-sport split on sign-ups, no post-reprice money ladder with a usable denominator, no 120-day repeat behaviour, no actual infrastructure spend. Payer-level figures (n = 4) cannot support rates or distributions.
