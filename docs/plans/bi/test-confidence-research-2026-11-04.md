# How much data does a channel test need before you can business-model ReelBallers?

Research memo, 2026-11-04. Prepared for the owner's decision on a $1,000 channel test.

Labels: **B** = benchmark or published guidance (source, URL, year). **A** = derivation from ReelBallers' own numbers or from B inputs, with the arithmetic shown. Where a platform's own help page could not be retrieved in this session, the entry says so and names the secondary sources that reproduce the wording.

ReelBallers inputs used throughout (owner-reported, 2026-11-04, A unless noted):

| Input | Value | Note |
|---|---|---|
| Organic sign-ups per month | 150 | owner |
| Upload rate | 37.7% | owner |
| First highlight within 14 days | 12.5% | owner |
| Payers per sign-up | 4 of 379 = 1.06% | A: 4 / 379 = 0.01055 |
| Revenue per payer | $18.99 | owner |
| Referral K | 0.008 | owner; A: 0.008 x 379 = 3.0 referred sign-ups observed so far |
| Candidate paid channels | Meta Reels, Reddit Ads, Google Search | owner |
| Candidate free channels | product share loop, coach referral codes, SEO, organic Reddit | owner |

---

## 1. Platform and practitioner rules: how many conversions before a cost read is trustworthy

### 1a. Platform guidance

| Platform | Rule as stated | Label and source |
|---|---|---|
| Meta (ad set learning phase) | An ad set exits the learning phase after about 50 optimization events in the 7 days since its last significant edit; if Meta predicts it will not reach 50 in 7 days it is flagged "Learning Limited". | B: Meta Business Help Center, "About the learning phase", https://www.facebook.com/business/help/112167992830700 (page body not retrievable in this session; the 50-in-7-days wording is reproduced by Jon Loomer, https://jonloomer.com/?p=45223, and Jetfuel 2026, https://jetfuel.agency/what-is-the-meta-ads-learning-phase-how-to-exit-it-faster-in-2026/). |
| Meta (implied test budget) | Weekly budget per ad set needed to exit learning = target CPA x 50. Hightouch's worked example: "$5,000 ($100 CPA x 50 conversions) per week per ad set". | B: Hightouch, "The learning phase", https://hightouch.com/blog/the-learning-phase (2024). A for ReelBallers: at $12 per sign-up, 50 x $12 = $600 per week per ad set to exit learning on the sign-up event; at 1.06% payers the purchase event would need 50 / 0.0106 = 4,717 sign-ups per week, which is not reachable, so paid tests must optimise on sign-up, not purchase. |
| Meta Experiments (A/B tool) | "Meta recommends a minimum of 7 days. If your budget is small, you may need 14 days." Budget is split evenly across variants; Meta reports a probability that one variant beats the other. | B: Meta Business Help Center "About A/B testing", https://www.facebook.com/business/help/1738164643098669 (body not retrievable); duration attributed to Meta by AdAdvisor, https://adadvisor.ai/docs/learn/ab-testing (2025). Third-party floors of 50 to 100 conversions per variation (Coinis, https://coinis.com/how-to/how-long-to-test-facebook-ads) are practitioner numbers, not Meta's. |
| Google Ads (Target CPA) | "Advertisers can start using Target CPA with no conversion history." and "For evaluation, we recommend you measure performance for the last 30 days, including at least 30 conversions." | B: Google Ads Help, "About Target CPA bidding", https://support.google.com/google-ads/answer/6268632 (accessed 2026-11-04). |
| Google Ads (Target ROAS and other bid strategies) | Search and Shopping: "At least 15 conversions in the past 30 days"; Video action: "At least 30 conversions in the past 30 days"; Demand Gen: "At least 50 conversions in the past 35 days"; App: "300 conversions in 30 days". | B: Google Ads Help, "About Target ROAS bidding", https://support.google.com/google-ads/answer/6268637 (accessed 2026-11-04). |
| Reddit Ads | Ad group daily minimum $5; campaign level minimum reported as $100 lifetime by one source and $50 by another (sources conflict). Reddit's recommended working budget is reported as "at least three times your CPA per ad group" per day. Third parties cite about 50 conversions per week per ad group to exit learning, mirroring Meta; no Reddit page confirming this was retrievable. | B: Stackmatix 2026, https://www.stackmatix.com/blog/reddit-ads-minimum-spend ; Single Grain, https://www.singlegrain.com/?p=81334 ; ppc.land, https://ppc.land/reddit-ads-minimum-prices ; Omneky, https://www.omneky.com/blog/how-reddit-ads-work . Official page (business.reddithelp.com) returned 404 in this session. |

Reading across the platforms: every automated bidder wants 30 to 50 conversions per optimisation unit (ad set or campaign) per week or month before it trusts its own cost estimate. That is a machine-learning requirement, but it coincides with the statistics in section 2: 43 events is where a Poisson count's 95% interval narrows to about plus or minus 30%.

