# T9750: Round render/export credits to nearest second, not always up

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-12
**Updated:** 2026-09-12

## Source

T9680's decision record (`docs/plans/tasks/T9680-confirm-credits-retention-required-fields.md`)
established that a render/export is charged `ceil(seconds)` credits - confirmed as the mechanism
behind the walkthrough's 6.027s clip costing 7 credits. Presented as a decision record item; the
product owner reviewed it 2026-09-12 and explicitly chose to change the rule rather than just
document it: **"personally i rather round"** - round to nearest, not always up.

## Problem

Every fractional-second render currently rounds UP, always in the app's favor, with the rule stated
nowhere in user-facing copy:
- `highlight_transform.py`'s `compute_export_credits` (the live `/api/export/render`/framing path):
  `math.ceil(video_seconds * max(1, output_fps/30))`.
- The older multipart path, `routers/exports.py` (`POST /api/exports/framing`):
  `credits_required = math.ceil(video_seconds)` inline.

Worse, `BuyCreditsModal.jsx:467` actively contradicts the charge it sits next to:
`Math.round(insufficientCredits.videoSeconds)` displays the ROUNDED seconds while
`insufficientCredits.required` is the CEIL'd credit count - for 6.027s this literally renders
**"7 credits (6s of video)"**, two different numbers claiming to describe the same thing.

## Solution

Switch both charge sites from `ceil` to round-half-up, with a 1-credit floor for any positive
duration (not explicitly requested, but matches the existing conservative pattern already used for
storage cost - `max(1, math.ceil(...))` in `storage_credits.py` - so a very short clip, e.g. 0.3s,
still costs 1 credit rather than becoming a genuinely free render; this is a small, deliberate
addition to "round to nearest," not a reinterpretation of it - flag for the product owner if this
floor is unwanted).

Use round-half-up specifically (`math.floor(x + 0.5)`), not Python's built-in `round()` (banker's
rounding, rounds `.5` to the nearest EVEN number - `round(2.5) == 2`, `round(3.5) == 4` - which would
be a confusing, inconsistent-feeling rule for a billing surface; round-half-up always rounds `.5` up,
matching how people expect "round to nearest" to work for money).

### Steps

1. `src/backend/app/highlight_transform.py`'s `compute_export_credits`: replace `math.ceil(...)`
   with a round-half-up + 1-credit-floor helper. Extract the helper (e.g. `round_credits_half_up`)
   so both charge sites use the identical function - the ORIGINAL rounding bug's near-relative (the
   modal's seconds-vs-credits mismatch) was caused by two call sites computing similar things
   slightly differently; do not repeat that shape here.
2. `src/backend/app/routers/exports.py`'s inline `credits_required = math.ceil(video_seconds)`:
   replace with the same shared helper. Two charge sites must state one rule, not one changed and
   one left on the old rule.
3. `src/frontend/src/components/BuyCreditsModal.jsx:467`: fix the modal to show the SAME
   rounded-to-nearest number for both the credit count and the displayed seconds - they should now
   agree by construction, not by coincidence. If a mismatch is still possible for any reason
   (e.g. `output_fps` scaling multiplies the raw seconds), make the displayed seconds text honestly
   reflect what's being charged for, not a separately-rounded raw duration.
4. Copy: `BuyCreditsModal.jsx:114,118`, `src/landing/src/site.ts:74-75`,
   `src/landing/src/pages/index.astro:337` currently state a flat "1 credit = 1 second" rate. State
   the rounding rule explicitly wherever the rate is quoted (e.g. "1 credit per second, rounded to
   the nearest second") so this doesn't become the next undocumented-rounding-rule complaint.
5. Update `docs/plans/tasks/T9680-confirm-credits-retention-required-fields.md`'s Decision Record
   section 2 to record the NEW rule (round-half-up + 1-credit floor) as the current policy, with a
   dated note that this supersedes the originally-confirmed `ceil` behavior per this task.

## Context

### Relevant Files
- `src/backend/app/highlight_transform.py` - `compute_export_credits`
- `src/backend/app/routers/exports.py` - the legacy multipart framing endpoint's inline calc
- `src/frontend/src/components/BuyCreditsModal.jsx` - rate copy + the seconds/credits display bug
- `src/landing/src/site.ts`, `src/landing/src/pages/index.astro` - homepage rate copy
- `docs/plans/tasks/T9680-confirm-credits-retention-required-fields.md` - decision record to update

### Related Tasks
- T9680 (decision record this task changes the policy of)
- T9480 (billing precision copy) and T9650 (pricing/retention copy) both cite T9680's rounding
  answer - re-verify they don't hard-code "rounds up"/`ceil` language once this lands

### Technical Notes
Boundary cases to get right in tests: exactly `X.5` seconds (must round UP per round-half-up, not
banker's rounding), just below `X.5`, just above, a duration under 1s (must floor to 1 credit, never
0), and the original 6.027s example (must now be 6, not 7 - confirm this explicitly, it's the
walkthrough's own repro case).

## Acceptance Criteria

- [ ] Both charge sites (`highlight_transform.py`, `exports.py`) use one shared round-half-up + 1-credit-floor
      helper - not two independently-maintained rounding implementations
- [ ] 6.027s now bills as 6 credits, not 7 (the walkthrough's own repro case, explicitly re-tested)
- [ ] `BuyCreditsModal.jsx`'s seconds-display and credit-count no longer contradict each other
- [ ] Rate copy in the app and landing site states the rounding rule explicitly
- [ ] T9680's decision record updated to reflect the new policy, dated, not silently overwritten
- [ ] Boundary-case tests (exactly X.5, just below, just above, sub-1s floor) - relevant test set
      green, output attached
- [ ] Branch CI green
