# ReelBallers revenue outlook (2026-11-04, refreshed on live prod data)

Labels: M measured (date, window, N), F founder estimate, B public benchmark (source, year), A assumption (reason). A derived number carries the weakest label of its inputs. Under 20 in a denominator is written "insufficient data (n = ...)". Month 1 = November 2026 (A). No seasonal index anywhere; seasonality is an output of weekly sign-ups per arrival sport once T14930 exists.

**Data source.** Read-only prod aggregate pull at **2026-11-04 19:02 UTC**: 379 real sign-ups, 7 test accounts excluded, admin accounts not excluded. Every M value below is from that pull unless dated otherwise. This file replaces the v1 of the same date, which was built on the 2026-11-03 pull.

## Status and missing inputs (read first)

| # | Missing input | Assumption used here |
|---|---|---|
| 1 | Bills | **Resolved 2026-11-04 (owner-reported, M):** Cloudflare under $20, Fly under $40, Modal $0 so far (free allowance not yet hit), Resend $20, Claude $100 a month. Fixed infrastructure **$80 a month**, tooling **$100 a month** (the earlier draft assumed $100 and $200). Because Modal is still free, today's $0.025 per play GPU line is $0 cash until the allowance is hit |
| 2 | Post-reprice money ladder: 52 sign-ups since 2026-10-24, 1 paywall user, 1 buy modal, 0 purchases (M; insufficient data, n = 1) | Wall and wall-to-purchase from the model doc (40% and 20% after fixes, 60% and 25% optimistic, F) |
| 3 | Sign-ups by country and by arrival sport (T14930 not built; no country column; UTM coverage 0 of 379, M) | Not split. Only October search clicks are split: 60% US, 40% non-US (M, 129 clicks, Search Console Oct 2026) |
| 4 | Landing visits (no beacon, T7410) | Visit-to-sign-up unknown; the section 5 test is designed to measure it |
| 5 | Club and coach partnerships: what they are, cost, exposure, funnel translation. Research pending in `channel-research-2026-11-04.md` (not available to this rebuild). | **Not modelled** (owner rule 2026-11-04). Removed from every scenario column; shown as a "research pending" row |
| 6 | Camera-brand community posts: no measured or benchmarked reach | Not modelled, same row |
| 7 | Upload failure root cause by size: 78 of 171 terminal failure rows in 90 days have unknown file size (M) | Treated as a product bug of unknown shape; no size class singled out |
| 8 | Owner hourly value | $50 per hour, 40-hour FTE week = $2,000 per week (A, illustrative; also shown at $0) |
| 9 | Engineering effort in weeks | Task-size estimates from PLAN.md complexity scores (A) |
| 10 | AI agent tooling cost | $200 per month (A) |

## Answers in three lines

1. **Realistic revenue:** about **$29 per month today** (contribution $18), **$69 after the fix list** (contribution $51), **$439 optimistic** (contribution $391). All A at best: volume is a run-rate assumption, the rates are F, and partnerships are no longer counted. The optimistic column fell from $693 (v1) to $439 because its 150 partnership-sourced sign-ups a month are out.
2. **Marketing that goes into it:** $0 scaled paid. Referral loop and SEO only (both near $0 cash), plus the $1,000 Meta/Instagram measurement test in section 5, which is a measurement purchase, not a growth channel. Partnerships and camera-brand community posts wait for the channel research.
3. **Upfront investment:** about 6 owner weeks plus about 14.5 agent weeks of engineering, and about **$2,080 cash at 6 months, $3,160 at 12 months** (infrastructure $80, tooling $100, the $1,000 test), before valuing owner time. The optimistic path with owner time at $0 crosses zero cumulative net in **month 13 (November 2027)** at the measured fixed costs; it was month 30 under the earlier $300 a month assumption.

## 1. Revenue per month, three scenarios

### Which organic run rate is realistic

| Window | Sign-ups | Label |
|---|---|---|
| May, Jun, Jul 2026 | 2, 2, 2 | M, 2026-11-04 |
| Aug 2026 | 42 | M |
| Sep 2026 | 148 | M |
| Oct 2026 | 169 | M |
| Nov 1 to 4 (4 days) | 14 | M, partial, not projectable |
| Last 6 full weeks (w/c Sep 21 to Oct 26) | 41, 42, 42, 39, 29, 35 (mean 38.0 per week = 165 per month) | M |
| Last 4 full weeks | 42, 39, 29, 35 (mean 36.3 per week = 158 per month) | M |
| Last 30 days / last 7 days | 152 / 29 | M |
| WAU, last 4 full weeks | 34, 33, 28, 37 | M |

The Aug to Oct shape is growth after the late-summer surge, not a season. Weekly sign-ups have held at 29 to 42 for ten weeks with no trend either way (w/c Oct 19 at 29 is the low, w/c Oct 26 recovered to 35). **Used: 150 organic sign-ups per month (A, rounding the 152 to 165 window down because the two most recent full weeks average 32); downside 120, upside 170.** Platform of those sign-ups: webapp-mobile 199, webapp-desktop 164, PWA 8, no session 44 (M; sums to 415 because a user seen on two platforms counts in each). The paid test must therefore be read on mobile first.

### Funnel today (the base every column is built from)

