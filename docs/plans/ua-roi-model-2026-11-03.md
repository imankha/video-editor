# ReelBallers: return on ad spend model (2026-11-03)

Data: prod aggregates pulled 2026-11-03 by the read-only aggregate script (7 test accounts excluded, admin accounts not excluded). The model script and the raw JSON live in the session scratchpad; the formulas are in section 8. Labels: M = measured, F = founder estimate, B = public benchmark, A = assumption.

## 0. Missing inputs (proceeding with labelled assumptions)

1. Landing-page visits. No beacon, so visit-to-sign-up is unknown. Assumed 3 to 8% (B, Unbounce medians).
2. Search volume for the intent keywords. Not pulled; caps how much Google search can spend. Assumed small.
3. A usable money ladder. Since 2026-10-24: 1 paywall user, 1 buy-modal, 0 purchases. Paywall-to-purchase is unmeasured; used payers-per-exporter (4/49) instead.
4. Second-season behaviour. The product is six months old; no cohort has lived through a spring. LTV horizon is an assumption.
5. Honest "took it away" count. 8 users within 14 days, but the download button is blocked by an onboarding card; used credits_consumed as activation.
6. Costs for club partnerships and tournament signage. No public benchmark; assumptions stated.
7. CPM for the exact audience (parents 30 to 50 of kids in any recorded youth sport). Cross-industry 2025 ranges used.

## 1. Inputs restated

| Input | Value | Type |
|---|---|---|
| Real sign-ups, all time | 375 (Aug 42, Sep 148, Oct 169, Nov 10 partial; 35 to 42 per week in season) | M |
| Attribution | 375 of 375 organic, 0 with any UTM, 3 referred ever (none activated) | M |
| Platform | 54% mobile web, 46% desktop web | M |
| Sign-up to true export within 14 days (credits_consumed) | 48/375 = 12.8%; Oct cohort 30/169 = 17.8%; Sep 10.8%; Aug 2.4% | M |
| Journey "exported" | 20 (Spotlight only, undercount) | M, caveat |
| Took away within 14 days | 8/375 = 2.1% (download blocked, undercount) | M, caveat |
| Time to first render | p50 16 min, p75 49 min, p90 9 h | M |
| Payers | 4 payers, 5 purchases, $75.95 gross, $18.99 avg, $12.99 median, 1 repeat payer | M |
| Days sign-up to first purchase | p50 0.8, p90 12 | M |
| Payers per exporter | 4/49 = 8.2% | M |
| Renders per exporter | 187/50 = 3.7; 13.0 credits mean, 9 median, 12.9 s video | M |
| Exhausted 80 credits | 5 of 49 exporters (10%); 10 of 49 passed 48 credits (20%) | M |
| Credit balance | median 88 (untouched); 3 users below one play | M |
| Repeat use | 6 of 190 renderers active in 2+ months (3.2%); 1 in 3+ | M |
| Retention | Oct cohort active weeks 2 to 4: 7/169 (4%); Sep month 2: 2/148 (1.4%) | M |
| WAU | 28 to 44 Sep to Oct; 37 week of Oct 26 | M |
| Share loop | 22 shares by 9 sharers, 153 views, 0 claims, 9 referral rows, 3 referred sign-ups. K = 3/375 = 0.008 | M |
| Upload reliability, 90 days | 365 succeeded, 84 failed (18.7%); analyze_failed 47 rows/7 users; 16 to 19 GB files refused or stuck 15 rows/9 users; network and timeout 12 rows/10 users | M |
| Money ladder since 10-24 | 48 sign-ups, 1 paywall, 1 buy modal, 0 purchases | M (unusable) |
| GPU per play $0.025, storage per game $0.05, Stripe 2.9% + $0.30 | | F |
| Roadmap funnel states (25% and 33% export) | | F scenario |
| Channel CPM, CPC, CTR, landing conversion | section 4 | B |
| Seasonal index, scale penalties, 24-month repeat | section 8 | A |

## 2. Recommendation (under 400 words)

Spend nothing on scaled paid acquisition for the next two seasons. Spend $1,500 once, over six weeks of a live season, purely to measure. Every state of the product loses money on every paid channel, and no single input fixes that.

