# T14910 Design: spend-readiness gates (revision 3, approved)

**Status:** APPROVED by the owner 2026-11-05 ("i approve your designs"), with the revision-3 steer
below applied. Implementation follows this document.
**Canvas (visual design, private to the owner):** https://claude.ai/artifact/PGhmCNERXCEgsxDHdJTtZ2
(boards: desktop expanded, phone, collapsed, Diagnose drawer; the two paid-ads boards are T15200's
reference).

## Revision 3 (owner steer 2026-11-05: "focus on the tools we need to fix the funnel and understand it in a detailed way")

- **Paid-ads apparatus leaves this task.** The v044 registry columns, the campaign Save gesture,
  measured ladder values and the live-campaign block (old §5 and §6) are now
  [T15200](T15200-paid-ads-tracking-separate-from-referrals.md), blocked until the funnel gates
  read green. T14910 is read-only, no migration. Gates 10 and 11 read grey "registry columns
  arrive with T15200"; the ladder is benchmark-only with the settled/provisional rule.
- **Tier B is the centre of the panel.** Each funnel gate gains a Diagnose drawer (§5, new) that
  answers "where is the loss, did the fix move it": weekly series, by build, by platform, by
  country, and drill links into the existing inspector, user list and upload-failure panel.
- **Tier C and the ladder shrink to one line each by default** ("Economics: not readable; 4 of 20
  payers, about 12 months"), expandable. The verdict keeps both answers.
- The referral programme (epic T15210, T15160 to T15190) is tracked separately from paid ads in every
  admin view; this panel's ladder gets its row in T15200.
**Task:** [T14910-spend-readiness-gates.md](T14910-spend-readiness-gates.md)
**Base:** `80d6c50ac` (T14900 committed; `RagChip` and `journeyTargets.js` available)
**Sources checked:** [ua-roi-model-2026-11-03.md](../ua-roi-model-2026-11-03.md) §2, §3, §7;
[topdown-vs-bottomup-2026-11-04.md](../bi/topdown-vs-bottomup-2026-11-04.md) §4, §9, §10.3;
[revenue-outlook-2026-11-04.md](../bi/revenue-outlook-2026-11-04.md) §1, §5 (prerequisites, daily
read-out, kill criteria); [T14920](T14920-next-step-panel.md); the Journey tab and pulse cards as built.

## 1. What this revision changes, and why

Revision 1 fixed four contradictions in the task file. This pass asked a different question: what
does the owner need to see, every week, to drive the funnel to the point where spend is allowed, and
then to drive a flight once it starts? Checked against the source analyses, the task's flat list of
eleven chips fails that test in five ways. Each has a fix below; together they are the design.

| # | Assumption in the task | What the sources say | Change |
|---|---|---|---|
| 1 | Eleven gates in one list | The gates answer three different questions in sequence: can we read a test, is the funnel clean, do the economics work. Each question is unblocked by a different kind of work (ship a task, fix the product, wait for volume) | Gates are grouped into three tiers; the panel names the tier the owner is stuck on (**focus**) |
| 2 | A gate under the floor is grey, full stop | Eight of eleven gates are grey today. Gate 7 needs 20 payers; prod has 4 at about 1.3 a month, so the ladder stays grey for about a year. Grey answers "can we spend" with silence | Grey gates show progress to the floor and an estimated date (`4 of 20 payers, about 12 months at the 90 d rate`, label A). "When" is answered with a date, never only a colour |
| 3 | A gate's colour is a funnel fact | Gates 2 and 4 are undercounts while the Frame export emits no event (T14710) and the download is blocked (T14840). A red caused by missing instrumentation is a measurement problem; the owner must not "fix" the funnel for it | Caveats are **derived from data** (`exports_started = 0 in 30 d` → "Frame export records no event, undercount"), never hardcoded task statuses |
| 4 | The ladder is GO / TEST / NO by break-even, grey under the floor | Today's data already decides most of the ladder. At the upper 95% bound of 4 payers, break-even is about $0.77; any channel costing more than twice that is NO at any plausible reading. That is the ROI model's own conclusion ("paid works only under $2 per sign-up"), and it is readable now | A channel is **NO at the upper bound** when even the optimistic break-even is under half its cost; rows the bound still covers read **undecided** with the payers needed. GO / TEST / NO by point estimate once the floor is met |
| 5 | TEST means "within 2x of break-even, or a benchmark cost while the funnel is healthy" | The OR clause was written for the **$1,000 measurement flight**, which is "a measurement purchase, not a growth channel" (revenue outlook §5) and is allowed regardless of ROI once the prerequisites ship. Folding that into a per-channel ROI state is what made Meta read TEST in the optimistic state against the task's own reference values | Two verdicts, not one: **measurement flight allowed?** (one panel-level answer from gates 1 to 5 and 10, the outlook's prerequisite list) and **channel economics** (GO / TEST / NO / undecided per channel). Meta reads NO on economics and can still be the flight's channel |