| Stage | Value | Label |
|---|---|---|
| Sign-ups | 379 | M, all time |
| Uploaded a game | 143 (37.7%); 368 games = 2.57 per uploader, **0.97 per sign-up** | M (v1 and the model doc carried 0.52 per sign-up; the fresh value doubles the storage line) |
| Upload failure rate | **28.7% last 30 days** (82 of 286); 23.4% over 90 days (120 of 513) | M. Worse than the 18.7% in the model doc. See the finding below |
| First render within 14 days, mature cohorts (signed up 14+ days ago) | **12.5%** (40 of 321) | M, "today" rate |
| Same, last 100 mature sign-ups | 16.0% (16 of 100) | M, recent read; the Oct cohort shows 17.8% (30 of 169) but part of it is immature |
| Exporters ever / renders | 49 / 185 = 3.78 renders per exporter | M |
| Time to first render | p50 15.9 min, p75 49 min, p90 1,394 min (n = 49) | M |
| Payers / purchases / gross / refunds | 4 / 5 / $75.95 / $0 | M, insufficient data (n = 4) |
| Revenue per payer | $18.99; purchases per payer 1.25 | M, insufficient data (n = 4) |
| Pack mix | 4 best_value (three at $12.99 pre-reprice, one at $32.99 post-reprice), 1 starter $3.99 | M |
| Purchases since the 2026-10-24 reprice | 1 ($32.99), by a user who signed up before the reprice | M, insufficient data (n = 1) |
| Days from sign-up to first purchase | 0, 0.2, 1.4, 16.5; all 4 payers rendered | M (n = 4) |
| Payers per 100 sign-ups / per exporter | 1.06 / 8.2% | M, insufficient data (n = 4) |
| Repeat | 4 of 47 renderers active in 2+ months; 0 of 47 active 120+ days after first use (product too young) | M |
| Referrals | 3 referred sign-ups of 379, **K = 0.008**; 9 referral rows; 22 shares by 9 sharers; share views by 7 distinct users (153 view events); 0 claims | M |
| Attribution | UTM on 0 of 379; origin "organic" 379 of 379; click_source empty for all | M |
| Money ladder since reprice, by sign-up date | 52 signed up, 19 upload attempted, 14 succeeded, 7 rendered, 1 paywall, 1 buy modal, 0 purchases | M, insufficient data |
| 30-day daily counters | exports_started 0 (T14710 not shipped), exports_completed 47, overlay_exports 46, framing_exports 0, credits_consumed 58, video_downloads 20, paywall_shown 1, buy_modal_opened 5, credit_purchases 1 | M. The export counters are overlay-only until T14710 ships; credits_consumed is the honest render count |

**Finding: upload failure is the top near-term lever and it is not a large-file problem.** Terminal failure rows in 90 days by file size (rows include retries): unknown 78 rows (8 users), under 2 GB 66 rows (17 users), 2 to 8 GB 19 rows (8 users), 16 GB+ 7 rows (4 users), 8 to 16 GB 1 row (1 user). The largest class by users is under 2 GB, and the largest by rows has no recorded size. The earlier "16 to 19 GB worst class" claim is not supported by these counts; the 16 GB+ message is still worth shipping but it is not the fix. Up to 38 distinct users hit a terminal failure in 90 days (if the classes do not overlap) against 143 uploaders ever, and the Journey map's "Add footage" stage loses 100 of 277. Getting failures under 10% (gate 3) is the cheapest way to lift the 37.7% uploader rate, which every later rate multiplies. It also decides whether the section 5 test can run: a paid cohort landing on a 28.7% failure rate would report an export rate nobody can attribute to traffic quality.

### Build-up (monthly, steady state)

| Line | Today (M rates) | After fix list (F) | Optimistic (F) |
|---|---|---|---|
| Organic sign-ups | 150 (A) | 150 (A) | 150 (A) |
| Added by SEO (near-free; soccer page at 17.9 and the how-to query at 30 reaching page 1, per-sport how-to pages) | 0 | +15 (A: about 150 extra non-brand clicks a month at a 10% visit-to-sign-up, both A) | +40 (A: per-sport pages, about 400 extra clicks at 10%) |
| Club and coach partnerships | 0 (researched, section 6: $33 to $400 per sign-up written out, all conversion rates A; not a scalable source at break-even CAC $0.12 to $1.54) | 0 (same; coach-code and local-booth experiments are measurements, not volume) | 0 (same) |
| Camera-brand community posts | 0 (researched, section 6: no group sizes or rules recorded; not modelable) | 0 | 0 |
| Referral K | 0.008 (M, 3 of 379) | 0.05 (A, below the 0.25 target) | 0.25 (F target) |
| Paid cohort | 0 | 0 | 0 (see below) |
| **Total sign-ups** = (organic + added) / (1 minus K) | **151** | **174** | **253** |
| First render within 14 days | 12.5% (M, mature cohorts; last 100 at 16.0%) | 25% (F) | 33% (F) |
| Exporters | 18.9 | 43.4 | 83.6 |
| Hit the wall | 10% (A, circular from 8.2% payers per exporter) | 40% (F) | 60% (F) |
| Wall to purchase | 80% (M, n = 4, insufficient data) | 20% (F) | 25% (F) |
| Payers | 1.5 | 3.5 | 12.5 |
| Revenue per payer | $18.99 (M, n = 4, insufficient data) | $20 (F) | $35 (F) |
| **Revenue per month** | **$29** | **$69** | **$439** |
| GPU ($0.025 per play, F; 3.78 / 5 / 7 plays per exporter, M / A / A) | -$1.8 | -$5.4 | -$14.6 |
| Storage ($0.05 per game, F; 0.97 / 1.15 / 1.30 games per sign-up, M / A / A) | -$7.3 | -$10.0 | -$16.5 |
| Stripe (2.9% + $0.30; 1.25 / 1.1 / 1.2 purchases per payer, M / A / A) | -$1.4 | -$3.2 | -$17.2 |
| **Contribution per month** | **$18** | **$51** | **$391** |
| Fixed infrastructure (M, owner-reported 2026-11-04: Cloudflare, Fly, Modal, Resend) | -$80 | -$80 | -$80 |
| **Net per month before investment and tooling** | **-$62** | **-$29** | **+$311** |
| Label of the net | A | A | A |

Per sign-up (the numbers the paid decision hangs on): contribution **$0.120 today, $0.293 after fixes, $1.542 optimistic** (v1: $0.151 / $0.317 / $1.560; the drop is the storage line at 0.97 games per sign-up). Break-even CAC per sign-up equals those figures, since purchases happen at a median of 0.8 days from sign-up (M, n = 4) and there is no payback curve to wait for.

Pricing is unchanged in all three columns (pay for the AI you use, 48 free credits, Season pack first). Any price change is against the owner's stance until 30 days of data at the 48-credit allowance exist; post-reprice purchases are at n = 1.

Why a paid cohort is zero in all three: contribution per sign-up is below the benchmark $9 to $58 Meta cost per sign-up (B, Triple Whale, Influee, WordStream, TrendTrack 2025) in every state. Illustration: $1,000 a month of Meta at $23 buys about 43 sign-ups and returns $67 of contribution in the optimistic state, net -$933 (A).

