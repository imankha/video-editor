# T5490: Upload Opt-in + Paid Add-on Gating

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-07-19

## Problem

Movement tracking costs real GPU money per game (≤ $0.50 gate, T5460-verified), so it ships as a paid add-on chosen at upload — subsidizing the Modal job. Until now the job is admin/dev-triggered (dogfood). This task adds the user-facing opt-in at game upload, gates job dispatch on entitlement, and instruments the funnel. Deliberately LAST in the epic (EPIC.md decision 7): the feature must be proven valuable on internal accounts before anyone is charged.

## Solution

An opt-in control in the Add Game/upload flow ("Movement Tracking — see where the action is, skip dead time") with price display; entitlement checked server-side at upload completion, which then dispatches T5460's job; admin bypass retained; analytics on the funnel.

## Context

### Relevant Files (REQUIRED)
(pricing mechanics must reuse the existing credits system — load `.claude/knowledge/backend-services.md` + the storage-credits epic docs before design; do NOT invent a parallel payment path)
- `src/frontend/src/hooks/useGameUpload.js` + the Add Game upload UI — opt-in checkbox + price line
- Upload-completion path in the backend games flow — on game ready AND entitlement present → dispatch `call_modal_movement` (T5460); never blocks game availability
- Entitlement/charging: extend the storage-credits/entitlement tables per their existing patterns (design decides exact shape; Migration agent if schema changes)
- Admin surface: retain free trigger (T5460's endpoint) + a per-account "movement tracking free" flag for dogfood/beta accounts
- Analytics events: opt-in shown / selected / job completed / profile viewed

### Related Tasks
- Depends on: T5460 (job + trigger), T5470/T5480 (the value being sold), storage-credits epic (payment/entitlement rails — wire to its specific tables, named at design time)
- Blocks: — (epic completion)

### Technical Notes
- **Price**: fixed per-game add-on (simple, predictable) rather than per-minute metering; exact price is a user decision at design gate — present cost telemetry from T5460 (`[MOVEMENT_COST]`) and a margin recommendation.
- **Failure/refund path**: if the job hard-fails after charging, auto-credit back and notify (a paid nothing is a trust killer). Job status surfaces on the game card ("Analyzing movement…" → layer appears silently on completion; failure → quiet credit-back notice).
- **No retroactive purchase in v1**: opt-in exists only at upload time (keeps entitlement simple and the Modal input fresh); "add later" is a named follow-up if requested. Sweep/expiry interactions: profile artifact follows the game's storage lifecycle (T5460 storage ref).
- **Gesture persistence**: the opt-in choice rides the existing upload submission — no new reactive writes.
- **Copy**: sell the outcome ("skip the dead time"), not the tech; UI Designer + user approval on placement/copy (upload flow is a conversion-critical surface).

## Implementation

### Steps
1. [ ] Design gate: entitlement shape on credits rails, price, upload-UI copy/placement (user approval)
2. [ ] Backend entitlement + dispatch-on-upload-complete + failure credit-back (+ migration if schema)
3. [ ] Upload UI opt-in + game-card status states
4. [ ] Admin free-flag for beta accounts
5. [ ] Analytics events; backend + frontend tests; e2e of the opted-in upload happy path (test_mode profile)
6. [ ] Staging end-to-end: paid-flagged test account uploads with opt-in → profile appears in Annotate

### Progress Log

**2026-07-19**: Task created.

## Acceptance Criteria

- [ ] Opt-in at upload triggers the movement job on entitled accounts; without opt-in nothing dispatches
- [ ] Charge + hard-fail → automatic credit-back with user-visible notice
- [ ] Game availability never blocked by movement analysis in any state
- [ ] Admin free-flag works; funnel analytics events firing
- [ ] Tests + staging e2e evidence; epic completion criteria in EPIC.md all checked