### 1b. Practitioner rules of thumb

| Rule (quoted) | Who | Label and source |
|---|---|---|
| "100 conversions per variation" | Widely repeated CRO rule; the Growth Method traces it to Google Optimize's documentation, which actually said "at least a few hundred conversions per variant". | B: Convert glossary, https://convert.com/glossary/sample-size/ ; critique and origin: https://www.growthmethod.com/100-conversions-rule/ (2024). |
| "ignore your test results until you have at least 350 conversions per variation" | CXL community practitioner post (not official CXL guidance; CXL's own calculator page gives no fixed number). | B: https://community.cxl.com/t/get-a-b-testing-right/685 ; CXL calculator https://cxl.com/blog/ab-test/ . |
| "spend 3 to 5x your target CAC before drawing conclusions", so "$300 CAC implies a $900 to $1,500 test budget" | Startup growth guide; a dollar floor, not a sample-size argument. | B: Startup Super School, "Paid acquisition", https://startup-super-school.vercel.app/guides/paid-acquisition (2026). A for ReelBallers: "CAC" here must mean cost per sign-up, not cost per payer; 3 to 5 x $12 = $36 to $60 per channel, which is far below any statistical floor, so this rule is not binding here. |
| "usually a few hundred conversions per channel before you judge it"; "Set a fixed test budget, one hypothesis, and a kill/scale decision date up front"; "If you can't afford a real test, that channel isn't right for you yet." | eChai Starting Up (unsigned) | B: https://echai.ventures/startingup/paid-acquisition/how-much-budget-do-i-need-to-test-a-paid-channel-properly (2026). |
| First $10K: "2 channels, campaign types, messaging tests, and creative tests"; "either Google or Meta will make for excellent paid channels for initial testing"; judge with a stat-sig calculator at a "10-20% significance level". | Jonathan Martinez (ex Postmates, Coinbase growth) | B: https://jon4growth.substack.com/p/how-to-spend-your-first-10k-on-paid (2023). |
| About $2,000 to $3,000 to test one channel at a time on a bootstrapped budget | Tuff Growth | B: https://tuffgrowth.com/startup-marketing-budget (2024). |
| New channel tests should wrap up within about one quarter; assume a new channel needs more than a couple of cycles before it is clear; "You're going to need to commit a lot of cycles to keep it going." | Adam Grenier (Uber, MasterClass) on Lenny's Podcast, 2022-09-15 | B: episode "When and how to invest in new acquisition channels", transcript at https://rosetta.to/u/lennyspodcast/when-to-invest-in-new-acquisition-channels-adam-grenier-uber-masterclass ; recap in Growth Gems #77, https://growthgems.substack.com/p/growth-gems-77-acquisition-monetization . |
| CAC = CPC / (trial rate x paid rate); "Getting ad arbitrage to work out profitably is extremely sensitive to changes in the steps of your conversion funnel"; "if you're several factors off (this is common in highly competitive markets)" paid will not work. | Andrew Chen | B: https://andrewchen.com/when-does-paid-acquisition-work-for-saas-startups/ (2011). |
| Most companies cannot profitably acquire on Meta or Google without high margins or strong referrals; "you're lucky if you get just one paid growth channel working". | Julian Shapiro, Growth guide | B: https://www.julian.com/guide/growth/intro ; reader summary https://www.indiehackers.com/post/initial-takeaways-after-reading-through-julian-shapiros-growth-marketing-guide-2b01190096 (2020). |
| Brian Balfour / Reforge | No specific minimum-conversion or minimum-spend rule from Balfour or Reforge could be located in this session. Reforge's experimentation material is summarised by third parties as warning that "many small companies run underpowered tests and make bad decisions from them". | B (secondary only): https://hq-raydata-co.pages.dev/vault/06-reference/2026-04-03-reforge-experimentation-foundations/ . Treat as unconfirmed. |
| "Decide on a sample size in advance and wait until the experiment is over." Peeking ten times turns a nominal 1% significance level into about 5%; stopping at first significance gave a 26.1% false positive rate in his example. | Evan Miller | B: https://www.evanmiller.org/how-not-to-run-an-ab-test.html (2010). |

**Rule-of-thumb band:** platforms want 30 to 50 conversions per optimisation unit per period; practitioners quote 100 (the common floor) to a few hundred (350 at the strict end) per arm before judging a channel. The spend-multiple rules (3 to 5x CAC) are floors for expensive B2B CACs and are not the binding constraint at a $12 cost per sign-up.

---

## 2. Statistical sample sizes for the five reads

Conventions: 95% two-sided confidence, 80% power unless stated. z(0.975) = 1.960; z(0.80) = 0.8416. Formulas are the standard normal approximations; Evan Miller's calculator (https://www.evanmiller.org/ab-testing/sample-size.html) reproduces the two-proportion results. All arithmetic is A.

### 2a. Cost per sign-up (Poisson count on sign-ups)

Spend is fixed; the number of sign-ups n is a Poisson count, so the relative standard error of cost per sign-up is 1/sqrt(n). A 95% interval has half-width 1.96/sqrt(n).

| Target precision | One standard error (68%): n = 1/e^2 | 95% interval: n = (1.96/e)^2 |
|---|---|---|
| plus or minus 20% | 1/0.04 = 25 | (9.8)^2 = 96 |
| plus or minus 30% | 1/0.09 = 11.1, so 12 | (6.53)^2 = 42.7, so 43 |
| plus or minus 50% | 1/0.25 = 4 | (3.92)^2 = 15.4, so 16 |

So 43 sign-ups per channel gives "cost per sign-up is within about 30% at 95%"; 12 gives the same at one standard error; 96 is needed for plus or minus 20%.

### 2b. Activation: first highlight within 14 days, channel cohort vs organic 12.5%

Two-proportion formula, n per arm = (1.96 x sqrt(2 p_bar q_bar) + 0.8416 x sqrt(p1 q1 + p2 q2))^2 / (p1 - p2)^2.
One-arm version (organic rate treated as a known baseline, because the organic arm at 150 per month is much larger than any paid arm): n = (1.96 x sqrt(p0 q0) + 0.8416 x sqrt(p1 q1))^2 / (p1 - p0)^2.

| Comparison | Two arms, equal size, n per arm | One paid arm vs known organic baseline |
|---|---|---|
| 12.5% vs 20% | p_bar = 0.1625; 1.96 x sqrt(0.2722) = 1.0226; 0.8416 x sqrt(0.1094 + 0.16) = 0.4368; (1.4594)^2 / 0.005625 = 379 | (1.96 x 0.3307 + 0.8416 x 0.4)^2 / 0.005625 = (0.9849)^2 / 0.005625 = 173 |
| 12.5% vs 25% | p_bar = 0.1875; 1.96 x sqrt(0.3047) = 1.0819; 0.8416 x sqrt(0.1094 + 0.1875) = 0.4586; (1.5405)^2 / 0.015625 = 152 | (0.6482 + 0.8416 x 0.4330)^2 / 0.015625 = (1.0126)^2 / 0.015625 = 66 |

Reading: a paid cohort of 66 sign-ups can show whether its 14-day activation is double organic (25% vs 12.5%); detecting a 20% rate needs about 173 paid sign-ups. These are per cohort; splitting across channels multiplies the requirement.

### 2c. Payers per sign-up: 1% vs 3% and 1% vs 5%

Same formulas. Because the baseline is near 1%, the normal approximation is optimistic; an exact binomial check is shown.

| Comparison | Two arms, n per arm | One arm vs known 1% (normal approx.) | One arm, exact binomial check |
|---|---|---|---|
| 1% vs 3% | p_bar = 0.02; (1.96 x 0.1980 + 0.8416 x 0.1975)^2 / 0.0004 = (0.5543)^2 / 0.0004 = 768 | (1.96 x 0.0995 + 0.8416 x 0.1706)^2 / 0.0004 = (0.3386)^2 / 0.0004 = 287 | about 300 to 350 for 80% power at alpha at or below 5% |
| 1% vs 5% | p_bar = 0.03; (1.96 x 0.2413 + 0.8416 x 0.2396)^2 / 0.0016 = (0.6745)^2 / 0.0016 = 285 | (1.96 x 0.0995 + 0.8416 x 0.2179)^2 / 0.0016 = (0.3784)^2 / 0.0016 = 90 | n = 120: reject at 4 or more payers, alpha = 3.4%, power = 85% (Poisson 1.2 vs 6.0); n = 150: reject at 5 or more, alpha = 1.9%, power = 87%; n = 240: reject at 6 or more, alpha = 3.6%, power = 98% |

Planning figure used in section 3: **240 sign-ups one-armed for 1% vs 5%** (the conservative exact figure; the bare minimum for 80% power is about 120 to 150). For 1% vs 3%, about 300 one-armed or about 770 per arm two-armed.

### 2d. Revenue per payer to plus or minus 20%, coefficient of variation about 0.6

CV derivation (A): a three-pack ladder priced roughly 1x, 2x, 4x (illustratively $9.99, $18.99, $39.99) with a 40/40/20 purchase mix has mean = 0.4 x 9.99 + 0.4 x 18.99 + 0.2 x 39.99 = $19.59; variance = 0.4 x (9.60)^2 + 0.4 x (0.60)^2 + 0.2 x (20.40)^2 = 36.86 + 0.14 + 83.23 = 120.2; SD = $10.97; CV = 10.97 / 19.59 = 0.56. Repeat purchases within the window add dispersion, so 0.6 is the planning value. Substitute the real ladder when modelling.

Relative SE of the mean = CV / sqrt(n), so n = (z x CV / e)^2.

| Precision | n payers |
|---|---|
| plus or minus 20%, one SE | (0.6 / 0.2)^2 = 9 |
| plus or minus 20%, 90% interval | (1.645 x 0.6 / 0.2)^2 = 24.4, so 25 |
| plus or minus 20%, 95% interval | (1.96 x 0.6 / 0.2)^2 = 34.6, so 35 |
| What 20 payers buys at 95% | half-width = 1.96 x 0.6 / sqrt(20) = plus or minus 26% |

So "about 20 payers" gives revenue per payer within roughly a quarter; 35 payers gets to plus or minus 20% at 95%. ReelBallers has 4 payers: current 95% half-width = 1.96 x 0.6 / 2 = plus or minus 59%.

### 2e. Referral K: 0.01 vs 0.05, one-armed

Treat referred sign-ups per sign-up as a Poisson rate. One-sample test, n = (1.96 x sqrt(0.01) + 0.8416 x sqrt(0.05))^2 / (0.05 - 0.01)^2 = (0.196 + 0.1882)^2 / 0.0016 = (0.3842)^2 / 0.0016 = 92 sign-ups (normal approximation); exact check as in 2c gives about 120 to 150 sign-ups for 80% power. With 150 organic sign-ups a month this read arrives in one month.

Measuring K itself to plus or minus 30% at 95% needs 43 referred sign-ups (section 2a). At K = 0.05 that is 43 / 0.05 = 860 sign-ups (5.7 months of organic); at the current K = 0.008 it is 43 / 0.008 = 5,375 sign-ups (36 months). The current estimate of 0.008 rests on 3 referred sign-ups, so its 95% interval runs from about 0.002 to 0.023 (Poisson limits on a count of 3: 0.62 to 8.77, divided by 379).

### What sequential or Bayesian testing buys, and what "minimum detectable effect" means

Sequential designs let you stop early when the effect is large. Evan Miller's simple sequential rule (stop when treatment minus control successes reaches 2 x sqrt(N)) saves "up to 17%" of observations under the designed alternative, "on the order of 25% to 50%" when the true effect is about twice the planned lift, but can cost "up to 38% more" observations when the effect is small or absent (B: https://www.evanmiller.org/sequential-ab-testing.html, 2015). Johari, Pekelis and Walsh (Optimizely) found across 40,000+ experiments that their always-valid mSPRT "sometimes runs shorter than the fixed horizon test, but can also be 2x to 3x longer in sample size", with its real advantage being robustness when the planned effect size is wrong by 30 to 50% (B: https://arxiv.org/abs/1512.04922, 2015). Bayesian or sequential methods therefore do not shrink the tables above for a marginal channel; they only let a clearly great or clearly dead channel be called sooner, and they make peeking safe.

For the owner, the minimum detectable effect (MDE) is the smallest difference the test is sized to see with 80% probability. A test sized for "12.5% vs 25%" (66 sign-ups) will usually miss a channel that activates at 18%; it will report "no difference", which is not evidence the channel is the same as organic. Halving the MDE roughly quadruples the sample, which is why the 1% vs 3% payer read costs about three times the 1% vs 5% read.

---

## 3. Budget ladder

### Cost per sign-up: central $12, band $6 to $34 (A from 2026 CPC and landing benchmarks)

Inputs (B):
- Meta US traffic campaigns, median CPC $0.60 all industries; Sports & Recreation $0.59; Education & Instruction $0.70 (WordStream by LocaliQ, Facebook Ads Benchmarks 2026, campaigns April 2025 to June 2026, reproduced at https://digitalapplied.com/blog/facebook-ads-benchmarks-2026-cpc-cpm-ctr-industry and https://blog.coupler.io/facebook-ads-statistics/). Meta lead campaigns $1.92 (WordStream 2025, via https://whatagraph.com/blog/articles/ppc-benchmarks).
- Google Search average CPC $5.42 across industries in 2026, Arts and Entertainment $1.63 (WordStream and LocaliQ 2026 study of 13,474 campaigns, via Whatagraph, URL above); a lower all-industry figure of $2.69 is cited from Business of Apps by https://searchlab.nl/en/statistics/facebook-ads-statistics-2026 .
- Reddit Ads CPC "$0.50 to $1.50 is typical for most categories" (Stackmatix 2026, https://www.stackmatix.com/blog/reddit-ads-cost-per-click).
- Landing page conversion: median 6.6% across all industries, 41K+ landing pages and 57M+ conversions; paid social 12%, paid search 10.9% (Unbounce Conversion Benchmark Report 2024, https://unbounce.com/conversion-benchmark-report/). SaaS pages median 3.8% (secondary citations of the same report). An account sign-up sits between a lead form and a SaaS trial, so 6.6% is the central assumption.

Derivation (A):
- Low $6: Meta Sports & Recreation CPC $0.59 / 10% landing conversion = $5.90.
- Central $12: Meta $0.60 / 6.6% = $9.09; Reddit $1.00 / 6.6% = $15.15; mean = $12.12.
- High $34: Google Search CPC $3.40 (midpoint of the $2.69 and $5.42 figures, discounted toward the Arts and Entertainment rate) / 10% = $34. Google could be worse than this if intent keywords are competitive.

### Paid budgets

Sign-ups bought = budget / $12 (band: budget / $34 to budget / $6). Arms at 43 = floor(sign-ups / 43); arms at 12 = floor(sign-ups / 12). "Resolves" uses the section 2 thresholds: 43 per arm for cost per sign-up within 30% at 95%; 66 pooled for activation 12.5 vs 25 one-armed; 173 pooled for 12.5 vs 20 one-armed; 240 pooled for payers 1 vs 5 one-armed (planning figure); 20 payers for revenue per payer within about 26%.

| Budget | Sign-ups (central; band) | Arms at 43 per arm | Arms at 12 per arm | Expected payers at 1.06% (at 5%) | Resolves | Cannot resolve |
|---|---|---|---|---|---|---|
| $1,000 | 83 (29 to 167) | 1 (83/43 = 1.9; two arms of 41 are just under) | 6 (83/12 = 6.9) | 0.9 (4.2) | Cost per sign-up for ONE channel to plus or minus 30%; or two channels to about plus or minus 31% each; activation 12.5 vs 25 only if all 83 are pooled as "paid traffic" (66 needed) | Payers (0.9 expected; 240 needed one-armed); revenue per payer (needs 20 payers = 1,890 sign-ups at 1.06%); any per-channel activation read; cost per sign-up on 3 or 4 channels at better than plus or minus 45% (21 each: 1.96/sqrt(21) = 43%) |
| $2,500 | 208 (74 to 417) | 4 (208/43 = 4.8) | 17 | 2.2 (10.4) | Cost per sign-up on FOUR channels at about plus or minus 30% each (52 per arm: 1.96/sqrt(52) = 27%); pooled activation 12.5 vs 20 (173 needed); pooled payers 1 vs 5 at the 120 to 150 bare minimum, not at the 240 planning floor | Payers per channel; revenue per payer (2 expected payers); K (not a paid read) |
| $5,000 | 417 (147 to 833) | 9, or 4 channels at 104 each (plus or minus 19%) | 34 | 4.4 (20.8) | Four channels' cost per sign-up to plus or minus 19%; pooled payers 1 vs 5 one-armed (240) with margin; pooled activation 12.5 vs 20 two-armed vs a matched organic cohort (379, just short; one-armed is fine); per-channel activation 12.5 vs 25 (66 each, four channels at 104) | Payers per channel (104 each is under 120); revenue per payer unless conversion is near 5% (then 21 payers) |
| $10,000 | 833 (294 to 1,667) | 19, or 4 channels at 208 each (plus or minus 14%) | 69 | 8.8 (41.7) | Four channels' cost per sign-up to plus or minus 14%; per-channel activation 12.5 vs 20 one-armed (173 each); per-channel payers 1 vs 5 at the 120 to 150 minimum (208 each; under the 240 planning floor); pooled payers 1 vs 3 one-armed (300 needed) | Revenue per payer at the current 1.06% (8.8 payers gives plus or minus 40%); needs conversion at or above 2.4% to reach 20 payers (20 / 833 = 2.4%) |

Arithmetic notes: $1,000 / $12 = 83.3; $2,500 / $12 = 208.3; $5,000 / $12 = 416.7; $10,000 / $12 = 833.3. Band ends: $1,000 / $34 = 29.4 and $1,000 / $6 = 166.7, scaling linearly. Payers: 83 x 0.0106 = 0.88; 208 x 0.0106 = 2.2; 417 x 0.0106 = 4.4; 833 x 0.0106 = 8.8. Precision per arm at 95% = 1.96 / sqrt(n): n = 21 gives 43%; n = 52 gives 27%; n = 104 gives 19%; n = 208 gives 14%.

A caution on the band: at the $34 end, $1,000 buys 29 sign-ups in total, which is below 43 even for one channel; at the $6 end it buys 167, enough for three or four channels at the 43 floor. The first week of spend tells you which end you are at, which is the main thing a $1,000 test can establish.

### Free channels (budget = owner hours and calendar time; sample comes from the 150 organic sign-ups a month)

| Channel | What the arm consists of | Sample reached from 150 per month | Time to the 43 / 66 / 240 thresholds | Cost |
|---|---|---|---|---|
| Product share loop (K) | Every sign-up is exposed; the read is referred sign-ups per sign-up | 150 exposed per month; at K = 0.008 that is 1.2 referred sign-ups per month (A: 150 x 0.008) | K 0.01 vs 0.05 one-armed: about 1 month (120 to 150 exposed). K itself to plus or minus 30%: 43 referred sign-ups = 36 months at K = 0.008, 5.7 months at K = 0.05 | Owner hours to instrument the share event and attribute referred sign-ups; no cash |
| Coach referral codes (free credits) | Sign-ups arriving on a coach's code | Depends on coaches enrolled; A: if 10 coaches each bring 15 athletes' families and 30% sign up, that is 45 sign-ups per cohort of coaches | 43 sign-ups: about 10 active coaches (assumption above); 66 for an activation read: about 15 coaches; 240 for a payer read: about 55 coaches, which is a season or more of outreach | Owner outreach hours plus credit cost = redemptions x credit value (set the value when the programme is designed; label it A then) |
| SEO | Sign-ups whose first touch is organic search (Search Console plus UTM or referrer) | A: if search is 20% of organic, 30 sign-ups per month; the true share should be read from the existing attribution data before planning | 43: 1.5 months; 66: 2.2 months; 240: 8 months, all at the 20% assumption | Owner writing hours; content takes 3 to 6 months to rank, so the calendar, not the sample, is the constraint |
| Organic Reddit (owner posts) | Sign-ups via UTM-tagged links in posts and comments | A: at 5 sign-ups per post, 43 needs 9 posts; at 2 per post it needs 22 posts | 43 in 1 to 2 months at 1 to 2 posts a week; posts are also a free creative test for the paid Reddit arm | Owner hours (roughly 1 to 2 hours per post including community participation); subreddit rules on self-promotion limit cadence |

What the whole organic stream resolves by itself (A): in 3 months, 450 sign-ups give activation 12.5% with SE = sqrt(0.125 x 0.875 / 450) = 1.56 percentage points (95%: 9.4% to 15.6%); payers 4.8 expected, 95% Poisson interval roughly 1.6 to 11 payers, so conversion to paid is still only known to within a factor of 2 to 3; revenue per payer within about 26% needs 20 payers = 1,890 sign-ups = 12.6 months of organic at 1.06%. The free channels are how you get the free-cohort baseline that every paid comparison in section 2 is measured against; they do not get cheaper with money, only with time.

---

## 4. What "enough to business-model the full enterprise" means

### Inputs a unit-economics model needs, and the precision at which a scale decision is defensible

| Input | Why it matters | Defensible precision (A) | Sample needed | Money or time? |
|---|---|---|---|---|
| Cost per sign-up, per channel | Numerator of CAC; the only input paid tests directly measure | plus or minus 20 to 30% at 95% | 43 to 96 sign-ups per channel | Money. $500 to $1,200 per channel at $12 |
| Activation (first highlight within 14 days), per channel | Whether paid traffic is as good as organic; Gurley: "Churn may rise also, as a more aggressive program will likely capture customers of a lower quality" (B, below) | Detect a halving or doubling vs organic | 66 to 173 per channel one-armed | Money plus 14 days |
| Conversion to paid, per channel | Turns cost per sign-up into cost per payer; the model's most sensitive input | Distinguish 1% from 3% | 300 one-armed, 770 per arm two-armed | Money plus the purchase window; at $12 a 300-sign-up arm is $3,600 per channel |
| Revenue per payer (ARPU) | LTV numerator | plus or minus 20 to 26% | 20 to 35 payers | Time at current conversion (12 to 22 months of organic); money only if conversion is 3% or more |
| Repeat purchase and retention | LTV multiplier; Skok: "Get Churn and customer happiness right first" (B); a16z: investors want "cohort retention on metrics that matter for that business" (B) | Second-season repeat rate with a 95% interval under plus or minus 10 points | 100 or more payers observed across a season boundary | Time only. A youth sports season cannot be bought |
| Referral K | Reduces blended CAC by 1 / (1 - K) | Distinguish 0.01 from 0.05 | 120 to 150 exposed sign-ups | Time (one month of organic); hours to instrument |

### Published decision frameworks

- **David Skok, SaaS Metrics 2.0** (B: https://www.forentrepreneurs.com/saas-metrics-2/, 2012, updated): "The best SaaS businesses have a LTV to CAC ratio that is higher than 3, sometimes as high as 7 or 8." Profitability "is anemic if the time to recover CAC extends beyond 12 months." He adds "these are only guidelines". ReelBallers (A): at $12 per sign-up and 1.06% payers, CAC per payer = 12 / 0.0106 = $1,132 against $18.99 of first-purchase revenue, LTV:CAC = 0.017. At 5% conversion CAC = $240, ratio 0.08. The LTV:CAC gate cannot be passed by any channel test at a one-purchase LTV; it requires either conversion to paid above roughly 30% (A: 12 / 0.30 = $40 CAC, needing LTV of $120) or repeat purchases that lift LTV several-fold. This is the central finding: channel tests measure the numerator; the business model is decided by the denominator.
- **Bill Gurley, "The Dangerous Seduction of the Lifetime Value Formula"** (B: https://abovethecrowd.com/2012/09/04/the-dangerous-seduction-of-the-lifetime-value-ltv-formula/, 2012): "It's a Tool, Not a Strategy"; "How realistic is it to assume that your SAC will drop as you 4X your spend?"; paid customers "tend to churn more" than organic ones. Implication for ReelBallers: never model paid cohorts with organic activation or repeat rates; measure them separately (section 2b).
- **a16z, 16 Startup Metrics** (B: Jordan, Hariharan, Chen, Kasireddy, https://a16z.com/16-startup-metrics/, 2015): blended CAC "doesn't inform how well your paid campaigns are working and whether they're profitable"; "A common mistake is to estimate the LTV as a present value of revenue" rather than net profit; track cohorts as "% of original installed base that are still transacting". Implication: report paid CAC per channel separately from the 150 organic sign-ups, and use contribution margin (after GPU and storage cost per highlight), not the $18.99 sticker.
- **Andrew Chen, napkin math** (B, URL in section 1b): CAC = CPC / (trial rate x paid rate); payback = CAC / monthly revenue; cap spend at a fixed window of value (he suggests 6 months) rather than full LTV; "if you're several factors off" paid will not work. ReelBallers is several factors off at 1.06%.
- **Adam Grenier / Lenny's Podcast** (B, section 1b): give a new channel at most a quarter; look for directional improvement, not a final CAC.
- **Mobile app retention benchmarks**, for the retention input the model will eventually need (B): overall medians D1 27.3%, D7 9.2%, D30 3.9%; US Q3 2025 by category: Lifestyle and Well-being D30 4.8%, Education 3.6%, Media and Entertainment 3.4% (MWM, https://mwm.ai/glossary/retention, state of April 2026). Adjust puts the cross-category D30 average at 7% (B: https://www.adjust.com/blog/what-makes-a-good-retention-rate/). A seasonal, pay-per-use sports tool should not be judged on D30; the analogue is "returns the next game or next season", which only calendar time can produce.

### Which inputs money buys faster, and which only time produces

Money buys, within 2 to 4 weeks: cost per sign-up per channel, paid-cohort activation at 14 days, and (at $3,000 or more per channel) a coarse conversion-to-paid read. Time alone produces: revenue per payer at the current conversion rate (12 or more months of organic), repeat purchase across a season boundary, referral K maturity, and SEO. Spending more compresses the first group but does nothing for the second; a $10,000 test in month one still leaves LTV unknown until a second season has been observed.

---

## Answer to "is $1,000 enough?"

$1,000 at a central $12 per sign-up buys about 83 sign-ups (A: 1,000 / 12; band 29 to 167). That is one channel's cost per sign-up to plus or minus 30% (43 needed), or two channels to about plus or minus 31%, and, if all paid sign-ups are pooled, one test of whether paid traffic activates at double the organic 12.5% (66 needed). It is not enough to test several channels broadly: four arms of 21 sign-ups each read cost per sign-up to plus or minus 43%, which cannot separate a $9 channel from a $15 one, and it produces an expected 0.9 payers, so it says nothing about conversion to paid, revenue per payer or LTV. Four channels become readable at the 43-per-arm floor at about **$2,500** (A: 4 x 43 x $12 = $2,064; $2,500 gives 52 per arm, plus or minus 27%); at $5,000 the same four arms reach plus or minus 19% and the pooled cohort of about 417 clears the 240-sign-up one-armed payer read for 1% vs 5%. The recommended use of a $1,000 budget is therefore one or two paid channels (Meta Reels first, at the Sports and Recreation CPC of $0.59; Reddit Ads second), run for 14 days each on the sign-up event so the ad sets can exit learning, with a pre-committed kill rule, while the free channels run in parallel: the share loop and coach codes read K and coach-sourced sign-ups from the existing 150 organic sign-ups a month, which is where the activation baseline, payer rate and revenue per payer that the unit-economics model actually needs will come from, over 3 to 12 months, regardless of ad spend.

---

## Sources

Platform guidance
- Meta Business Help Center, About the learning phase: https://www.facebook.com/business/help/112167992830700 (body not retrievable 2026-11-04)
- Meta Business Help Center, About A/B testing: https://www.facebook.com/business/help/1738164643098669 (body not retrievable 2026-11-04)
- Jon Loomer, learning phase: https://jonloomer.com/?p=45223
- Jetfuel Agency, Meta learning phase 2026: https://jetfuel.agency/what-is-the-meta-ads-learning-phase-how-to-exit-it-faster-in-2026/
- Hightouch, The learning phase: https://hightouch.com/blog/the-learning-phase
- AdAdvisor, Meta A/B testing: https://adadvisor.ai/docs/learn/ab-testing
- Coinis, How long to test Facebook ads: https://coinis.com/how-to/how-long-to-test-facebook-ads
- Google Ads Help, About Target CPA bidding: https://support.google.com/google-ads/answer/6268632
- Google Ads Help, About Target ROAS bidding: https://support.google.com/google-ads/answer/6268637
- Stackmatix, Reddit Ads minimum spend 2026: https://www.stackmatix.com/blog/reddit-ads-minimum-spend
- Stackmatix, Reddit Ads cost per click: https://www.stackmatix.com/blog/reddit-ads-cost-per-click
- Single Grain, How much do Reddit ads cost: https://www.singlegrain.com/?p=81334
- ppc.land, Reddit ads minimum prices: https://ppc.land/reddit-ads-minimum-prices
- Omneky, How Reddit ads work: https://www.omneky.com/blog/how-reddit-ads-work

Practitioner rules and statistics
- Convert, Sample size glossary: https://convert.com/glossary/sample-size/
- The Growth Method, The 100 conversions rule: https://www.growthmethod.com/100-conversions-rule/
- CXL community, Get A/B testing right: https://community.cxl.com/t/get-a-b-testing-right/685
- CXL, A/B test calculator: https://cxl.com/blog/ab-test/
- Startup Super School, Paid acquisition: https://startup-super-school.vercel.app/guides/paid-acquisition
- eChai Starting Up, How much budget to test a paid channel: https://echai.ventures/startingup/paid-acquisition/how-much-budget-do-i-need-to-test-a-paid-channel-properly
- Jonathan Martinez, How to spend your first $10K on paid ads: https://jon4growth.substack.com/p/how-to-spend-your-first-10k-on-paid
- Tuff Growth, Testing budget for new channels: https://tuffgrowth.com/startup-marketing-budget
- Lenny's Podcast, Adam Grenier, When and how to invest in new acquisition channels (2022-09-15), transcript: https://rosetta.to/u/lennyspodcast/when-to-invest-in-new-acquisition-channels-adam-grenier-uber-masterclass ; recap: https://growthgems.substack.com/p/growth-gems-77-acquisition-monetization
- Andrew Chen, When does paid acquisition work for SaaS startups: https://andrewchen.com/when-does-paid-acquisition-work-for-saas-startups/
- Julian Shapiro, Growth guide: https://www.julian.com/guide/growth/intro ; summary: https://www.indiehackers.com/post/initial-takeaways-after-reading-through-julian-shapiros-growth-marketing-guide-2b01190096
- Reforge experimentation foundations (third-party notes, unconfirmed): https://hq-raydata-co.pages.dev/vault/06-reference/2026-04-03-reforge-experimentation-foundations/
- Evan Miller, How not to run an A/B test: https://www.evanmiller.org/how-not-to-run-an-ab-test.html
- Evan Miller, Simple sequential A/B testing: https://www.evanmiller.org/sequential-ab-testing.html
- Evan Miller, Sample size calculator: https://www.evanmiller.org/ab-testing/sample-size.html
- Johari, Pekelis, Walsh, Always Valid Inference (2015): https://arxiv.org/abs/1512.04922
- Statsig, Sequential vs fixed-horizon tests (vendor): https://statsig.com/perspectives/sequential-vs-fixed-tests

Frameworks and benchmarks
- David Skok, SaaS Metrics 2.0: https://www.forentrepreneurs.com/saas-metrics-2/
- Bill Gurley, The Dangerous Seduction of the Lifetime Value Formula (2012): https://abovethecrowd.com/2012/09/04/the-dangerous-seduction-of-the-lifetime-value-ltv-formula/
- a16z, 16 Startup Metrics (2015): https://a16z.com/16-startup-metrics/
- MWM, Retention glossary and benchmarks (April 2026, US Q3 2025): https://mwm.ai/glossary/retention
- Adjust, What makes a good retention rate: https://www.adjust.com/blog/what-makes-a-good-retention-rate/
- WordStream by LocaliQ Facebook Ads Benchmarks 2026, via Digital Applied: https://digitalapplied.com/blog/facebook-ads-benchmarks-2026-cpc-cpm-ctr-industry and Coupler: https://blog.coupler.io/facebook-ads-statistics/
- WordStream and LocaliQ Google Ads 2026 benchmarks, via Whatagraph: https://whatagraph.com/blog/articles/ppc-benchmarks
- Business of Apps Google CPC via Searchlab: https://searchlab.nl/en/statistics/facebook-ads-statistics-2026
- Unbounce Conversion Benchmark Report 2024: https://unbounce.com/conversion-benchmark-report/