### Fixed cost lines (M, owner-reported 2026-11-04)

| Item | Per month | Note |
|---|---|---|
| Cloudflare (R2 storage, Worker, Pages) | under $20 | R2 is recurring at $0.015 per GB per month; 368 games fit inside this bill today |
| Fly (API machine, Postgres) | under $40 | performance 1 vCPU, 4 GB, always on |
| Modal (GPU) | $0 so far | free allowance not yet hit; the $0.025 per play variable line becomes cash once it is |
| Resend (email) | $20 | |
| **Fixed infrastructure** | **$80** | |
| Claude (AI agent tooling) | $100 | counted as tooling in section 3, not infrastructure |
| **Fixed cost, total** | **$180** | the earlier draft assumed $300 ($100 infrastructure A plus $200 tooling A) |

### Ceiling view: does volume or conversion bind?

| Question | Today rates | After fixes | Optimistic |
|---|---|---|---|
| Contribution per month from today's volume (151 sign-ups, K 0.008) | $18 | $44 | **$233** |
| Sign-ups per month needed for net +$1,000 (contribution $1,080 incl. $80 infra) | 9,000 | 3,690 | **700** |
| Sign-ups per month needed for net +$5,000 | 42,300 | 17,300 | **3,290** |

Reading: even at optimistic conversion, current organic volume tops out near $233 contribution a month, under infrastructure plus tooling. Conversion matters (optimistic is 13 times today per sign-up), but **volume binds first**: net +$1,000 a month needs about 4.7 times today's sign-ups at optimistic rates, and +$5,000 needs about 22 times. With partnerships unmodelled, the only sign-up sources in the model are organic, SEO and referral, which is why the optimistic column stops at 253 sign-ups. All A (rates F).

### Single biggest uncertainty per scenario and what resolves it

| Scenario | Biggest uncertainty | Measurement that resolves it |
|---|---|---|
| Today | Whether 150 a month holds (two most recent full weeks average 32 per week, n = 2 weeks) and whether the 28.7% upload failure is rising | Weekly sign-ups and the 30-day upload failure rate read weekly from the admin Journey tab (T14720 keeps counts honest) |
| After fixes | Whether first render reaches 25% once uploads stop failing, and whether the 20% wall-to-purchase is real (post-reprice n = 1) | T14710 export event, T14840 download unblocked, upload failure under 10%, then T14910 gate 5: at least 20 paywall users and 5 purchases since 2026-10-24 |
| Optimistic | K of 0.25 and $35 per payer: K measured 0.008, 22 shares and 153 share views produced 0 claims | Share end card live, then referred sign-ups over total (gate 9) on 500 sign-ups (section 5, option B); repeat purchase at 120+ days, first reading with 20+ eligible payers around May 2027 |

## 2. Marketing plan per scenario

### Cost per sign-up by channel

| Channel | Cost per sign-up | Label | Cash cost | Status in this model |
|---|---|---|---|---|
| Referral loop and share end card | $0 | M (K 0.008); 0.25 is F | $0 | modelled (K row) |
| SEO content | $0 cash | A | owner and agent time | modelled (+15 / +40) |
| Club and coach partnerships | unknown | not researched | unknown | **not yet modelled, research pending** (`channel-research-2026-11-04.md`) |
| Camera-brand community posts (interest only, no vendor integration implied) | unknown | no measured or benchmarked reach | owner time | **not yet modelled, research pending** |
| Meta / Instagram (paid) | $9 to $58, mid $23 | B, 2025 | $1,000 measurement test only (section 5) | test only |
| TikTok | $10 to $50, mid $22 | B, 2025 | none | not in round one |
| Google search | $12 to $105, mid $36 | B, 2025 | $0 | $0 until sport pages rank on page 1 (about 90 non-brand clicks a month in Oct 2026, M) |
| YouTube, micro-influencer, tournament QR | $20 to $170 | B/A | none | not before gates 6 to 8 |

### Plan by scenario

| | Today | After fix list | Optimistic |
|---|---|---|---|
| 1 | Share end card and referral nudge only (K 0.008 to measure) | Same, plus a visible share path after the highlight is made | Share end card as the main growth loop, target K 0.25 |
| 2 | None | SEO: fix title and snippet on the Trace page (210 impressions, 1 click at position 7.7, M Oct 2026), improve the soccer page (position 17.9) and the how-to query (position 30), one how-to page per sport; decide improve or drop for pages at position 60+ | Same, per sport as T14930 shows where arrival volume is |
| 3 | None | The $1,000 measurement test (section 5), only when its prerequisites have shipped and T14910 says TEST ONLY | Same test; no scale decision from it |
| 4 | None | Partnerships and camera-brand posts: decide after the channel research | Same |
| Paid at scale | $0 | $0 | $0 until a channel is under $1.54 per sign-up |

### Measurement prerequisites (each is a task already in PLAN.md)

| Prerequisite | Task | Status 2026-11-04 |
|---|---|---|
| Landing visit beacon passing ref and utm to sign-up | T7410 | TODO |
| Attribution survives internal landing navigation | T15000 | TODO |
| Converting landing page stored at sign-up | T15010 | BLOCKED by T15000 |
| Campaign id in every ad URL (admin registry, pg v038 `campaigns`) | shipped per the model doc | done |
| Export event from the paid render path | T14710 | WIP |
| Download unblocked | T14840 | bug, filed |
| Upload failure under 10% (28.7% today, N = 286, 30 days) | T14800, T14810, T9000, T14530/T14540 (STAGING), T10350 | mixed |
| Arrival sport on sign-ups | T14930 | TODO |
| Readiness verdict (NO / TEST ONLY / SCALE) | T14910, then T14960 for the Visited head node | TODO |

### Creative angles (within the copy rules; the parent frames and picks, the AI sharpens)

- "You film. You pick the play. We sharpen it."
- "Downloaded your game file? Make tonight's highlight in 15 minutes."
- "No public feed. Only the links you send."
- "No subscription. About fifty cents a play."

## 3. Upfront investment

Effort in weeks (A). Agent weeks are AI agent engineering effort; owner weeks are 40-hour FTE equivalents for decisions, human tests and review. Engineering is the owner plus AI agents.

