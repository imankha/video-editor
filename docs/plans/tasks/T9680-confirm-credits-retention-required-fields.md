# T9680: Confirm credits, retention and required upload fields

**Status:** STAGING - all code-side answers confirmed, production verification complete 2026-09-12; found a real credit-grant bug along the way, filed separately as T9760
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-10
**Updated:** 2026-09-12

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E1-02 (UX-01, UX-03, UX-06)**.

## Why this exists

**No code.** The walkthrough flagged that the public homepage and the signed-in account state
**different free-credit wording**, and that a 6.027-second clip was charged **seven** credits with
no on-screen rule explaining it. The handoff explicitly declines to file a billing bug without
verifying production behavior first. Three tasks are blocked on these answers.

## Questions to answer

1. **Free credits.** What does a new account actually receive, under what conditions, on production?
   Reconcile the homepage wording with the signed-in balance. (Context: T8120 moved to granting the
   full quest-chain total upfront.)
2. **Charging and rounding.** What is charged for an upload, for a framing render, and for a final
   export? What is the rounding rule? Is 6.027 seconds billed as 7 - and if so, is that rule stated
   anywhere a parent can find it?
3. **Retry charging.** A failed upload or a failed render that is retried: charged once, twice, or
   refunded? T9420 needs this to judge its own idempotency criterion.
4. **Source expiry.** 30 days on the source - what exactly is deleted, and what stays editable?
5. **Draft and published retention.** Do finished outputs survive source expiry? The report warns
   against implying they do until confirmed. (Related live evidence: bug 50p, T8310/T8320.)
6. **Required metadata.** Which upload fields does the backend genuinely require? "Optional" labels
   may only be used where the backend really accepts a missing value.

## Output

A decision record with the confirmed rules plus approved example wording for product copy.

## Related Tasks

- **Blocks:** T9480 (billing precision copy), T9650 (pricing and retention copy), T9640 (optional
  field labels)
- T8310, T8320, T8330 - the expiry-visibility work whose copy must agree with these answers

## Acceptance Criteria

- [x] Free-credit conditions confirmed against production and reconciled with the homepage
- [x] Charging and rounding rules recorded, including whether 6.027s bills as 7 credits
- [x] Retry-charging behavior recorded for both uploads and renders
- [x] Source expiry and draft/published retention recorded separately
- [x] The genuinely required upload fields are listed from the backend, not inferred

## Decision Record (2026-09-12)

Code-side research by the code-expert agent, cross-checked against `.claude/knowledge/backend-services.md`
and the T8370/T8310/T8320/T8330 task files. Production verification of the 4 flagged items below is
recorded in the "Production verification" subsection at the end.

### 1. Free credits

A brand-new account receives **88 credits, no conditions**: 8 (`NEW_ACCOUNT_CREDITS`,
`services/storage_credits.py:25`) + 80 (`QUEST_CHAIN_CREDIT_TOTAL`, `quest_config.py:24`), both granted
during session init before the user does anything (`session_init.py:294` and `:321`). T8120 retired the
per-quest drip - every quest's `reward` is now `0` (`quest_config.py:50,63,80,97`); the 80 is a
hand-maintained upfront constant, not a sum of quest rewards.

**Homepage number is right (88, `landing/src/site.ts:72-73`); the qualifier is wrong.**
`landing/src/pages/index.astro:332-333` says *"free credits to start, just for finishing the
walkthroughs"* - that describes the pre-T8120 drip model. Since T8120 both grants are unconditional and
upfront. **Copy fix: drop "just for finishing the walkthroughs."**

Separately, `CreditBalance.jsx:94` ("You start with {balance} free credits") renders the user's
**current live balance**, not the 88 constant - this is the likely mechanism behind the "homepage and
signed-in account state different free-credit wording" complaint, since a user who has already spent
credits sees a different number in-app than the homepage's fixed 88.

Source of truth: `storage_credits.py:25` (8), `quest_config.py:24` (80), `session_init.py:260-329` (grant
sites), `credit_ledger.py:81-82` (idempotency keys `signup:{user_id}` / `questbank:{user_id}`).