The arithmetic: contribution per sign-up is $0.15 today (measured), $0.32 after the fix list, $1.56 in the optimistic state. A benchmark paid sign-up costs $9 to $58 on Meta or TikTok and $12 to $105 on search. After the fixes you are 79 times short of break-even at a $25 sign-up; in the optimistic state you are still 16 times short. At $5k a month for a year you would buy about 2,000 sign-ups, 460 exporters, 37 payers and $735 of revenue.

Why it cannot flip: the product is single-session and single-season. Half of exporters render within 16 minutes of sign-up and half of payers buy within a day, then 97% never return in a later month. LTV equals the first purchase, $13 to $19. A payer bought on Meta costs $450 to $2,200.

Where growth comes from instead: organic already delivers about 160 sign-ups a month in season at zero cost. The fix list, moving export from 13% to 25%, adds about 20 exporters a month, which is what $2,000 of Meta would buy, and it compounds. The referral loop is at K = 0.008 (3 referred sign-ups ever, none activated); the 25% target is the only channel with near-zero CAC. Club and coach partnerships at $2 to $15 per sign-up are the only "paid" channel that can ever pay back, and only in the optimistic state with Season packs.

When to revisit paid: when payers per 100 sign-ups reach 5 on at least 500 sign-ups, and the first spring cohort (March 2027) shows at least 25% of fall payers buying again. Even then, paid works only for channels under $2 per sign-up.

Two biggest risks: (1) retention. No cohort has lived through a second season, so the LTV horizon is a guess until May 2027. (2) Measurement. There is no landing visit beacon, zero sign-ups have ever carried a UTM, the paid render path records no export event, and 19% of uploads fail. Any test run before those ship produces a CAC nobody can interpret.

## 3. Unit economics per sign-up (12-month horizon)

| | Today (M) | After fixes (F) | Optimistic (F) |
|---|---|---|---|
| Sign-up to export | 12.8% | 25% | 33% |
| Exporters who hit the wall | 10% (88 credits) | 40% (48 credits; measured floor 20%) | 60% |
| Wall to purchase | 80% (4 of 5, circular) | 20% | 25% |
| Payers per 100 sign-ups | 1.04 (measured 1.07) | 2.0 | 4.95 |
| Revenue per payer | $18.99 | $20 | $35 |
| Revenue per sign-up | $0.198 | $0.400 | $1.733 |
| GPU per sign-up | $0.012 | $0.031 | $0.058 |
| Storage per sign-up | $0.026 | $0.033 | $0.038 |
| Stripe per sign-up | $0.010 | $0.019 | $0.077 |
| Contribution per sign-up | $0.151 | $0.317 | $1.560 |
| Contribution per exporter | $1.18 | $1.27 | $4.73 |
| Contribution per payer | $14.43 | $15.84 | $31.52 |
| Break-even CAC per sign-up | $0.15 | $0.32 | $1.56 |
| 24-month contribution (A: 25% of payers repeat at 80% value) | $0.18 | $0.38 | $1.87 |
| Payback | Immediate if CAC is under the break-even figure; otherwise never. Purchases happen at day 0.8 median and there is no second season to wait for. | | |

## 4. Channel CAC, benchmarked (B unless marked A)

| Channel | CPM or fee | CPC | CTR | Landing to sign-up | Cost per sign-up | Per exporter (fixes) | Per payer (fixes) |
|---|---|---|---|---|---|---|---|
| Meta/Instagram | $14 to $15 (Triple Whale Aug 2025 to Jul 2026; Influee 2025) | $0.70 traffic (WordStream 2025) to $1.72 median (TrendTrack 2025) | 0.9 to 1.7% | 3 to 8% (A from Unbounce 2024 medians) | $9 to $58, mid $23 | $90 | $1,130 |
| TikTok | $4 to $10 (Influee, Focus Digital 2025) | $0.50 to $1.00 | 0.6 to 0.9% | 2 to 5% (A, cold traffic) | $10 to $50, mid $22 | $89 | $1,118 |
| Google search | n/a | $1.50 (A, long-tail) to $5.26 avg (Search Engine Land 2025) | 6.7% avg | 5 to 12% (A, intent) | $12 to $105, mid $36 | $145 | $1,813 |
| YouTube | $3.50 to $9 skippable; CPV $0.02 to $0.04 (Strike Social 2025, Store Growers) | $1 to $3 (A) | 0.3 to 0.5% (A) | 3 to 5% | $20 to $100, mid $45 | $179 | $2,236 |
| Micro-influencer | $150 to $500 per Instagram post, $200 to $800 per TikTok video (Influencer Marketing Hub 2025) | $1 to $4 effective (A) | n/a | 3 to 8% | $12 to $133, mid $41 | $163 | $2,041 |
| Club/coach partnership | founder time, printed material (A) | n/a | n/a | 20 to 40% of handed-a-link parents (A) | $2 to $15, mid $5.50 | $22 | $275 |
| Tournament QR signage | $300 to $1,000 per weekend (A) | n/a | 20 to 60 scans (A) | 30% (A) | $15 to $170, mid $50 | $200 | $2,500 |
| Referral/share loop | $0 | | | | $0 at K = 0.008 measured | $0 | $0 |