| Work group | Tasks | Agent weeks | Owner weeks | Cash |
|---|---|---|---|---|
| Fix list | T14710 to T14840 | 4.0 | 1.5 | $0 |
| Upload failure under 10% (new, from the finding above) | T14800, T14810, T9000, T10350 | 2.0 | 0.75 | $0 |
| Spend readiness | T14900 to T14960 | 3.0 | 0.75 | $0 |
| Attribution | T15000, T15010 | 0.75 | 0.25 | $0 |
| Analytics epic (season constants reworked out of T7430 and T7460) | T7400, T7410, T7430, T7460 | 3.0 | 0.75 | $0 |
| SEO content | per sport pages, snippets | 1.5 | 1.0 initial, then 0.1 per month | $0 |
| $1,000 measurement test (section 5) | after prerequisites | 0.25 | 0.5 | $1,000 |
| Resume where you left off (not on the revenue path; excluded from the totals) | T14970 to T14990 | 3.0 | 0.75 | $0 |
| Partnerships materials and outreach | research pending | not estimated | not estimated | not estimated |
| Tooling (Claude) | | n/a | n/a | $100 per month (M, owner-reported) |
| Fixed infrastructure (Cloudflare, Fly, Modal, Resend) | run rate | n/a | n/a | $80 per month (M, owner-reported) |

### Totals (after-fixes and optimistic paths; the today column spends only infrastructure)

| Horizon | Owner weeks | Cash out (tooling, test, infra) | Owner time at $50 per hour |
|---|---|---|---|
| 6 months | 6.0 | $2,080 | $12,000 |
| 12 months | 6.6 | $3,160 | $13,200 |
| 24 months | 7.8 | $5,320 | $15,600 |

Engineering agent weeks total about 14.5 across the six revenue-path groups (A). Ramp assumed: months 1 to 3 at today's rates while the fixes ship, months 4 to 6 half way to the scenario, month 7 onward full (A). The test is funded in month 4 (A: after the prerequisites, about two months of agent work). Fixed cost $180 a month ($80 infrastructure plus $100 tooling, M) runs for the whole horizon.

### Cumulative net against the revenue in section 1

| Scenario | Owner time valued at | 6 months | 12 months | 24 months | 36 months | Crosses zero? |
|---|---|---|---|---|---|---|
| Today (no investment, infrastructure only) | $0 | -$372 | -$744 | -$1,488 | -$2,232 | never |
| After fixes | $0 | -$1,923 | -$2,697 | -$4,245 | -$5,793 | never ($51 contribution against $180 a month) |
| After fixes | $50 per hour | -$13,923 | -$15,897 | -$19,845 | -$23,793 | never |
| Optimistic | $0 | -$1,413 | -$147 | +$2,386 | +$4,918 | **month 13 (November 2027)** |
| Optimistic | $50 per hour | -$13,413 | -$13,347 | -$13,214 | -$13,082 | not within 36 months |

Volume and rates are A and F; the fixed cost is now M (owner-reported). The crossing moved from month 30 to month 13 when the fixed cost fell from an assumed $300 to a measured $180 a month. v1 had the optimistic path crossing at month 15 with 150 partnership-sourced sign-ups a month that are now unmodelled.

## 4. Verdict

At today's numbers ReelBallers is neither a business nor side income: it earns about $29 revenue and $18 contribution a month against $80 of infrastructure and $100 of tooling, so it loses roughly $162 a month before anyone is paid. After the fix list it is still under break-even ($51 contribution against $180). The optimistic stack (33% first render, 60% wall, 25% purchase, $35 per payer, K 0.25, 253 sign-ups a month) gets to about $310 a month net of infrastructure, about $210 after tooling, side income at best, and pays back the cash outlay in about 13 months with the owner's time valued at zero. Conversion alone cannot do it; current organic volume at optimistic rates caps near $233 contribution a month, so the product also needs several times today's sign-ups, and with partnerships unresearched the model has only referral and SEO to supply them. Paid acquisition does not change this: break-even CAC is $0.12 to $1.54 per sign-up against $9 to $58 on Meta. The value of building anyway is learning: the fix list, the upload failure fix and the measurement tasks cost mostly agent time and tell you cheaply which scenario is real, and the $1,000 test in section 5 buys the numbers (visit-to-sign-up, paid-cohort render rate, cost per sign-up by sport and geography) that this model currently has to assume.

**Two numbers to watch next:** the 30-day upload failure rate (28.7%, M, N = 286; gate 3 target under 10%) and first render within 14 days on mature cohorts (12.5%, M, N = 321; last 100 at 16.0%; gate 2 target 25%). Payers per 100 sign-ups (1.06, M, 4 of 379) stays insufficient data until 500 sign-ups have passed through the 48-credit allowance.

## 5. The $1,000 measurement test

Purpose: produce the numbers a high-confidence model needs, not revenue. The test is funded now and runs only after the prerequisites below ship; a test run before them produces a cost per sign-up nobody can interpret.

### Objective per dollar: which unknowns it resolves

| Unknown | Today | What the test measures | Can $1,000 resolve it? |
|---|---|---|---|
| Visit-to-sign-up (gate 1) | unknown, no beacon | paid visits per ad set (T7410) over sign-ups per utm_campaign; organic visit-to-sign-up concurrently | **Yes.** About 580 to 1,430 paid visits (B, CPC $0.70 to $1.72); at 1,000 visits and 5% the 95% interval is plus or minus 1.35 points, enough to tell 2% from 5% |
| Paid-cohort first render within 14 days against concurrent organic | organic 12.5% (M) | share of paid sign-ups with credits_consumed within 14 days (needs T14710) | **Partly.** See the sample-size arithmetic: 60+ paid sign-ups tell "near zero" from "like organic", not 10% from 12.5% |
| Cost per sign-up by sport interest (soccer vs other sports) and US vs non-US | none | spend over sign-ups per ad set | **Coarsely.** 7 to 12 sign-ups per ad set tells a 2x difference apart, not a 30% one; the reserve sharpens the winner |
| Creative that works | none | CTR and CPC per angle inside each ad set (Meta reports per creative) | **Yes for CTR.** At 3,000 impressions per creative a 1.2% CTR has a plus or minus 0.4 point interval; tells 0.6% from 1.5% |
| Upload success for a cold paid cohort | organic 71% of attempts succeed (M, 30 days) | upload attempted and succeeded per ad set | Yes as a comparison against organic, if the prerequisite fix has shipped |
| Payers per sign-up, revenue per payer | 1.06 per 100 (M, n = 4) | purchases in the paid cohort | **No.** At 1 to 5 payers per 100 sign-ups, 50 sign-ups yields 0.5 to 2.5 expected payers; the chance of seeing zero is 61% at 1 per 100 and still 8% at 5 per 100. Observed 0 to 3 payers is uninformative |
| K, repeat purchase | 0.008; unobservable | not measured by the ads | No (option B below measures K separately) |