Two further additions from the same reading:

- **Window and recent.** A 90 d window is right for a verdict but hides a fix landing: a change that
  shipped two weeks ago moves 90 d numbers by a sixth. Cohort gates carry a second read, the last
  30 d of the same definition, so direction is visible before the gate flips.
- **Live campaigns.** The outlook's daily read-out and kill criteria (attribution coverage under 95%
  at day 10, cost per sign-up over $40 at day 30, paid render rate under 60% of organic, paid upload
  failure over 20%) are computable from `_segment_group_rows` (T15120) plus the campaign's spend. A
  block that appears only when a campaign has spend turns the panel from "can we spend" into "we are
  spending, should we stop". This is the one scope extension; strike it and the rest stands.

Every number carries the house label (M measured, A assumption, B benchmark, F forecast) as the BI
documents do, and every proportion carries its 95% Wilson interval, so a chip's confidence is on
the screen rather than in a footnote.

## 2. The three questions

```
Tier A  Can we read a test?        gates 1, 5, 10 + instrumentation checks     unblocked by SHIPPING
Tier B  Is the funnel clean?       gates 2, 3, 4                               unblocked by FIXING
Tier C  Do the economics work?     gates 6, 7, 8, 9, 11 -> break-even -> ladder unblocked by VOLUME / TIME
```

**Focus** is the first tier with a gate that is red, yellow or grey-for-missing-instrumentation,
then the worst gate in it (red before yellow before grey; ties by gate number). A tier whose only
non-green gates are waiting on volume is not a focus (nothing to do but wait; the panel says so with
the date).

### Confidence states (owner question 2026-11-05: "1 user in a filter who happened to purchase")