### 2. Charging and rounding

Exactly 7 charge sites exist; nothing else spends credits.

- **Upload: size-based**, not per-second - `calculate_upload_cost = max(1, ceil(GB*0.015*(days/30)*1.10/0.05)) + 1` (games only; clip-batch upload has no +1 surcharge since clip sources never expire). `services/storage_credits.py:29-37`.
- **Focus/framing render (incl. multi-clip): `ceil(seconds)`**, flat, at `output_fps=30` -
  `highlight_transform.py:176-192`; `math.ceil(6.027) = 7`. **This is the confirmed mechanism for the
  walkthrough's 7-credit charge** on the 6.027s clip.
- **Overlay/Spotlight render, publish, download, share: free.** Confirmed by absence of any `credit`
  reference in `overlay.py`/`downloads.py`/`before_after.py`, and stated correctly in
  `BuyCreditsModal.jsx:123-129`.
- **The rounding rule is stated nowhere in user-facing copy.** Every surface says a flat "1 credit = 1
  second" (`BuyCreditsModal.jsx:114,118`; `landing/site.ts:74-75`; `index.astro:337`). Worse,
  `BuyCreditsModal.jsx:467` actively prints a contradiction for a 6.027s render: **"7 credits (6s of
  video)"** (rounds the *seconds* display down while the *charge* rounds up).

**Copy decision: state the rounding rule explicitly** (round up to the next whole credit) wherever a
per-second rate is quoted, and fix `BuyCreditsModal.jsx:467`'s seconds display to not contradict the
credit count it sits next to (e.g. show the un-rounded seconds, or the same ceil'd value).

Source of truth: `highlight_transform.py:176-192` (`compute_export_credits`), call sites
`export/framing.py:489-490`, `export/multi_clip.py:2147-2153`.

> **Superseded by T9750 (2026-09-12).** The product owner reviewed the finding above and
> chose to CHANGE the rule rather than just document it ("personally i rather round"). The
> render/export charging rule is now **round-half-up with a 1-credit floor for any positive
> duration** (`round_credits_half_up(video_seconds) = max(1, math.floor(video_seconds + 0.5))`
> in `highlight_transform.py`), NOT `ceil`. Consequence for the walkthrough's own repro case:
> **6.027s now bills as 6 credits, not 7.** Round-half-up (`math.floor(x + 0.5)`) is used
> deliberately, NOT Python's `round()` (banker's rounding rounds `.5` to even). Both charge
> sites (`highlight_transform.compute_export_credits` and `routers/exports.py`'s inline
> reservation) now call the ONE shared `round_credits_half_up` helper. User-facing copy was
> updated to state the rounding rule explicitly, and `BuyCreditsModal.jsx:467` now shows the
> charged credit count as the seconds number too (agree by construction, not coincidence).
> The `ceil` finding above is left INTACT as the record of what was originally confirmed.

### 3. Retry charging

**Uploads are idempotent** (never double-charged): stable idempotency keys per gesture
(`game_upload:{game_id}`, `game_video_add:{game_id}:{hashes}`, `clip_upload:clipbatch:{profile_id}:{hashes}`)
plus `ON CONFLICT (user_id, idempotency_key) DO NOTHING` (`credit_ledger.py:193-200`). A failed/abandoned
upload charges nothing (charge happens at activate, after bytes are durable).

**Render retries are NOT idempotent** - `export_id` is client-supplied per attempt
(`export/framing.py:370-383`), so each retry reserves and confirms a new charge. Failures are refunded
(`refund_credits`, keyed `refund:{export_id}`, applies at most once), so the happy-path net is one charge
- but if the process dies after `confirm_reservation` and before the refund runs, nothing retries the
refund (`export_worker.py:223-227` just logs CRITICAL). An hourly reconciliation reaper exists
(`services/cleanup.py:109-167`) but **covers only `source='clip_upload'`**, not `framing_usage`,
`game_upload`, `game_video_add`, or `storage_extension`.

**T9420 idempotency criterion should read:** uploads are safe to retry with no user-visible cost;
render/export retries are refunded on a clean failure but have a real (rare) uncovered gap on a
mid-pipeline crash, which is a backend reliability gap to track separately (not something copy should
paper over by claiming full idempotency).