### Prerequisites that must ship first (task ids)

| Prerequisite | Task | Why the test is unreadable without it |
|---|---|---|
| Landing visit beacon, ref and utm passed to sign-up | T7410 | Without visits there is no visit-to-sign-up, the one number only paid traffic can produce cheaply |
| Attribution survives internal landing navigation | T15000 | A parent who clicks the ad, reads the Veo page, then signs up from the home page is lost to "organic" today |
| Converting landing page at sign-up | T15010 | Tells which page converts paid traffic; needed to act on a low visit-to-sign-up |
| Export event from the paid render path | T14710 | `exports_started` is 0 in the last 30 days; without it the paid cohort's render rate cannot be read from the counters (credits_consumed is the fallback) |
| Download unblocked | T14840 | 8 of 19 finished highlights were never taken away; a paid cohort hitting that bug reads as low quality |
| Upload failure under 10% | T14800, T14810, T9000, T14530/T14540 | 28.7% of uploads fail today (M, 30 days, N = 286). A paid cohort landing on that would report a render rate that measures the bug, not the traffic |
| Campaign id per ad set in the admin registry | pg v038 `campaigns` (shipped) | One campaign id per ad set, carried as utm_campaign and utm_content=sport |
| Arrival sport on sign-ups | T14930 | Helpful, not blocking: the ad set's utm_content already carries the sport |
| T14910 verdict reads TEST ONLY | T14910 | Gates 1 to 5 green or yellow and gate 10 green |

### Budget split

| Line | Amount | Targeting (interest only; no vendor integration implied in copy) |
|---|---|---|
| Meta/Instagram, ad set 1: US, soccer | $175 | parents 32 to 50, youth soccer interests, Veo and Trace as interest targets |
| Ad set 2: US, other sports | $175 | parents 32 to 50, youth hockey, basketball, volleyball, lacrosse, football, rugby interests, camera-brand interests |
| Ad set 3: non-US (Canada, Australia, UK, South Africa), soccer | $175 | same as 1, non-US geos |
| Ad set 4: non-US, other sports | $175 | same as 2, non-US geos |
| Reserve, from week 3 | $300 | the ad set with the lowest cost per sign-up and a render rate at or above organic, or a second creative round if no creative reaches 1% CTR |
| Google search | $0 | the intent cluster is about 90 non-brand clicks a month across all sports at current rank (M, Search Console Oct 2026). At $1.50 to $5.26 per click (B, 2025) $300 buys 60 to 200 clicks, about 5 to 20 sign-ups, with no per-arm reading. SEO (soccer page at 17.9, how-to query at 30) is the search lever and costs $0 per click |
| **Total** | **$1,000** | |

Each ad set carries two creatives from the four angles below, placed on Instagram and Facebook feed and Reels, mobile first (52% of sign-ups arrive on webapp-mobile, M). Geographies stay separate so US and non-US export and sign-up rates can be compared; countries inside the non-US ad sets are reported separately by Meta and by the beacon.

### Duration and expected volume

| Quantity | Value | Label |
|---|---|---|
| Daily spend, weeks 1 to 4 | $25 total, $6.25 per ad set | A |
| Impressions per ad set per day | about 430 at $14.50 CPM | B, Triple Whale 2025 |
| Clicks per ad set per day | about 5 at 1.2% CTR | B |
| Sign-ups per ad set per week | about 1.8 at a 5% visit-to-sign-up | A (Unbounce 2024 medians) |
| Sign-ups from $700 in 4 weeks | 28 to 47 (at $25 to $15 per sign-up); about 7 to 12 per ad set | B/A |
| Sign-ups from the full $1,000 | 40 to 67 | B/A |
| Paid clicks (visits) from the full $1,000 | 580 to 1,430 | B |
| Flight | 6 weeks: $700 over weeks 1 to 4, reserve in weeks 5 to 6 | A |
| Read-out | week 8: the last paid sign-ups need 14 days to reach the render window | A |

Why 6 weeks: at $25 a day the four ad sets each get about 1.8 sign-ups a week, so 4 weeks is the minimum for 7 or more sign-ups per arm, and the reserve needs 2 more weeks to put 12 to 20 more sign-ups on the winning arm. Spending faster does not buy more information: Meta's learning phase wants about 50 conversion events per ad set per week, which this budget cannot reach at any pace, so the ad sets stay in learning and the test is read on our beacon and sign-up counts, not on Meta's optimisation. The 60+ paid sign-ups target is reached only if cost per sign-up is at or under about $17; at the $23 mid benchmark expect about 43.

### Sample size per number (arithmetic)

Two-proportion test, 5% two-sided alpha, 80% power: n per arm = (1.96 x sqrt(2 x pbar x (1 minus pbar)) + 0.84 x sqrt(p1 (1 minus p1) + p2 (1 minus p2)))^2 / (p2 minus p1)^2. One-arm against a known organic rate: n = (1.96 x sqrt(p0 (1 minus p0)) + 0.84 x sqrt(p1 (1 minus p1)))^2 / (p1 minus p0)^2.