Reference point: Apple Ads median cost per install for Sports apps was about $27 in 2025 (AppTweak), confirming sports is an expensive category.

## 5. ROI at spend levels, 12 months, fall start (Aug), Meta at $25 per sign-up, K = 0.008

| Spend/month | State | Sign-ups | Exporters | Payers | Revenue | Contribution | Spend | ROI |
|---|---|---|---|---|---|---|---|---|
| $1k | Today | 407 | 47 | 3.8 | $73 | $55 | $12,000 | -99.5% |
| $1k | After fixes | 407 | 92 | 7.3 | $147 | $116 | $12,000 | -99.0% |
| $1k | Optimistic | 407 | 121 | 18 | $636 | $573 | $12,000 | -95.2% |
| $5k | Today | 2,036 | 235 | 19 | $364 | $277 | $60,000 | -99.5% |
| $5k | After fixes | 2,036 | 459 | 37 | $735 | $582 | $60,000 | -99.0% |
| $5k | Optimistic | 2,036 | 606 | 91 | $3,182 | $2,866 | $60,000 | -95.2% |
| $20k (CAC +30%) | Today | 6,266 | 723 | 59 | $1,121 | $852 | $240,000 | -99.6% |
| $20k (CAC +30%) | After fixes | 6,266 | 1,413 | 113 | $2,261 | $1,791 | $240,000 | -99.3% |
| $20k (CAC +30%) | Optimistic | 6,266 | 1,865 | 280 | $9,791 | $8,818 | $240,000 | -96.3% |

Club/coach partnerships at $5.50 per sign-up (scale penalty x1.5 at $5k, x3 at $20k): $1k/month optimistic -78%; $5k/month optimistic -86%; $20k/month optimistic -93%. Only the optimistic state at $1k/month on partnerships gets within sight of break-even, and still loses.

Fall versus spring: with a constant monthly budget the 12-month totals are identical, because each window contains the same four dead months (Dec to Feb, Jul). The difference is cash timing only. Pausing spend in the dead months saves about 30% of budget for the same output.

Month table, $5k/month, after fixes, fall start:

| Month | Aug | Sep | Oct | Nov | Dec | Jan | Feb | Mar | Apr | May | Jun | Jul |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sign-ups | 202 | 202 | 202 | 202 | 101 | 101 | 101 | 202 | 202 | 202 | 202 | 121 |
| Exporters | 50 | 50 | 50 | 50 | 13 | 13 | 13 | 50 | 50 | 50 | 50 | 18 |
| Payers | 4 | 4 | 4 | 4 | 1 | 1 | 1 | 4 | 4 | 4 | 4 | 1.5 |
| Revenue | $81 | $81 | $81 | $81 | $20 | $20 | $20 | $81 | $81 | $81 | $81 | $29 |
| Cumulative net | -$4.9k | -$9.9k | -$14.8k | -$19.8k | -$24.8k | -$29.8k | -$34.8k | -$39.7k | -$44.7k | -$49.6k | -$54.6k | -$59.4k |

Spring start (Mar) is the same row rotated. With K at the 25% target and the optimistic state: 2,693 sign-ups, 802 exporters, 120 payers, $4,209 revenue, still -94%.

## 6. Sensitivity at $5k/month, after-fixes base, CAC $25