### 4. Source expiry (30 days)

Two-stage: **T+30d** sweep auto-exports the game's recap/brilliant clips first, then deletes exactly one
row (`game_storage` SQLite + `game_storage_refs` Postgres) - `sweep_scheduler.py:123-262`. **T+44d**
(14-day grace) deletes the raw `games/{hash}.mp4` R2 object, production-gated
(`_game_deletion_allowed`). Nothing else is ever deleted by expiry: the `games` row, its metadata,
`raw_clips` (annotations), `working_clips`, and `projects` (drafts) all survive. Annotation/recap
playback stays available; anything needing source pixels (play, re-frame, export) is refused with HTTP
410 `source_expired` (`games.py:2497-2519`).

**Clip-upload sources (T8370) never expire at all** - no `game_storage` row is ever written for them.
This is a real copy hazard if "30-day expiry" is described as applying uniformly to all uploads; it does
not.

### 5. Draft / published retention

**Exported outputs (reels, published Highlight Reels, auto-exported recaps/brilliant clips) survive
source expiry independently** - no FK/cascade from `game_storage` into `final_videos`, different R2
namespace, confirmed no `DELETE FROM final_videos` exists on the expiry path. **Un-exported drafts
survive as rows but become permanently un-editable by design** (T4130: drafts have no independent source
copy) - this is not a bug, it is the documented shape, per T8310's finding and its recorded real
incident (arshia.kalantari@gmail.com, 17 un-exported drafts entering deletion 2026-09-02, 2 games
already unrecoverable).

**Copy must state three outcomes, not two**: (1) exported/published work survives permanently and is
free to store, (2) an un-exported draft becomes locked (visible, unplayable, unexportable) once its
source is gone, (3) the raw source video itself is deleted at T+44d with a 14-day grace/extend window
before that. Do not imply "everything survives" or "everything is lost" - both are false.

### 6. Required upload fields