| Question | Arithmetic | Sign-ups needed | Reachable at $1,000? |
|---|---|---|---|
| 10% vs 25% render rate, two arms of equal size | pbar 0.175; (1.96 x 0.537 + 0.84 x 0.527)^2 / 0.0225 | about 100 per arm | No (40 to 67 total) |
| 12.5% vs 25%, two equal arms | pbar 0.1875; / 0.0156 | about 152 per arm | No |
| Paid cohort at 25% vs known organic 12.5% (one arm, organic is large) | (1.96 x 0.331 + 0.84 x 0.433)^2 / 0.0156 | about 66 paid sign-ups | Borderline (needs cost per sign-up at or under $15) |
| Paid cohort at 5% vs organic 12.5% (the "traffic is junk" case) | / 0.0056 | about 123 | No as a significance test; at 60 sign-ups the 95% interval on a 12.5% observed rate is plus or minus 8.4 points, so the 60%-of-organic kill rule below is a point-estimate rule, not a proof |
| Visit-to-sign-up 2% vs 5%, one arm against a reference | (1.96 x 0.218 + 0.84 x 0.140)^2 / 0.0009 | about 330 visits | **Yes**, overall and per ad set (about 150 to 250 visits each) |
| CTR 0.6% vs 1.5% per creative | about 3,000 impressions per creative | about 3,000 impressions | **Yes** (each ad set serves about 12,000 impressions over 4 weeks) |
| Cost per sign-up differs 2x between ad sets | Poisson on 7 to 12 sign-ups per arm: plus or minus 60% | 7 to 12 per arm | Only for 2x or larger differences |
| Payers per 100 sign-ups, 1 vs 5 | one-arm needs about 240 sign-ups | 240 | No; at 50 sign-ups expect 0 to 3 payers |

### Daily read-out (one row per ad set plus one organic comparator row)

| Column | Source |
|---|---|
| Spend, impressions, CTR, CPC, clicks, frequency | Meta Ads Manager |
| Visits by campaign id and page class | T7410 beacon, `visit_daily` |
| Sign-ups by utm_campaign and utm_content (sport) | `user_segments` |
| Visit-to-sign-up, cost per sign-up (cumulative) | derived |
| Upload attempted, succeeded, failed in the paid cohort | ladder events |
| First render within 14 days (lagging: counted on the day the sign-up turns 14 days old) | credits_consumed, T14710 events |
| Finished to took away (download or share) | T14840 fix, ladder |
| Attribution coverage: paid sign-ups with a campaign id over Meta-reported conversions | derived; must stay above 95% |
| Organic comparators for the same day: sign-ups, upload failure, render rate | admin Journey tab |

No targeting or creative changes before day 7 except a kill. Reserve decision at day 14 and day 28.

### Kill criteria

| When | Rule | Action |
|---|---|---|
| Day 10 (about $250 spent) | Attribution coverage under 95% (paid sign-ups without a campaign id) | Pause everything; fix tracking; resume with the clock reset |
| Day 10 | Visit-to-sign-up under 2% on 300+ paid visits | Pause everything; fix the landing page (T15010 shows which page lost them) before spending more |
| Day 10 | An ad set at $100+ spent with under 2 sign-ups | Pause that ad set; its budget goes to the others |
| Day 10 | Upload failure in the paid cohort above 20% | Pause; the prerequisite fix is not holding |
| Day 30 (about $700 spent) | Cost per sign-up above $40 overall | Stop; the channel is dead at this landing page; do not spend the reserve |
| Day 30 | Paid-cohort render rate under 60% of concurrent organic on 30+ paid sign-ups that are 14+ days old | Stop; traffic quality kills the channel; do not spend the reserve |
| Day 30 | No creative above 1% CTR | Reserve goes to a second creative round, not to scale |
| Day 30 | None of the above | Reserve goes to the best ad set through day 42 |
| Always | Zero payers from 60+ paid sign-ups | No scale decision either way; payers are out of reach at this budget |

### Decision tree after the test (read-out at week 8)

| Outcome | What it means for the model |
|---|---|
| Visit-to-sign-up at or above 5% on paid traffic and organic | Gate 1 turns green; cost per sign-up is driven by CPC; the landing page is not the leak |
| Visit-to-sign-up under 2% | The landing page is the leak; the fix list gains a landing task before any further spend; cost per sign-up is not yet a channel verdict |
| Cost per sign-up at or under $20 and render rate at or above 60% of organic | Meta is a working but unprofitable channel (break-even $0.12 to $1.54). Replace the B row with the M value; no scale; retest only when gates 6 to 8 are green and break-even CAC rises past the measured cost |
| Cost per sign-up at or under $20 and render rate under 60% of organic | Paid traffic is low intent for this product; drop Meta from the model; growth stays referral and SEO |
| Cost per sign-up above $40 | Meta is dead at this landing page and price; the channel row moves to "not viable" |
| One sport or geo arm at half the cost per sign-up of the others | That arm's sport and geography become the first SEO and (later) retest target; T14930 arrival sport confirms it in organic |
| Non-US arm converts like US | The 40% non-US share of search clicks is real demand; SEO pages get non-US spellings and camera-brand pages |
| Any outcome | Organic visit-to-sign-up from the same beacon becomes gate 1's value; the paid cohort's upload failure rate is a second read on gate 3 |

### Creative angles (copy rules: the parent frames and picks, the AI sharpens; game / play / highlight; athlete)

- "You film. You pick the play. We sharpen it."
- "Downloaded your game file? Make tonight's highlight in 15 minutes."
- "No public feed. Only the links you send."
- "No subscription. About fifty cents a play."

Never: "auto-tracks", "follows your athlete", "AI frames the play", "clip", "player".

### Alternative split: $700 Meta plus a $300 non-ad experiment

| | Option A: $1,000 Meta | Option B: $700 Meta + $300 K experiment |
|---|---|---|
| Meta | 4 ad sets at $175 plus $300 reserve, 6 weeks | 4 ad sets at $175, 4 weeks, no reserve |
| Non-ad experiment | none | Share end card and a "Make your own highlight" prompt on share pages (T11510 and the share page), live on the same day the ads start; measure referred sign-ups over total on a 500 sign-up window (about 3.3 months at 150 a month). The $300 is a referral reward pool (credits are cost-based at about $0.025 per play GPU, so $300 covers far more than the window needs; most of it stays unspent). **Flag:** free credits as a reward change the referred user's free allowance, which is pricing-adjacent and against the owner's stance until the 48-credit data exist; the end card with no reward is the default and measures K at $0 |
| Unknowns resolved | visit-to-sign-up (well), CTR (well), cost per sign-up by arm (coarsely, sharpened by the reserve), paid render rate (coarsely) | the same minus the reserve's sharpening, plus **K**: at 500 sign-ups, K 0.05 produces about 25 referred sign-ups against 4 at 0.008, which is unmistakable (two-proportion n for 0.8% vs 5% is about 230 per arm; the pre-launch 379 sign-ups are the control) |
| What the reserve would have bought | 12 to 20 more sign-ups on the best arm: narrows its cost per sign-up interval from about plus or minus 60% to about plus or minus 40% | |