The floor of 20 is on the denominator, so 1 payer among 20 paywall users reads 5.00% and would
turn gate 6 green on an interval of 0.3% to 24%. A colour is a claim ("value is at or above the
target"); the chip must show whether the data supports the claim. Every coloured chip therefore
carries one of three states, decided by its 95% interval against the threshold that gives it its
colour (Wilson for proportions; mean ± 1.96 SE for revenue per payer, assumed CV 0.6 under n 5;
Poisson for cost per sign-up):

| State | Rule | Rendering |
|---|---|---|
| **settled** | the whole interval is on one side of the deciding threshold | solid chip, upright figures |
| **provisional** | the interval crosses the threshold; colour by the point estimate | *italic figures*, 1 px underline; `title` and hover: the interval, "crosses 15% (yellow)", and the sign-ups needed to settle |
| **grey** | denominator under `SMALL_N_FLOOR` | dashed, as before |

`settle` is computed per gate: the smallest n at which an interval centred on the current point
estimate would exclude the threshold (solved on the Wilson form, not the Wald approximation, which
understates small rates), then `more = n_needed − n` and `eta_days = more / rate_per_day`, labelled
A. A value sitting on the threshold prints "cannot settle at this rate". The last-30-day column
follows the same rule and will usually be provisional, which is the honest reading of a direction.

The ladder uses the same vocabulary, which retires "undecided": a channel is **settled** when the
point estimate and the upper bound give the same state (Meta: NO at both), **provisional** when
they differ (coach codes in credits: NO at the point $0.12, GO at the bound $0.77, "16 more payers
to settle"). The lean is always shown; it is never hidden behind a neutral word.

Verdicts are asymmetric by design, easy to block and hard to clear:

- `measurement_test.allowed`: no gate 1 to 5 red by point estimate (settled or provisional), none
  grey for missing instrumentation, gate 10 not red, Frame export event live. `blocking` lists the
  gate keys otherwise. This is the outlook's prerequisite row "T14910 verdict reads TEST ONLY".
- `channels[].state`: economics per channel (§4). `all_green` is every gate **settled** green and
  at least one channel **settled** GO: the owner's "start marketing" cue. A provisional green never
  clears a verdict; the line says what would settle it.

The verdict line names the state of each number it cites ("upload failure 28.70% red, settled;
export within 14 d 12.50% red, provisional"). The panel legend carries the three renderings; the
rendering never relies on italics alone (the interval is printed beside the value, and
`data-confidence` is on the chip).

The verdict line composes both, for example today:

> **Not yet: fix the funnel.** Upload failure 28.7% and export in 14 d 12.5% are red. Measurement
> flight blocked by 5 gates (first: visit beacon, T7410). Paid channels at any plausible reading:
> Meta NO, Reddit NO; coach codes undecided (4 of 20 payers, about 12 months). Break-even today
> $0.12, at most $0.77.

## 3. Gates

Common rules: test accounts excluded via `_test_exclusion(True)` (every query LEFT JOINs `users u`
and exposes `s`); denominator under `SMALL_N_FLOOR = 20` reads grey with progress; no calendar logic
anywhere; "mature cohort" means signed up between 104 and 14 days ago. Thresholds are constants in
`spend_readiness_constants.py`; the values below are the task's.

| # | Key | Tier | Value (window) | Recent | Source | Green / yellow | Grey rule, unblock kind | Data-derived caveat |
|---|---|---|---|---|---|---|---|---|
| 1 | `visit_to_signup` | A | organic visits → sign-ups, 7 d | – | `visit_daily` when T7410 exists (`to_regclass`); until then grey "not instrumented" | ≥ 5% / ≥ 2% | **task** (T7410). Paid: `landing_views` entered on a campaign gives that campaign's own read in Block C | – |
| 2 | `signup_to_export_14d` | B | mature sign-ups with `credits_consumed` or `export_completed` `first_at` ≤ 14 d after `users.created_at` (`FIRST_HIGHLIGHT_ACTIONS`) | last 30 d of mature sign-ups | `user_segments`, `users`, `user_actions` | ≥ 25% / ≥ 15% | volume | `daily_counters.exports_started = 0` over 30 d → "Frame export records no event; undercount until T14710 is live" |
| 3 | `upload_failure` | B | failed / (succeeded + failed) over `user_usage_daily`, 90 d or since v042 if shorter (span printed) | last 30 d | `user_usage_daily` (test-excluded) | < 10% / < 20% (lower is better) | volume (20 attempts, about two days) | **reference** value beside it: `daily_counters` 90 d, labelled "incl. test accounts", so the owner is not blind while the primary fills |
| 4 | `finished_to_took_away` | B | users with `video_downloaded` or `share_completed` among users with `overlay_exported` or export, mature cohort | last 30 d | `user_actions` | ≥ 80% / ≥ 60% | volume (19 today) | same `exports_started` caveat as gate 2; green threshold synced to `JOURNEY_TARGETS['finished->took_away'].target` by a cross-language test |
| 5 | `money_ladder_n` | A | distinct `paywall_shown` users and `credit_purchased` users since `REPRICE_DATE` | – | `user_actions` | ≥ 20 & ≥ 5 / ≥ 10 & ≥ 2 | never grey (counts); unblock volume with ETA from the 90 d rate | – |
| 6 | `payers_per_100` | C | payers (`payments.kind = 'purchase'`, distinct user) per 100 sign-ups, 90 d cohort | last 30 d | `payments`, `users` | ≥ 5 / ≥ 2 | volume | interval printed (4 of 375 is 0.4 to 2.7) |
| 7 | `revenue_per_payer` | C | gross purchase cents / distinct payers, 180 d | – | `payments` | ≥ $35 / ≥ $20 | **volume**: payers to 20, ETA | interval: sample SD at n ≥ 5, else assumed CV 0.6 (A) |
| 8 | `repeat_purchase` | C | payers whose first purchase is ≥ 180 d old who bought again ≥ 120 d after it | – | `payments` | ≥ 25% / ≥ 15% | **time**: "0 of 20 eligible; first payer eligible 2027-03-xx" (earliest first purchase + 180 d) | – |
| 9 | `k_factor` | C | `referrals` rows whose referred user signed up in the 90 d / all sign-ups in the 90 d | last 30 d | `referrals`, `users` | ≥ 0.05 / ≥ 0.02 | never grey (hundreds of sign-ups) | – |
| 10 | `attribution_coverage` | A | sign-ups whose `origin` is a campaign id with spend / Σ `platform_conversions` of those campaigns | – | `user_segments`, `campaigns` | ≥ 95% / ≥ 85% | grey "no paid campaign yet" (unblock: none, informational) | – |
| 11 | `kickback_payers_per_100` | C | payers per 100 among sign-ups whose `origin` is a campaign with `channel` in coach or club | – | `user_segments`, `campaigns`, `payments` | ≥ 5 / ≥ 2 | **volume**: 100 attributed sign-ups (task's floor) | – |

Each gate's payload row:

```
{ key, tier, label, rag, value, unit, n, interval: [lo, hi] | null, label_kind: "M",
  confidence: "settled" | "provisional" | null,      // null when grey or a count gate
  settle: { crosses: 15, crosses_rag: "yellow", n_needed, more, eta_days } | null,   // A
  recent: { value, n, interval, confidence } | null, // last 30 d, same definition
  target: { green, yellow, direction: "higher"|"lower", text: ">= 25%" },
  why: "one sentence from the task",
  caveats: ["Frame export records no event ..."],    // data-derived only
  unblock: { kind: "task"|"volume"|"time"|"none", text,
             need: { have, floor, unit, eta_days, rate_per_day } | null },   // eta is A
  reference: { value, n, text } | null,              // gate 3's all-accounts read
  computed_at }
```

`unblock.kind = "task"` carries no task ids: T14920's `roadmap-stage-map.json` maps gate keys to
tasks, so statuses have one source. The backend says *what kind* of work unblocks a gate; the
roadmap says *which* task.

## 4. Break-even and the channel ladder

Break-even CAC per sign-up (cents, printed with every input visible in a details row):

```
payers_per_signup × revenue_per_payer − variable_cost_per_signup
variable_cost = export_rate × plays_per_exporter × GPU_PER_PLAY
              + games_per_signup × STORAGE_PER_GAME
              + payers_per_signup × (revenue_per_payer × STRIPE_PCT + purchases_per_payer × STRIPE_FIXED)
```

Inputs are the 90 d cohort's measured values (`plays_per_exporter` = Σ `credits_consumed.count` /
exporters; `games_per_signup` = Σ `game_upload_succeeded.count` / sign-ups). `GPU_PER_PLAY = $0.025`
(the model's figure; the ladder's "$0.03" benchmark is kept as a literal with a comment).

`upper_cents` = Wilson upper of payers per sign-up × upper of revenue per payer − variable cost,
labelled A ("product of two upper bounds; rough"). `readable` is true when gates 6 and 7 are both
at or above the floor.

Channel states, evaluated in this order:

| State | Rule (by the point estimate) | Confidence |
|---|---|---|
| grey | club row with under 20 attributed sign-ups | – |
| **GO** | break-even ≥ cost | settled when the lower bound also gives GO |
| **TEST** | break-even ≥ cost / 2 | settled when both bounds give TEST |
| **NO** | break-even < cost / 2 | settled when the upper bound also gives NO ("NO even at the upper bound $0.77") |

A state whose bounds disagree is provisional: italic, with the reason naming the other reading
and the payers needed to settle. Before the floor is met the point estimate is still used (it is
the best estimate there is), and the provisional rendering carries the uncertainty.

Checked against the task's reference values at the optimistic state (break-even $1.54, settled):
coach credits $0.72 GO, coach gift cards $1.29 GO, Reddit cheapest $1.67 TEST, Reddit central $6
NO, Meta $12 NO. Today (point $0.12, upper $0.77): Meta NO settled, Reddit central NO settled,
Reddit cheapest NO settled (0.77 < 0.835), coach gift cards NO provisional (TEST at the bound),
coach credits NO provisional (GO at the bound, 16 more payers), club grey. The acceptance
criteria's four cases (funnel-red NO, benchmark TEST, measured GO on coach codes with Meta NO, grey)
are all reachable; "funnel-red" now expresses itself through `measurement_test.blocking`, which is
where the outlook puts it.

**No estimate at all (follow-up 2026-11-06).** The rows above assume both factors are measured.
With no sign-up in the 90 d cohort, or no payer in 180 d, revenue per payer (or payers per
sign-up) has no value and no interval, so there is no point estimate and **no upper bound**; the
build had been reading the missing input as $0.00, which produced "NO even at the upper bound
$0.00, settled" on every priced row while the break-even row said "not readable". That is not a
settled reading: settled means the evidence excludes the other reading, and here there is none.
In that case `break_even.point_cents`, `lower_cents` and `upper_cents` are null and
`break_even.no_estimate` names the missing factor ("0 payers in 180 d"); every priced ladder row
is **grey** with the reason "no break-even yet: 0 payers in 180 d", the verdict line says
"Break-even: no estimate yet (0 payers in 180 d)", and the panel's break-even row prints the same
words instead of money. Grey, not provisional, because provisional is "coloured by the point
estimate, interval crosses a threshold" and here there is no point estimate to colour by; grey is
already the vocabulary for "counts only, under the floor" (gates under 20, the club row under 20
attributed sign-ups). `all_green` is unchanged: a grey row is neither GO nor settled. The
under-the-floor rule stays as written: one payer among 100 sign-ups gives a real (A-labelled)
upper bound of about $2.29 and still rules Meta and Reddit central out, settled.

Ladder rows are the task's six, ordered by cost. Cost is the benchmark constant (B) until a
campaign of that channel has 43 or more attributed sign-ups **and** spend entered, then
`spend_cents / attributed` (M) with the campaign ids named. A measured platform value replaces every
benchmark row of that platform (one measured Reddit row replaces both Reddit benchmark rows).

`binding_input`: when break-even is readable and no channel is GO, the input whose change to its
green threshold would first make one GO; the task's sentence about revenue per payer prints when
that input is gate 7.

## 5. Funnel diagnosis per gate (Tier B; the tools to fix the funnel)

A red funnel gate says *that* parents are lost; the driver needs *where* and *whether the last fix
moved it*. Each Tier B gate (2, 3, 4) has a Diagnose drawer, closed by default, loaded on open from
`GET /api/admin/analytics/spend-readiness/gate/{key}` so the panel's first paint stays one query:

| Cut | Definition | What it answers | Source |
|---|---|---|---|
| **Weekly** | the gate's own definition per sign-up week (gate 3: per attempt week), last 12 weeks, each with n, interval and confidence; sparkline with the interval as a band, target as a line | trend before the 90 d number moves | same readers, grouped by week |
| **By build** | the last 4 `user_segments.signup_build` values with value, n, confidence | did the deploy that carried the fix move the cohort it created | `signup_build` (v039); `BuildsGrid` is the existing precedent |
| **By platform** | mobile vs desktop (the Journey map's family rule: `pwa-*` / `webapp-*`) | is the leak a phone leak (54% of sign-ups are mobile) | `user_actions.platform` |
| **By country** | top 3 plus unknown | is the leak a geography (the non-US 40% of search clicks) | `user_segments.country` (v043) |
| **Drill** | links that open the existing tools with the gate's filter applied | the people behind the number | StepInspector (stage), Users list (`journey_stage` / `journey_outcome`, T14740), `UploadFailuresPanel` (gate 3) |

Every cut carries the settled/provisional rendering; a cut whose n is under the floor prints the
count, never a percentage. Nothing here is a new stored datum or a new query shape: the gate reader
takes an optional `group_expr`, the same device `_segment_group_rows` uses. Gate 3 by build and by
platform come from `user_usage_daily` joined to `user_segments`.

Tier A gates have no drawer (they are shipped, not diagnosed). Tier C gates get the weekly cut only
(payers and K move too slowly for the other cuts to mean anything), behind the same toggle.

## 6. Moved to T15200

Registry spend columns, the campaign Save gesture, measured ladder values, the live-campaign block
with the outlook's kill checks, and the Paid ads / Referral programme separation across the admin:
[T15200](T15200-paid-ads-tracking-separate-from-referrals.md). The canvas boards "Live campaigns"
and "Campaign entry" stay as that task's reference.

## 7. Frontend

`SpendReadinessPanel.jsx` at the top of the Journey tab, above the loss strip (T14920 goes above
it). Collapsed by default; the verdict line is always visible.

```
▸ SPEND READINESS  Not yet: fix the funnel.  Upload failure 28.7% ■red · Export in 14 d 12.5% ■red
  Flight blocked by 5 gates (first: visit beacon) · Meta NO · Reddit NO · coach codes undecided (4/20 payers, ~12 mo)

▾ SPEND READINESS                                                        computed 19:12 UTC · M unless marked

  A  CAN WE READ A TEST?                                       3 gates · focus
  Gate                     Now (90 d)        Last 30 d   Target    Status      Unblock
  Visit → sign-up          not instrumented  –           ≥ 5%      ■ grey      ship T7410
  Money ladder n           1 paywall, 0 buy  –           ≥20 & ≥5  ■ red       volume: ~19 paywall users to go, ~9 mo (A)
  Attribution coverage     no paid campaign  –           ≥ 95%     ■ grey      enter spend on a campaign

  B  IS THE FUNNEL CLEAN?                                      3 gates
  Sign-up → export 14 d    12.5% (9.1–16.6)  16.0%       ≥ 25%     ■ red       ⚠ Frame export records no event (undercount)
    n 321                  n 100
  Upload failure           28.7%  n 286      –           < 10%     ■ red       (since 2026-11-04; all accounts 90 d: 23.4%)
  Finished → took away     42% (8 of 19)     –           ≥ 80%     ■ grey      1 more finished highlight

  C  DO THE ECONOMICS WORK?                                    5 gates · waiting on volume
  Payers per 100 sign-ups  1.07 (0.4–2.7)    0.0  n 152  ≥ 5       ■ red
  Revenue per payer        $18.99  n 4       –           ≥ $35     ■ grey      4 of 20 payers · ~12 mo at 0.04/day (A)
  Repeat purchase          0 of 0 eligible   –           ≥ 25%     ■ grey      first payer eligible 2027-03-18
  K-factor                 0.008  n 379      0.000       ≥ 0.05    ■ red
  Kickback cohort payers   no coach/club campaign        ≥ 5       ■ grey      100 attributed sign-ups

  BREAK-EVEN per sign-up   $0.12 (at most $0.77, A)   ▸ inputs: 1.07% payers × $18.99 − $0.05 variable (0.125 export × 3.8 plays × $0.025 + 0.97 games × $0.05 + Stripe)

  CHANNELS                 Cost/sign-up      N     State
  Coach codes, credits     $0.72  B          –     undecided   needs 16 more payers
  Coach codes, gift cards  $1.29  B          –     undecided
  Reddit, cheapest         $1.67  B          –     NO          even at the upper bound $0.77
  Reddit, central          $6.00  B          –     NO
  Meta Reels               $12.00 B          –     NO
  Club placement           $300 fee / n      0     grey        20 attributed sign-ups
  Until a channel is GO, growth is the fix list, the share loop (K) and coach codes.

  SIGN-UPS BY COUNTRY (90 d)   US 61% · CA 9% · GB 7% · unknown 18%     (search clicks: 60% US)
```

Phone: one column; each tier a stacked list; the same `RagChip`; roadmap-style `▸` toggles; no
animation beyond the admin's. Every chip has `data-rag` and the interval in its `title`. Labels
(M, A, B) render as small caps after the value. Hidden rows never exist: a gate with nothing to
show prints why.

Store: `loadSpendReadiness()` in `adminStore.js`, fetched when the Journey tab mounts and on the
existing Refresh gesture; held as `spendReadiness / spendReadinessLoading / spendReadinessError`.
Read only; no `useEffect` writes.

## 8. Interplay

- **T14900:** gate 4's green threshold and `JOURNEY_TARGETS['finished->took_away'].target` must be
  the same number. A vitest reads `spend_readiness_constants.py` (the `questDefinitions.test.jsx`
  cross-language pattern) and fails on drift. Gate 2 measures a different thing from the Journey's
  end-to-end (14 d window versus ever); the `why` says so.
- **T14920:** reads `focus`, `verdict`, `gates[].key`, `gates[].unblock.kind` and
  `measurement_test.blocking`; its stage map keys on gate keys. Its spec's "NO / TEST ONLY / SCALE"
  predates the ladder; the panel's `verdict.line` is what it should print.
- **T7460** stays separate (different question, unbuilt dependencies); shares `RagChip` and the
  constants-module pattern.
- **T15100:** `signups_by_country` for the 90 d window, NULL as `unknown`.

## 9. Implementation plan

1. `spend_readiness_constants.py`: thresholds, windows (`MATURE_DAYS 14`, `COHORT_DAYS 90`,
   `RECENT_DAYS 30`, `REVENUE_DAYS 180`, `REPEAT_AGE_DAYS 180`, `REPEAT_GAP_DAYS 120`,
   `REPRICE_DATE`), floors (`SMALL_N_FLOOR 20`, `MEASURED_MIN_SIGNUPS 43`, `CLUB_MIN_SIGNUPS 20`,
   `KICKBACK_MIN_SIGNUPS 100`), costs, `CHANNELS` ladder (benchmark values), `WEEKLY_WEEKS 12`,
   `BUILDS_SHOWN 4`.
2. `analytics_spend_readiness.py`: pure rules first (`wilson`, `mean_interval`, `rag_for`,
   `confidence`, `settle_n`, `eta`, `break_even`, `channel_state`, `focus`, `verdict`), then one
   reader per gate `(cur, excl, now, group_expr=None)`, then `build_spend_readiness(cur, excl, now)`
   and `build_gate_diagnosis(cur, excl, now, key)`.
3. `admin.py`: `GET /analytics/spend-readiness` and `GET /analytics/spend-readiness/gate/{key}`,
   plain `def`, beside the journey route; minimal, since g-t15130-4 also edits the file.
4. `SpendReadinessPanel.jsx` (+ `GateDiagnosis.jsx`, `Sparkline` reuse from PulseCards) + store;
   placement in `JourneyTab.jsx`.
5. `.test_durations.json` entry; screenshots desktop and phone with seeded data.

Tests first, red before green:

- `test_admin_spend_readiness.py`: pure rules on every boundary (each gate green/yellow/red/grey,
  the lower-is-better gate, floor edge at 19/20, Wilson on 4/375, **1 of 20 reads provisional
  green, never settled**, settle-n on the Wilson form, a value on the threshold never settles, ETA
  with zero rate, the four ladder cases plus settled and provisional NO, focus ordering, flight
  blocked by a provisional red, `all_green` refused by a provisional green);
  seeded readers per gate (test account excluded, mature-cohort edges at 14 and 104 days, gate 3
  span, gate 8 eligibility date, gate 9 counting `referrals`, gates 10 and 11 grey with the T15200
  reason); diagnosis cuts (weekly bucketing at the week edge, by build ordering, platform family
  rule, country unknown kept, every cut under the floor prints counts only); both endpoints
  require admin.
- Vitest: panel collapsed line, tier grouping, focus mark, grey progress text, caveat rendering,
  provisional italics with `data-confidence`, Tier C collapsed by default, Diagnose drawer loads on
  open and never on mount, drill links carry the filter, `RagChip` reuse, the gate-4 sync test,
  store loaders.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Upper-bound NO is read as a verdict on 4 payers | Labelled A on the chip and the reason; the rule only ever says NO when the bound is under half the cost, never GO; the owner can raise `REVENUE_CV_ASSUMED` or drop the rule by constant |
| Query cost (eleven readers over `user_actions`, `payments`; diagnosis cuts) | Admin-only, on tab open; drawers load on demand; indexed columns; measured once seeded; readers share the cohort CTE |
| Weekly cuts read as trends at n 30 a week | Interval band drawn, confidence per point, counts printed under the floor |
| Panel competes with pulse cards and the upload panel for the same facts | It cites and links them (drill) rather than re-explaining; the upload alarm stays where it is |

## 11. Decisions (approved 2026-11-05)

Revision 1's four (TEST rule, v044, grey ladder, gate 3 source) are superseded; items 6 and 7
below moved to T15200 under the revision-3 steer. The owner approved the set.

1. Three tiers and a named focus instead of a flat list.
2. Grey gates show progress and an A-labelled ETA; intervals on every proportion.
3. Data-derived caveats only (no hardcoded task statuses in the backend).
4. Settled / provisional confidence on every chip, decided by the 95% interval against the deciding
   threshold; provisional figures italic with the interval and the n-to-settle on hover; verdicts
   clear only on settled states. The ladder's NO-at-upper-bound is this rule applied to channels.
5. Two verdicts: measurement flight allowed, and channel economics.
6. (moved to T15200) registry columns and the campaign Save gesture.
7. (moved to T15200) live campaigns with the outlook's kill checks.
8. Gate 3 primary from `user_usage_daily` with the all-accounts reference beside it.
9. Diagnose drawers on the funnel gates (weekly, by build, by platform, by country, drill links);
   Tier C and the ladder one line each by default.