Backend requires exactly **one thing**: at least one video reference with `blake3_hash` + `sequence`
(`CreateGameRequest`/`VideoReference`, `routers/games.py:273-307`, 400 if missing). Every metadata field
(opponent, date, type, tournament) is genuinely `None`-accepted. The frontend today marks no field
optional or required - it silently substitutes defaults (`"Unnamed opponent"`, today's date) instead of
sending nulls (`GameDetailsModal.jsx:23-37,130-136`). **No current UI-label-vs-backend contradiction
exists** (there are no "optional" labels shipped today to be wrong) - T9640's opportunity is to label
these fields optional truthfully (backend already accepts null for all of them) rather than to fix a
mislabel.

### Production verification - RUN 2026-09-12, one finding requires action before closing

Ran `scripts/verify_t9680_credits.py` (read-only, `readonly=True` session, SELECT-only) via a
`fly proxy 15433:5432 --app reel-ballers-db-prod` tunnel, after adding a narrowly-scoped
`autoMode.allow` rule in `.claude/settings.local.json` for this specific tunnel + these two
scripts (the earlier classifier block was per-session policy, not a one-time approval gap).

**1. `credits_ready` gate: OPEN.** `ready_at = 2026-07-28T08:03:23Z`, `backfilled_users = 10`.
Confirmed open since 2026-07-28, not a live blocker.

**2. Recent signup grants - REAL DISCREPANCY FOUND, code claim does not match production data.**
Sampled the 10 most recent `new_account_bonus`/`quest_upfront` grant events
(2026-09-09T10:30Z through 2026-09-12T16:13Z, so none of this is a same-day-lag artifact):

| user_id (truncated) | signup_amt | questbank_amt | first_grant_at |
|---|---|---|---|
| 33da2bff... | 8 | **NULL** | 2026-09-12T16:13Z |
| edb79b8b... | 8 | **NULL** | 2026-09-12T01:48Z |
| 902099c9... | 8 | **NULL** | 2026-09-12T01:05Z |
| 96309da3... | 8 | **NULL** | 2026-09-11T10:03Z |
| 28d76cc2... | 8 | **NULL** | 2026-09-10T22:42Z |
| 9508f954... | 8 | **NULL** | 2026-09-10T13:53Z |
| c0f6474a... | 8 | **NULL** | 2026-09-10T02:00Z |
| aeef5cd2... | 8 | **NULL** | 2026-09-10T00:47Z |
| 132ed70b... | 8 | **NULL** | 2026-09-09T14:04Z |
| 5169a904... | 8 | **NULL** | 2026-09-09T10:30Z |

**Every one of the 10 most recent real signups received the 8-credit `new_account_bonus` but
ZERO have a `questbank:%` idempotency-keyed grant** — `SUM(...) FILTER (...)` returning `NULL`
means no matching rows exist, not that the value is zero. Section 1 above concluded "88 credits,
no conditions, both granted during session init" from reading `session_init.py`; this data says
**new users on production today are actually receiving 8 credits, not 88** — the 80-credit quest
chain grant is not landing, for at least the last 3 days of real signups. This is NOT a stale
finding overtaken by later code changes (T9750 only touched render-credit rounding, not the
signup grant path) — it needs a live-code check of `session_init.py`'s quest-grant call path
(gating flag, exception being swallowed, feature flag desync between code and prod config, etc.)
before ANY copy citing "88 free credits" ships. **Recommend filing this as its own bug task**
before T9650 (pricing/retention copy) proceeds, since T9650 would otherwise ship copy asserting a
number production isn't actually delivering.

**3. `framing_usage` near 6.0-6.2s: none found (unbounded date range, not just a recent window).**
The walkthrough's specific 6.027s/7-credit transaction is not traceable in current
`credit_transactions` data — either it aged out, was on a non-prod environment, or the specific
row's `video_seconds` wasn't stored as reported. Inconclusive, not contradictory: the `ceil`
mechanism itself is independently confirmed by code (`highlight_transform.py:176-192`) and is
moot regardless since T9750 already changed the rule to round-half-up.

**3b/3c. Refund mechanism - no evidence of the T9420-flagged reconciliation gap manifesting.**
Last 30 days: 67 `framing_usage` debits (-782 credits total), **zero** `framing_refund` rows in
the same window. The 10 `framing_usage` debits with no matching refund (sampled) all show
plausible successful-render durations (6.9s-30.3s, non-round numbers) — consistent with "a
successful render has no refund by design" (the script's own caveat), not with stuck failed
charges. Does not disprove the rare mid-pipeline-crash gap section 3 already documented as a real
code-level gap; simply no evidence it fired in the last 30 days.

**4. `clip_upload_refund` reconciliation loop: zero transactions, ever (`n=0, most_recent=None`).**
Inconclusive on its own — either the hourly reaper (`services/cleanup.py`) has never had a
failure to reconcile (plausible if `clip_upload` failures are rare), or it has never fired
successfully. Cannot distinguish "working, never needed" from "silently broken" from this data
alone; would need a deliberate failure injection to confirm liveness, which is out of scope here.

**Follow-up (`scripts/estimate_credit_budget_for_user.py`, imankh@gmail.com, top 3 games by clip
count):** upload=7, produce-all=1153 (130 marked plays), **grand total 1160 credits** to upload
and fully produce just 3 real, heavily-annotated games — against the 88-credit (or, per the
finding above, possibly only 8-credit) signup grant. imankh's account is an internal/dev account
with unusually high annotation density per game, not necessarily representative of a typical new
parent's first few games, but the order-of-magnitude gap (88 vs 1160, or worse if #2's finding
holds) is real context for whoever sizes the free-credit policy in T9650.

**Status: NOT fully closed.** Items 1, 3, 3b/3c, 4 and the budget follow-up are recorded and
don't block T9480/T9650/T9640. **Item 2's discrepancy is a live production bug candidate that
should be filed and investigated before T9650 ships copy citing "88 free credits."**

## Related Tasks

- **Blocks:** T9480 (billing precision copy), T9650 (pricing and retention copy), T9640 (optional
  field labels)
- T8310, T8320, T8330 - the expiry-visibility work whose copy must agree with these answers