**Recommendation: Option B.** The reserve's marginal information (one arm's cost per sign-up a little tighter) is small; K is the input that decides whether the optimistic column is reachable at all (K 0.25 is the difference between 190 and 253 sign-ups a month in section 1, and the only $0 channel in the model). Option B resolves one more unknown for the same $1,000, and the K experiment needs engineering more than cash, so the $300 is mostly held, not spent. Run the Meta flight at $700 over 4 weeks; if an arm comes in at or under $15 per sign-up and the owner wants the sharper read, top it up later from a separate decision.

## 6. Channel research: what "partnership" and the other near-free channels actually cost

Source: `channel-research-2026-11-04.md` (web research 2026-11-04, one table per channel, sources and years inside). Cold-click sign-up rate 4% (A, Unbounce SaaS median 3.8%, no beacon yet); warm 10% (A). Every channel below is written out as reach x see x click x sign-up.

| Channel | What it concretely is | Cost | Exposure per unit | Expected sign-ups | Per $100 / per 10 owner h | Evidence grade |
|---|---|---|---|---|---|---|
| Paid club sponsor packet | A club's published sponsor tiers (real example: Bolingbrook SC 2025-27, ~1,175 athletes, 2,200 followers; Bronze $250 = 1 email blast + 1 social post + banner; Gold $1,250 = footer on all emails) | $250 to $1,250 cash (B, packet PDF) | ~900 families emailed once; 1.27% click (B, MailerLite 2025 sports) | ~1.3 per Bronze, ~3 per Gold | 0.5 / 0.25 per $100 | cost B, reach B, sign-up A |
| Negotiated free placement | Pitch a club to include a link in an end-of-season email for free; 1 in 5 accept (A) | ~15 owner hours per club placed | same email reach | ~0.9 per club; 2 to 3 if the email carries a "free highlight of your athlete" offer (A) | 0.6 per 10 h | acceptance rate A |
| Coach referral code in team chat | A coach posts a code to the team group chat | owner hours only | 16 families x 80% see x 15% click x 10% sign up (all A) | ~0.19 per team post, ~1.7 per club | ~3.8 per 10 h | all A; cheapest experiment in the list |
| Local tournament booth | 10x10 vendor space at a local youth tournament (125 teams, ~3,000 visitors) | $50 to $325 fee (B, 2024-26 packets) + an owner weekend | pass, stop, scan chain all A | ~12 per weekend | 4 to 12 per $100 of fee; ~6 per 10 h | fee B, attendance B, conversion A |
| Destination tournament booth | NASSC, Dallas Cup class events (~500 teams, 23k single-day attendance 2025) | $800 to $2,000 (B where published; Dallas Cup and Jefferson Cup unpublished) | larger foot traffic | ~36 per event | ~2 per $100; ~12 per 10 h | fee partly A |
| QR banner only (no booth) | Signage add-on at a tournament ($300 NASSC add-on) | $300 | passive signage scans "low to mid single digit %" (vendor, 2025); no scan-to-sign-up data anywhere | ~2.7 per weekend | ~1 per $100 | scan rate weak B |
| Camera-brand communities | Veo and Trace user groups: none surfaced via web search (Facebook groups are not indexed); no Veo-camera subreddit; r/youthsoccer 5k to 13k; no app marketplace at Veo, Trace, Hudl or Pixellot; Veo's "partner portal" is a sales-referral program | owner hours | ~0.6 per subreddit post (A); ~1.2 per post in a hypothetical 5k Veo group (B-weak) | tiny | n/a | **not modelable** until the owner records group sizes and posting rules from inside Facebook |
| Micro-influencer (parent creators) | Paid Reel from a youth-sports parent creator | IG nano $20 to $200 per post, micro $35 to $450 (B, 2025 rate cards); TikTok $5 to $1,250 | story link CTR 0.5 to 2% (vendor, "no clean benchmark", 2026); no sign-up conversion benchmark exists (Modash 2026) | ~2.4 per $300 Reel; gifted nano ~0.6 per post | 0.8 per $100 | rates B, conversion none |
| Revenue-share partnership | What Veo, Trace, XbotGo, LeagueApps actually do: hardware discounts through association emails, $100 gift card per referred team (Trace, cap 3), 5% + coupon (XbotGo), rev share undisclosed (LeagueApps, photo vendors 10 to 20% of sales by forum anecdote) | unknown | unknown | unknown | n/a | no published terms anywhere |

**What this changes.** (1) Written out, every cash channel costs $33 to $400 per sign-up (0.25 to 3 per $100), and the differences between them sit inside assumption error. The local tournament booth is the cheapest at $8 to $25 per sign-up in fees, before counting the owner's weekend, and its whole conversion chain is assumed. Against a break-even CAC of $0.12 to $1.54 none of them pays back, so partnerships stay out of the scenario columns on the evidence, not for lack of research. (2) The two cheapest experiments are the coach referral code (owner hours only, all A, ~1.7 sign-ups per club) and a local booth ($50 to $325); each is a measurement, not a channel. (3) The referral benchmark sets a ceiling the optimistic column ignores: Extole's consumer medians are a 4.9% share rate and 11% acquisition per advocate, which gives K about 0.0055, almost exactly today's 0.008. Viral Loops calls 0.15 to 0.25 "good", but that is for products used daily. ReelBallers' share page converted 0 of 153 views to a claim, so the first referral fix is the share page, not an incentive. **Sensitivity:** the optimistic column at K 0.05 instead of 0.25 is 200 sign-ups, about $347 revenue and $309 contribution a month, net about +$229 after infrastructure; the 0.25 case should be read as a bound. (4) The one number that moves every funnel above is the cold sign-up rate on reelballers.com (4% A). The T7410 beacon measures it for $0; the section 5 test measures it on paid traffic.