| Input | Low | Base | High | Contribution per sign-up (low / base / high) | ROI at $25 CAC | ROI at $2 CAC (partnership) | ROI at $0.50 |
|---|---|---|---|---|---|---|---|
| Landing to sign-up (sets CAC) | 3% ($42) | 5% ($25) | 8% ($16) | $0.317 | -99.2% / -98.7% / -98.0% | | |
| Sign-up to export | 13% | 25% | 33% | $0.146 / $0.317 / $0.429 | -99.4 / -98.7 / -98.3% | -93 / -84 / -79% | -71 / -37 / -14% |
| Wall to purchase | 5% | 20% | 40% | $0.031 / $0.317 / $0.697 | -99.9 / -98.7 / -97.2% | -98 / -84 / -65% | -94 / -37 / +40% |
| Revenue per payer | $13 | $20 | $35 ($100) | $0.181 / $0.317 / $0.608 ($1.87) | -99.3 / -98.7 / -97.6% (-92.5%) | -91 / -84 / -70% (-7%) | -64 / -37 / +22% (+274%) |
| K-factor | 0.008 | 0.10 | 0.25 (0.50) | $0.319 / $0.352 / $0.422 ($0.634) | -98.7 / -98.6 / -98.3% | -84 / -82 / -79% (-68%) | -36 / -30 / -16% (+27%) |

Which single input flips ROI positive at $5k/month on a $25 sign-up: none. Required values holding the others at base: export 1,973%, wall-to-purchase 1,578%, revenue per payer $1,578, K = 0.987, landing conversion 395%. The only lever that works is CAC itself: ROI turns positive below $0.32 per sign-up (after fixes) or $1.56 (optimistic). That is referral and partnership territory, not media.

## 7. What must be true before spending, first test, kill criteria

Checklist, each with its measurement and today's value:

1. Landing visit beacon live on reelballers.com, passing ref and utm through to sign-up. Measure: visits per campaign id per day; organic visit-to-sign-up rate over 7 days. Today: no data.
2. Campaign id in every ad URL via the registry. Measure: share of paid-cohort sign-ups with utm_campaign set = 100%. Today: 0 of 375 sign-ups carry any UTM.
3. Export event emitted by the paid Frame render on prod. Measure: exports_started > 0 in daily counters and exported_any users equal credits_consumed users. Today: exports_started = 0.
4. Download unblocked. Measure: took-away over finished >= 60%. Today: 8 of 19.
5. Upload failure under 10% of attempts, and 16 to 19 GB files get a clear message. Today: 18.7%.
6. Money ladder with a denominator: >= 20 paywall users and >= 5 purchases since the reprice. Today: 1 and 0.
7. Sign-up to export >= 25% on the last 100 organic sign-ups. Today: 17.8% (Oct cohort).
8. LTV gate for anything beyond the test: by May 2027, >= 25% of fall-2026 payers have bought again. Today: unobservable.

First test: $1,500 over 6 weeks, in a live season (March 2027 is the first window after items 1 to 6 can ship; the remaining fall weeks are too short). Meta/Instagram $1,000 (parents 32 to 50, interests across youth sports and the camera brands as interest targets only; US and non-US as separate ad sets), Google search $500 on exact-match intent terms per sport ("{sport} highlight video maker", "how to make a {sport} highlight video", "veo highlights download"; see section 9 for why search is likely $0 in round one). No TikTok or YouTube in the first test: creative cost and lower intent. Expected outcome: 26 to 125 sign-ups, 3 to 31 exporters, 0 to 3 payers. The purpose is to learn visit-to-sign-up and paid-cohort export rate, not to make money.

Creative angles within the constraints: "You film. You pick the play. We sharpen it." / "Downloaded your game file? Make tonight's highlight in 15 minutes." (the parent downloads their own file; no vendor integration implied) / "No public feed. Only the links you send." / "No subscription. About fifty cents a play."

Kill criteria at week 6: cost per sign-up above $40 on a channel kills that channel; paid-cohort export rate under 60% of the concurrent organic rate kills the channel for traffic quality; zero payers from 60 or more paid sign-ups means no scale decision; visit-to-sign-up under 2% means fix the landing page before any further spend. Scale on nothing from this test. The scale decision belongs to partnerships and referral, gated by item 8.

## 8. Assumptions appendix

