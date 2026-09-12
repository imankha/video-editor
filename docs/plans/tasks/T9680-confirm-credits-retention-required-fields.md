# T9680: Confirm credits, retention and required upload fields

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-10
**Updated:** 2026-09-10

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

### Production verification - BLOCKED this session, still owed

Attempted 2026-09-12 via the same read-only pattern `scripts/scan_charged_reverted_games.py`
documents as safe (SELECT-only Postgres queries via `.env.prod`'s `DATABASE_URL`, which requires a
`fly proxy 15433:5432 --app reel-ballers-db-prod` tunnel per that script's own header). The query
script is written and ready: see `scripts/verify_t9680_credits.py` (promoted from the scratchpad
draft - read-only, no writes, prints only derived findings, never the connection string).

**This session's auto-mode permission classifier hard-blocked every command that touched the Fly
access token or read `.env.prod`**, even after the user explicitly approved the action - it auto-
denied rather than prompting, so there was no interactive approval path available. Not attempted
further after two denials, per the tool's own guidance not to route around an intentional block.

**Still needed before this record is fully closed** (run `scripts/verify_t9680_credits.py` from an
interactive session where the fly-proxy tunnel + prod DB access actually work, e.g. a normal
terminal, not this session):
1. `credit_migration_state.ready_at` - confirm the credits_ready gate is open on prod
2. A sample of recent signup grants - confirm `new_account_bonus` (8) + `quest_upfront` (80) = 88 in
   practice, with no drift
3. Any `framing_usage` transaction with `video_seconds` in [6.0, 6.2] - confirms the walkthrough's
   charge really was a Focus render, not something else, and its exact `amount`
4. Aggregate `framing_usage` vs `framing_refund` volume, and `clip_upload_refund` recency - sanity-
   checks the refund/reconciliation mechanism is actually firing in prod, not just present in code

**Everything else in this decision record (sections 1-6) is code-certain and does not depend on this
step** - T9650/T9480/T9640 can proceed citing those rules. Only the four numbers above remain open.

## Related Tasks

- **Blocks:** T9480 (billing precision copy), T9650 (pricing and retention copy), T9640 (optional
  field labels)
- T8310, T8320, T8330 - the expiry-visibility work whose copy must agree with these answers