## 7. Orchestrator once-over (what the model still gets wrong or cannot know)

1. **Storage is recurring, the model treats it as one-off.** $0.05 per game (F) is charged once; R2 bills $0.015 per GB per month for as long as a game is kept. Resolved by the owner's bills: the whole Cloudflare line is under $20 a month today, so 368 games fit inside it; the recurring shape matters only if stored footage grows several-fold before credit expiry reclaims it.
2. **Three of the six scenario inputs cannot be bought with cash.** Wall rate and wall-to-purchase need 20+ paywall users and 5+ purchases at the 48-credit allowance (product and time: more renderers, which upload failure under 10% and T14840 deliver); K needs the share end card and a 500 sign-up window (about 3.3 months); repeat needs 120+ days and 20+ eligible payers (May 2027 at the earliest). The $1,000 test resolves visit-to-sign-up and CTR well, cost per sign-up and paid render rate coarsely, and nothing on payers.
3. **The test should split on geography, not sport.** Sport will be readable from organic once T14930 ships; country is not readable from organic at all (no country column), so paid traffic is the only cheap way to get a US vs non-US number. Refinement to section 5: two ad sets (US $350, non-US $350) with sport carried as the creative and `utm_content`, about 20 sign-ups per arm instead of 7 to 12 across four arms, which tightens each arm's cost per sign-up from plus or minus 60% to about plus or minus 45%. Everything else in section 5 (prerequisites, kill rules, Option B with the $300 held for the K experiment) stands.
4. **Today's rates column is partly circular at n = 4.** "Hit the wall 10%" and "wall to purchase 80%" are chosen to reproduce 4 payers of 49 exporters; the honest statement is payers per exporter 8.2% (n = 49, 4 payers) and nothing finer. The after-fixes and optimistic wall and purchase rates are founder targets with no measurement behind them yet.
5. **Attribution of the Aug 2026 surge is unknown.** Sign-ups went from 2 a month to 148 with no UTM on any of them. If the surge came from one shareable moment (a post, a forum thread), the 150 a month run rate is a tail, not a floor; eight flat weeks at 29 to 42 argue for a floor, but the beacon's referrer host is the only way to know.

## 8. Top-down reconciliation and the 12-week test programme

`topdown-vs-bottomup-2026-11-04.md` sizes the pond from the outside (US competitive tier 4.7M to 8.4M athletes, $42M to $303M a year at our ladder, A; filmed share has no published source), decomposes the gap to this model into reach x conversion x revenue per payer (the optimistic column is already at benchmark conversion; the remaining 470x to 1,660x is reach), places the section 5 flight inside a 12-week programme that converts nine model inputs to M for the same $1,000, and scores the acquisition candidates (Meta Reels and the product share loop are the two to test). Research inputs: `topdown-research-2026-11-04.md`, `channel-test-research-2026-11-04.md`.

## Assumptions appendix

| Assumption | Value | Label | Confidence |
|---|---|---|---|
| Organic sign-ups | 150 per month (120 to 170) | A from M weekly 29 to 42 (6 full weeks), last 30 days 152 | Low |
| SEO added sign-ups | +15 / +40 per month | A (clicks on page 1 at 10% visit-to-sign-up, both unmeasured) | Very low |
| Partnerships and camera-brand posts | not modelled | research pending | n/a |
| K after fixes / optimistic | 0.05 / 0.25 | A / F target; measured 0.008 | Very low |
| First render within 14 days | 12.5% / 25% / 33% | M (mature cohorts, N = 321) / F / F | High / Low / Low |
| Wall rate | 10% / 40% / 60% | A (circular) / F / F | Low |
| Wall to purchase | 80% / 20% / 25% | M (n = 4, insufficient) / F / F | Very low / Low / Low |
| Revenue per payer | $18.99 / $20 / $35 | M (n = 4) / F / F | Very low / Low / Low |
| Purchases per payer | 1.25 / 1.1 / 1.2 | M (n = 4) / A / A | Low |
| Plays per exporter | 3.78 / 5 / 7 | M (185 of 49) / A / A | Medium |
| Games per sign-up | 0.97 / 1.15 / 1.30 | M (368 of 379) / A (uploaders rise when failures fall) / A | Medium / Low / Low |
| GPU $0.025 per play, storage $0.05 per game | | F | Medium |
| Fixed infrastructure | $80 per month (Cloudflare under $20, Fly under $40, Modal $0 so far, Resend $20) | M, owner-reported 2026-11-04 | High |
| Tooling | $100 per month (Claude), whole horizon | M, owner-reported | High |
| Owner hour value | $50 | A | n/a |
| Effort weeks | section 3 | A | Low |
| Ramp | 0 / 50 / 100% over months 1 to 3 / 4 to 6 / 7+; test in month 4 | A | Low |
| Repeat purchase | excluded (0 of 47 at 120+ days, M; product too young) | n/a | n/a |
| Meta CPM $14 to $15, CPC $0.70 to $1.72, CTR 0.9 to 1.7% | | B, 2025 (Triple Whale, Influee, WordStream, TrendTrack), under 18 months old | Medium |
| Landing conversion 3 to 8% social | | A from Unbounce 2024 medians | Low |
| Google search CPC $1.50 to $5.26, about 90 non-brand clicks a month | | B 2025 (Search Engine Land, LocaliQ via TheeDigital); M (Search Console Oct 2026) | Medium / High |
| Meta learning phase about 50 events per ad set per week | | B, Meta's published guidance | Medium |
| Upload failure classes | rows include retries; 78 rows have no size | M, 90 days | High for the counts, low for the cause |

Formulas (rebuild in a sheet): payers per sign-up = render rate x wall rate x purchase rate; revenue per sign-up = payers per sign-up x revenue per payer; contribution per sign-up = revenue per sign-up minus render rate x plays per exporter x $0.025 minus games per sign-up x $0.05 minus payers per sign-up x (revenue per payer x 2.9% + purchases per payer x $0.30); monthly sign-ups = (organic + added) / (1 minus K); break-even CAC = contribution per sign-up. Arithmetic script for this file: the session scratchpad `outlook_v2.py` (not in the repo).