| Assumption | Value | Source | Confidence |
|---|---|---|---|
| Sign-up to export, today | 12.8% (Oct 17.8%) | M, credits_consumed 14-day | High |
| Sign-up to export, after fixes / optimistic | 25% / 33% | F, product of roadmap transitions | Low |
| Exporters hitting the wall at 48 credits | 40% | A between measured floor 20% and founder 50% | Low |
| Wall to purchase, after fixes | 20% | A, reproduces measured 8.2% payers per exporter | Low |
| Revenue per payer | $19 / $20 / $35 | M (n=4) / F / F | Low |
| GPU $0.025 per play, storage $0.05 per game | | F | Medium |
| Plays per exporter | 3.7 / 5 / 7 | M / A / A | Medium |
| Games per sign-up | 0.52 / 0.65 / 0.75 | M / A / A | Medium |
| 24-month repeat | 25% of payers at 80% value | A, no measurement exists (3% multi-month renderers) | Very low |
| Landing conversion | 3 to 8% social, 5 to 12% search | A from Unbounce 2024 medians (6.6% all, 3.8% SaaS, 4.1% paid search) | Low |
| Meta CPM $14 to $15, CPC $0.70 to $1.72, CTR 0.9 to 1.7% | | B 2025, Triple Whale, Influee, WordStream, TrendTrack | Medium |
| TikTok CPM $4 to $10, CPC $0.50 to $1.00 | | B 2025, Influee, Focus Digital | Medium |
| Google search CPC $5.26 avg, CTR 6.7%, conv 7.5% | | B 2025, Search Engine Land, LocaliQ via TheeDigital | Medium |
| YouTube skippable CPV $0.02 to $0.04, CPM $3.50 to $9 | | B 2025, Strike Social, Store Growers | Medium |
| Micro-influencer $150 to $800 per post | | B 2025, Influencer Marketing Hub, Fiverr | Low |
| Club partnership $2 to $15 per sign-up; tournament $300 to $1,000 per weekend, 20 to 60 scans | | A | Very low |
| Seasonal index 1.0 Aug to Nov and Mar to Jun, 0.6 Jul, 0.5 Dec to Feb | | A (measured data covers Aug to Oct only) | Low |
| Scale penalty: CAC +30% at $20k media; x1.5 at $5k and x3 at $20k for partnerships | | A | Low |
| K-factor | 0.008 measured; 0.25 target | M / founder target | High / n/a |
| Parent soccer spend $910 per year, club $3k to $5k | | B, Aspen Project Play 2025 survey (2024 data) | Medium |

Formulas in words (rebuild in a sheet):
- payers per sign-up = export rate x wall rate x purchase rate
- revenue per sign-up = payers per sign-up x revenue per payer
- contribution per sign-up = revenue per sign-up minus (export rate x plays per exporter x GPU per play) minus (games per sign-up x storage per game) minus payers per sign-up x (revenue per payer x 2.9% + purchases per payer x $0.30)
- cost per sign-up = CPC divided by landing conversion; cost per exporter = cost per sign-up divided by export rate; cost per payer = cost per sign-up divided by payers per sign-up
- monthly sign-ups = spend divided by (cost per sign-up x scale penalty divided by seasonal index), then divided by (1 minus K)
- monthly exporters, payers, revenue, contribution = sign-ups x the per-sign-up rate x seasonal index
- 12-month ROI = total contribution divided by total spend, minus 1
- break-even CAC = contribution per sign-up

Benchmark sources: Triple Whale Facebook ads benchmarks; Influee Facebook and TikTok benchmarks; WordStream Facebook ads benchmarks 2025; TrendTrack Meta ad spend by industry 2025; Focus Digital TikTok CTR and CPM; Search Engine Land Google Ads costs 2025; TheeDigital 2025 Google Ads benchmarks; Strike Social 2025 YouTube benchmark report; Store Growers YouTube benchmarks; Unbounce conversion benchmark report; Influencer Marketing Hub micro-influencer rates; Fiverr influencer marketing cost guide; AppTweak Apple Ads benchmarks 2025; Aspen Institute Project Play 2025 spending survey.


## 9. Addendum: Google Search Console, October 2026 (measured, added 2026-11-03)

Source: the owner's Search Console export for reelballers.com, web search, 2026-10-01 to 2026-10-31.

