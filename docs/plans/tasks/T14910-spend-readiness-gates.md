# T14910: Spend-readiness gates (admin panel + read-only endpoint): "can we spend on ads yet?"

**Status:** WIP
**Impact:** 8
**Complexity:** 5
**Tier:** L (new admin endpoints + constants module shared with T7460; design gate passed)
**Created:** 2026-11-03
**Updated:** 2026-11-05 (design approved; scope re-centred on the funnel, paid-ads apparatus to T15200)

**Design approved 2026-11-05: [T14910-design.md](T14910-design.md) (revision 3) governs the
build; where this file and the design differ, the design wins.** What changed from the text below:

- Gates are grouped into three tiers (can we read a test / is the funnel clean / do the economics
  work) with a named **focus**; grey gates show progress to the floor and an A-labelled date.
- Every coloured chip carries a confidence state, **settled** or **provisional**, from its 95%
  interval against the deciding threshold (owner question 2026-11-05: "1 user in a filter who
  happened to purchase"); provisional figures are italic with the interval and the n-to-settle on
  hover; verdicts clear only on settled states.
- Two verdicts: measurement flight allowed (gates 1 to 5 and 10) and channel economics (GO / TEST
  / NO by point estimate, NO at the upper bound before the floor). "Undecided" is retired.
- **Tier B funnel gates get Diagnose drawers** (weekly, by build, by platform, by country, drill
  links into the inspector, user list and upload-failure panel): the tools to fix the funnel and
  understand it in detail (owner steer 2026-11-05). Tier C and the ladder are one line by default.
- **Moved to [T15200](T15200-paid-ads-tracking-separate-from-referrals.md)**: registry spend
  columns and their migration, the campaign Save gesture, measured ladder values, the live-campaign
  block, and the Paid ads / Referral programme separation. This task is read-only, no migration;
  gates 10 and 11 read grey until T15200. `paused` is dropped from the payload (nothing could set it).
- Gate 3 reads `user_usage_daily` (test accounts excluded) with the all-accounts `daily_counters`
  value beside it as a labelled reference. T7460 stays separate.

User request 2026-11-03: "Is there a particular value we are waiting in the analytics for before we
can spend money? ... color code values ... so it's clear what we need to focus on ... and when we can
spend."

**From T15100 (2026-11-05):** this endpoint's payload must include `signups_by_country` for the
window, so the panel can show the US share beside the search-click share. T15100 could not add it
because the endpoint did not exist yet; `user_segments.country` is in place, NULL reads as "unknown".

## Problem

The 2026-11-03 ad-spend model ([ua-roi-model-2026-11-03.md](../ua-roi-model-2026-11-03.md)) found
paid acquisition loses money in every product state: contribution per sign-up is $0.15 measured,
$0.32 after the fix list, $1.56 optimistic, against $9 to $58 per paid sign-up. The decision to
spend therefore hangs on a short list of measurable values, each with a target. Today those values
are spread over the Journey map, the pulse cards, the money ladder and a one-off read-only query.
Nobody can see at a glance which gate is red and whether spending is allowed.

## Solution

**Revised 2026-11-04** after the top-down and channel research
([topdown-vs-bottomup-2026-11-04.md](../bi/topdown-vs-bottomup-2026-11-04.md) sections 8 to 10 and
the owner's question "can the gates reflect when it is time to start marketing"). Three things the
2026-11-03 version got wrong: (a) the verdict was one global SCALE against a single channel
constant ("Meta $25"); viability is per channel, and the channels differ 20x in cost per sign-up
(coach codes in credits $0.72, Reddit's cheapest inventory $1.67, Meta central $12, club placement
fees fixed); (b) the kickback channels pay in credits at a 14:1 face-to-cost ratio and on results,
so they cross break-even long before any ad does and the panel must show that order; (c) the
channel costs are benchmarks until the test runs, after which the panel must prefer the measured
value from T15120's attribution read-out and say which label it is showing.

One admin panel, "Spend readiness", in two blocks.

**Block A, funnel gates** (rows 1 to 9 below): current value with its N, target, green / yellow /
red / grey chip, one line on why, computed-at. These answer "is the funnel clean enough that a
cohort we pay for will behave like organic".

**Block B, channel ladder**: one row per acquisition channel, ordered by cost per sign-up, each
coloured by the computed break-even CAC per sign-up (gate 6 x gate 7 minus variable cost, the
formula below) against that channel's cost per sign-up:

- green **GO**: break-even is at or above the channel's cost per sign-up;
- yellow **TEST**: break-even is at least half the cost (within 2x), or the cost is still a
  benchmark (B) and the funnel gates 2, 3 and 4 are green or yellow;
- red **NO**: break-even is under half the cost;
- grey: break-even itself is grey (gate 6 or 7 under the small-N floor).

The verdict line above both blocks names the channels by state, for example
"Start marketing: coach codes GO; Reddit Ads TEST; Meta NO; club placement NO", and prints the
break-even number ("paid breaks even below $X per sign-up"). "Everything green" means every funnel
gate green and at least one channel row GO; the owner's cue to start marketing is that line, not a
single colour.

### Channel ladder (constants in the same module; B values are replaced by M values automatically)

| Channel | Cost per sign-up, benchmark (constant) | Replaced by the measured value when | Where the measured value comes from |
|---|---|---|---|
| Coach codes, credits only (+24 plays per parent, Season pack per coach) | $0.72 (A: 24 plays x $0.03 GPU) | credit grants to attributed sign-ups exist (T15090 or its successor) | ledger grants / attributed sign-ups |
| Coach codes with gift cards ($25 at 5 and at 10 sign-ups) | $1.29 (A, at 25% team take-up) | cards paid are recorded as campaign spend | spend / attributed sign-ups |
| Reddit Ads, cheapest (non-US, community targeting) | $1.67 (A: CPC $0.25 at 15% landing) | a Reddit campaign id has 43+ attributed sign-ups (95% read within about 30%) | registry spend / attributed sign-ups |
| Reddit Ads central, Meta low | $6 (A/B, 2026 CPC and landing benchmarks) | same, per campaign id | same |
| Meta Reels central | $12 (A/B) | same | same |
| Club placement (fixed fee) | $300 fee / attributed sign-ups; grey until 20+ attributed | always computed from spend once entered | same |

Spend per campaign id is entered by the owner (a `spend_cents` field on the v038 `campaigns`
registry, in scope here if T15120 did not add it); without spend the row shows the benchmark with a
B tag. Every row shows its label (B or M) and its N beside the colour.

### Gates (thresholds are named constants; values below are what prod showed on 2026-11-03 and 2026-11-04)

| # | Gate | Source (read only) | Green | Yellow | Red | 2026-11-03 |
|---|---|---|---|---|---|---|
| 1 | Visit -> sign-up | T7410's `visit_daily` once it exists; until then grey "not instrumented". Paid campaigns can be read before T7410 from the platform's own landing-page-view count entered beside spend on the campaign registry (optional `landing_views` field); organic needs the beacon | >= 5% | 2 to 5% | < 2% | no data |
| 2 | Sign-up -> true export <= 14 d, trailing 90 d of MATURE cohorts | `user_actions` `credits_consumed` `first_at` vs `users.created_at` | >= 25% | 15 to 25% | < 15% | 17.8% (Oct cohort) |
| 3 | Upload failure share, 90 d | `daily_counters` failed / (succeeded + failed) | < 10% | 10 to 20% | >= 20% | 18.7% |
| 4 | Finished -> took away | `overlay_exported` or true export vs `video_downloaded` / `share_completed` | >= 80% | 60 to 80% | < 60% | 42% (undercount until T14840) |
| 5 | Money ladder has a denominator since the reprice (`REPRICE_DATE = 2026-10-24`) | `paywall_shown` users, `credit_purchased` users | >= 20 paywall users AND >= 5 purchases | >= 10 and >= 2 | below | 1 and 0 |
| 6 | Payers per 100 sign-ups, trailing 90 d cohorts | `payments` kind = purchase vs `users` | >= 5 | 2 to 5 | < 2 | 1.07 (all time) |
| 7 | Revenue per payer, trailing 180 d | `payments` gross cents / distinct payers | >= $35 | $20 to $35 | < $20 | $18.99 (n = 4, so grey) |
| 8 | Repeat purchase: share of payers whose first purchase is 6+ months old who bought again at least 120 days after it (sport-agnostic; the product serves every recorded sport, so "next soccer season" is the wrong window) | `payments` | >= 25% | 15 to 25% | < 15% | grey until at least 20 payers are 6+ months old (first reading around May 2027) |
| 9 | K-factor, trailing 90 d: referred sign-ups / all sign-ups (counts `referrals` rows, so end-card sign-ups count once T15070 ships) | `referrals`, `user_segments.referrer_id`, `users` | >= 0.05 (the level at which the optimistic column's referral reach is real: about 25 referred in 500 against 4 today) | 0.02 to 0.05 (above the Extole modelled-programme benchmark 0.0055, below the model) | < 0.02 (the share-loop kill level) | 0.008. Recalibrated 2026-11-04 from 0.25 / 0.05: the 0.25 target was a bound, not a benchmark (research: daily-use consumer products 0.15 to 0.25; low-frequency referral programmes about 0.005) |
| 10 | Attribution coverage: paid sign-ups carrying a campaign id over the platform-reported conversions for the same window; organic shown as informational | `user_segments`, registry spend rows | >= 95% | 85 to 95% | < 85% | 0 of 379 ever carried a UTM; grey until a campaign has spend |
| 11 | Kickback cohort pays: payers per 100 among sign-ups attributed to a coach or club code (the kickback kill rule) | `user_segments.origin` in registry ids of kind coach or club, `payments` | >= 5 | 2 to 5 | < 2 | grey until 100 attributed sign-ups (designed read at 200); the one number that decides whether kickbacks are a channel or a measurement |

Small-N rule: any gate whose denominator is under 20 renders grey "insufficient data (n = …)", never a
colour. No season logic anywhere (owner rule 2026-11-03: seasons differ per sport and per league, never
assume them): gates never "pause" on a calendar. If sign-up volume in the trailing window is under the
small-N floor the gate goes grey, which is the only volume-related suppression, and it is derived from
the measured volume, not from a date.

Break-even CAC per sign-up (printed, not gated): payers per sign-up (gate 6) x revenue per payer
(gate 7) minus variable cost per sign-up, where variable cost = export rate x plays per exporter x
`GPU_PER_PLAY` + games per sign-up x `STORAGE_PER_GAME` + payers x (revenue x 2.9% + purchases x
$0.30). Cost constants and the channel ladder constants (table above; the 2026-11-03 "Meta $25,
partnership $5.50" pair is retired) live in the same constants file. Reference values for the
reader: break-even is $0.12 on 2026-11-04 measurements, $0.29 at the fix-list targets, $1.54 at the
optimistic targets; so at the optimistic state coach codes in credits are GO, Reddit's cheapest
inventory is TEST, Meta is NO. Revenue per payer (gate 7) is the only input that moves Meta into
range (about $120 per payer per year at 4.9% payers), which is a pricing decision, not a funnel fix;
the panel prints that sentence under the ladder when gate 7 is the binding input.

### Backend

- New read-only service `src/backend/app/services/analytics_spend_readiness.py` composing SQL over
  `users`, `user_segments`, `user_actions`, `payments`, `daily_counters`, `referrals`. Excludes test
  accounts via the existing admin `_test_exclusion` helper. No new tables, no new Postgres state, no
  writes.
- New endpoint `GET /api/admin/analytics/spend-readiness` on the admin router (admin session), one
  JSON payload: `verdict`, `break_even_cac`, `gates[]` with `{key, label, value, n, target, rag,
  why, paused, computed_at}`.
- Constants module `src/backend/app/services/spend_readiness_constants.py`: thresholds, reprice
  date, repeat-purchase windows, cost constants. Plain module-level constants, greppable, no DB editor.

### Frontend

- `src/frontend/src/components/admin/SpendReadinessPanel.jsx` at the top of the Journey tab (above
  the loss ranking strip), collapsible; the verdict line is always visible when collapsed.
- Reuse the RAG chip from T14900 (one component, one palette).
- Each row: label, value with n, target, chip, why (one sentence), paused tag if applicable.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_spend_readiness.py` (new)
- `src/backend/app/services/spend_readiness_constants.py` (new)
- `src/backend/app/routers/admin.py` - mount the endpoint next to the journey endpoint
- `src/backend/tests/test_admin_spend_readiness.py` (new) - seeded fixtures per gate, RAG boundaries, small-N, paused
- `src/frontend/src/components/admin/SpendReadinessPanel.jsx` (new) + test
- `src/frontend/src/components/admin/JourneyTab.jsx` - placement
- `src/frontend/src/stores/adminStore.js` - fetch

### Related Tasks
- After: T14710 (true export event), T14720 (counts), T14840 (download unblocked; gate 4 is an
  undercount until then).
- Needs for gate 1: T7410 (visit beacon). Until it lands the gate is grey, by design.
- Shares pattern with: T7460 (success-criteria scorecard). Design gate decides whether T7460's six
  criteria render in this panel (one scorecard) or stay separate; either way ONE constants pattern and
  ONE chip component.
- Feeds: T14920 (Next Step panel reads the verdict and the reddest gate).
- Added 2026-11-04: reads T15120's per-dimension columns (`_segment_group_rows`) for gates 10 and
  11 and for measured channel costs; T15070 makes gate 9 count end-card referrals; T15100 lets the
  ladder show US and non-US channel rows separately once a campaign has both. Spend entry on the
  registry (`campaigns.spend_cents`, optional `landing_views`) is in scope here unless T15120 adds it
  first; one owner gesture per campaign per update, never reactive.

### Technical Notes
- Read only. The panel never writes. Gestures: none.
- "Trailing 90 d of mature cohorts" means sign-ups between 104 and 14 days ago, so every counted
  user had the full 14-day window.
- The "today" values in the table are a dated snapshot for the task reader; the panel computes live.
- Thresholds come from the model's checklist (section 7 of the linked doc) and from the founder's
  activation targets; changing one is a one-line constant edit with a commit message saying why.

## Implementation

### Steps
1. [x] Design doc: [T14910-design.md](T14910-design.md), approved 2026-11-05 (revision 3).
2. [x] Failing backend tests: pure rules on every boundary incl. confidence and settle-n, seeded
       readers per gate, diagnosis cuts, both endpoints admin-only (`tests/test_admin_spend_readiness.py`).
3. [x] Constants + service (rules, readers, diagnosis) + two endpoints.
4. [x] Frontend panel (tiers, focus, confidence rendering, drawers, collapsed verdict line); chip
       shared with T14900; gate-4 threshold sync test.
5. [x] Screenshot desktop and phone (qa/T14910-*.png, fixture payload); live values at the human test.

### Progress Log

**2026-11-03**: Filed from the ad-spend ROI session. Prod values in the table are from the read-only
aggregate pull of the same day.

**2026-11-04**: Revised before build (owner question: "can the gates reflect when it is time to start
marketing"). Global SCALE verdict replaced by a per-channel ladder (GO / TEST / NO per channel)
against the computed break-even CAC; channel costs are benchmark constants until a campaign's
measured value exists; gate 9 recalibrated (0.05 / 0.02); gate 10 given a definition; gate 11
(kickback cohort payer rate) added; spend entry on the registry brought into scope. Sources:
topdown-vs-bottomup-2026-11-04.md sections 8 to 10, club-coach-kickback-research-2026-11-04.md,
test-confidence-research-2026-11-04.md.

**2026-11-05 (build)**: Implemented per the revision-3 design. Deviations worth knowing: cohort
gates key on `user_segments.acquired_at` (the `first_highlight_14d` precedent; a deleted payer
keeps its segment row but loses `users.created_at`); gate 3 reads `user_usage_daily` with no
column guard (v042 is applied everywhere; a missing column fails loudly); the K-factor prints as
"per 100 sign-ups" (admin 2-decimal rule); gate 1 is grey with a logged warning if `visit_daily`
ever appears before its reader exists. Diagnosis cuts are named (`weekly`, `by_build`,
`by_platform`, `by_country`) rather than a caller-supplied SQL expression.

**2026-11-06 (follow-up, Playwright check of the stack at 8a1d48eb9)**: with 0 sign-ups and 0
payers the ladder read "NO even at the upper bound $0.00, settled" on every priced row while the
break-even row said "not readable". Cause: `_break_even` treated a missing revenue per payer and
missing intervals as zero (a silent fallback for internal data), manufacturing an upper bound.
Now a missing factor gives null bounds plus `break_even.no_estimate`, grey ladder rows ("no
break-even yet: 0 payers in 180 d"), a "no estimate yet" verdict sentence and break-even row; a
real upper bound under the floor still settles NO on the dear channels (design section 4).
Tests through `build_spend_readiness` (empty DB; 30 sign-ups and no payer; 100 sign-ups and one
payer) plus a panel test; live dev check: no settled channel.

**2026-11-06 (review follow-ups, PR #712)**: three MAJOR findings fixed test-first. (1) Stale
Diagnose drawer: `fetchSpendReadiness` now empties the diagnosis cache, an open drawer reads
again when its entry is gone, and sequence numbers drop an older response (per gate and for the
panel payload). (2) Gate 5 rate divided the since-reprice paywall count by a flat 90 days; it
now divides by the days observed since `REPRICE_DATE`, capped at 90 (test with concrete rate and
ETA). (3) Repeat purchase's drawer was always 0 of 0 (eligible payers are 180 d old, the cut
showed the last 12 weeks): removed; the backend sends `diagnosable` per gate and the route
validates with the same rule. Small items: K-factor server text in "per 100" like the chip; the
unused `readable` parameter of `channel_rows` removed; the route's `except KeyError` removed
(validation first, bugs propagate); the drill's n − k count dropped from the Users chip.

**2026-11-06**: Independent verification found the Step Inspector drill missing and the gate 4
drill listing a subset of the gate's lost users. Added "Open in Step Inspector" on every drawer,
and the gate 2 and 4 drills now use the gate's own query (`spend_gate`), so the list equals n − k.

## Acceptance Criteria

- [ ] Endpoint returns all eleven gates with rag in {green, yellow, red, grey}, each with its tier,
      interval, confidence (settled / provisional / null), unblock and settle fields; never a
      missing gate. `focus` names the first tier with work to do and its worst gate.
- [ ] 1 payer among 20 reads provisional green, never settled; a value on the threshold never
      settles; `all_green` is refused by a provisional green; the flight verdict is blocked by a
      provisional red.
- [ ] Channel ladder returns one benchmark row per channel with cost, label B, break-even and state
      in {GO, TEST, NO, grey} plus confidence; tests cover the four reference cases (optimistic
      state: coach GO, Reddit cheapest TEST, Meta NO; today: Reddit NO settled, coach NO provisional,
      club grey). Measured values are T15200's.
- [ ] Break-even CAC printed with the formula's inputs in a details row; point and upper bound.
- [ ] Each Tier B gate's Diagnose drawer returns weekly (12), by build (4), by platform, by country
      cuts with per-cut confidence, and drill links that open the existing tools with the filter
      applied; the drawer loads on open, not on mount.
- [ ] Caveats are data-derived (`exports_started = 0` prints the undercount warning) and no task
      status is hardcoded in the backend.
- [ ] Gate 4's green threshold equals `JOURNEY_TARGETS['finished->took_away'].target` (cross-language test).
- [ ] Small-N rendering per the honesty convention; no season-based pausing anywhere.
- [ ] Test accounts excluded; no writes; no migration; backend test file in the CI shard durations list.