- 129 clicks, 2,360 impressions, average position about 13. 40 of the clicks were the brand query "reelballers" (89% CTR, position 1). Non-brand search delivered about 89 clicks in the month.
- Pages: homepage 57 clicks (brand), volleyball 15, rugby 10, football 9, hockey 8, flag football 7, lacrosse 4, soccer 6 at position 17.9. The soccer page is the worst-ranked sport page while soccer is 75% of users. The Trace page had 210 impressions and 1 click (0.5% CTR at position 7.7); the Veo page 73 impressions and 3 clicks. The recruiting-videos page had 227 impressions at position 66 and no clicks.
- Intent queries: "how to make a soccer highlight video" 17 impressions at position 30; "soccer highlight video maker" 2 impressions at position 41; "recruiting video production" 118 impressions at position 83; "which site offers the best youth sports highlight reels" 21 impressions at position 6.6, no clicks.
- Devices: mobile 72 clicks, desktop 57. Countries: US 77 of 129 clicks (60%), Canada 14, Australia 6, UK 1 click from 111 impressions.

What it changes in the model:

1. Missing input 2 is now measured: the intent cluster is tiny at current rank, about 90 non-brand clicks a month across all sports. Google search cannot absorb $500 a month on exact-match soccer terms. Revised first test: $1,500 on Meta/Instagram only; search gets $0 until the soccer page and the how-to query rank on page 1.
2. Search sent at most 129 of October's visits while 169 people signed up, so most sign-ups arrive by direct visits, share links and word of mouth. Visit-to-sign-up is still unknown without the beacon (T7410).
3. Brand search clicks (40 a month) are a free monthly word-of-mouth gauge. Track them month over month alongside sign-ups.
4. 40% of search clicks are outside the US. The model assumes US parents; a paid test must geo-target the US and the readiness panel should show sign-ups by country once the beacon lands.
5. The cheapest search lever is SEO, not ads: the soccer page at position 17.9 and the how-to query at 30 are each worth tens of clicks a month on page 1 at $0 per click.

## 10. Correction (owner, 2026-11-03): ReelBallers is multi-sport, not a soccer product

The brief in section 2 framed the customer as a youth soccer parent. The owner's correction: the product is for any Veo, Trace or otherwise recorded sport where a parent wants highlights out of game film. Soccer is only the largest slice of the current base. What this changes:

- **Seasonality.** The seasonal index (0.5 for Dec to Feb, 0.6 for Jul) is a soccer calendar. Hockey, basketball, volleyball and indoor sports are in season when soccer is not, so the honest index for the whole product is flatter. Flattening it does not change the verdict: the 12-month ROI numbers in section 5 are driven by contribution per sign-up, not by which months the sign-ups arrive in. Treat the month table as a soccer-only view.
- **"Two seasons" and "second season".** Replace with calendar dates and a sport-agnostic repeat measure: a repeat payer is one who buys again 120+ days after a first purchase that is 6+ months old. The first reading with 20 or more eligible payers lands around May 2027. The spend-readiness gate (T14910) uses this definition.
- **Keywords and creative.** The intent set is per sport, not soccer only: "{sport} highlight video maker", "how to make a {sport} highlight video", for every sport page on the landing site. Search Console shows volleyball, rugby, football and hockey pages already out-rank the soccer page.
- **Geography.** Veo and Trace are sold worldwide and 40% of October's search clicks came from outside the US (Canada, Australia, UK, South Africa). A paid test should target by sport interest and camera ownership, not by US soccer alone; keep US and non-US cohorts separable so their export and payer rates can be compared.
- **Market size reference.** The Aspen Project Play figure is for all youth sports ($1,016 per child's primary sport in 2024), which is the right scope; the soccer-only $910 line was the narrower read.

## 11. Correction (owner, 2026-11-03): no assumptions about sport seasons

Seasons differ per sport and per league. Every seasonal element in this document is therefore an unverified assumption, not a model input: the seasonal index in section 8 (1.0 in season, 0.6 July, 0.5 December to February), the "in-season" and "dead months" language in sections 2, 5 and 7, the fall-versus-spring launch comparison in section 5, and the "hockey and basketball are in season when soccer is not" reasoning in section 10. Treat the month table as illustrative only; the 12-month ROI totals do not depend on it because they are driven by contribution per sign-up.

How seasonality should enter the model instead: derive it from measured weekly sign-ups and renders per arrival sport (T14930) and, once known, per league; shade low-volume weeks from the data; never gate, pause or colour anything by calendar. "Repeat" stays calendar-agnostic (a purchase or render 120+ days after the first). Older analytics tasks that carry season windows as constants (T7430 retention season cohorts, T7460 in-season criteria, the Investor-Grade Analytics epic notes) need the same rework before implementation.
