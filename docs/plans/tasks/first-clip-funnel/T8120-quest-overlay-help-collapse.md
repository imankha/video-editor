# T8120: Quest overlay yields: collapse to Help button + upfront credits

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 4
**Created:** 2026-08-31
**Epic:** [First-Clip Funnel](EPIC.md)

## Problem

Reproduced twice at 390x844 (screenshots `mobile-02-quest-overlay-blocks-dropzone.png`,
`mobile-05-quest-overlay-blocks-create-profile.png`): the expanded Get Started quest
panel sits ON TOP of open modals - it fully hides the Add Game modal's video dropzone
(a real thumb tap lands on its "Watch tutorial" button instead of the file picker) and
covers the Add Profile Cancel/Create buttons. It also re-expands itself after every
navigation, so collapsing it once does not keep it out of the way.

Prod signals consistent with tap-stealing: mobile `add_game_opened` 6 -> only 2 ever
selected a file; `watched_annotate_tutorial` = 15 users vs 3 who ever clipped.

Credits half (user decision 2026-08-31): quest steps currently drip the credits a user
needs as rewards. kristi.defelice uploaded 4 pre-cut clips as 4 "games" in 2.5 minutes,
exhausted her 2-credit balance, hit the $3.99 screen with zero output, and quit. With the
quest surface collapsing, the drip is retired: grant ALL the credits the quest chain
would have awarded upfront.

## Solution

1. **Occlusion contract:** the quest/help surface may NEVER overlap an open modal, form,
   or dialog. Auto-hide fully (not just collapse) whenever any modal is open; z-order
   beneath modals as defense in depth.
2. **Collapse to a Help button:** default presentation is a small Help chip/button.
   Never auto-expands after the user collapses it (collapsed state persists,
   gesture-written). Expanded content = current quest list until the
   [Tutorial Redesign epic](../tutorial-redesign/EPIC.md) replaces it with guided help.
   Tutorial videos stay reachable from the expanded panel only - never a pushed CTA.
3. **Upfront credits:** new signups receive the full quest-chain credit total at signup
   (single grant through the existing credit path, one write site). Per-step credit
   rewards removed from quest definitions. Existing accounts mid-quest: grant the
   ungranted remainder on next login (same JIT shape as migrations; no bulk sweep).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/QuestPanel.jsx` - the overlay; collapse/expand + occlusion
- `src/frontend/src/data/questDefinitions.js` + `src/frontend/src/config/questDefinitions.jsx` - reward fields, Watch tutorial CTA
- `src/frontend/src/config/questDefinitions.test.jsx` - guards quest copy
- Backend quest-step completion / reward award site (locate via grep for the reward
  grant; credits flow through the existing credit ledger path - see
  `src/backend/app/services/credit_ledger.py`)

### Related Tasks
- Blocks nothing; ships first in the epic (cheapest experiment, mechanical blocker).
- Feeds: tutorial-redesign epic (T7620+) replaces the expanded panel's content.
- Related: T7840 (inert quest step) - check overlap before starting.

### Technical Notes
- Persisting the collapsed flag is a legitimate preference (the collapse click is the
  gesture) - not banned view-state.
- Credit grant must be idempotent (a user who already earned some steps gets only the
  remainder; never double-grant). No new Postgres state: reuse the ledger.

## Implementation

### Steps
1. [ ] Regression test first: 390x844, Add Game modal open, quest expanded -> dropzone
       must receive the tap (this is the reproduced bug)
2. [ ] Occlusion contract + collapse-to-Help-button + no-auto-reexpand
3. [ ] Upfront grant for new signups; remove per-step rewards; remainder grant for
       existing accounts on next login
4. [ ] Verify tutorial videos reachable from expanded panel only

## Acceptance Criteria

- [x] No viewport (320px+) where quest/help UI occludes a tappable control while any modal is open
- [x] Collapsed stays collapsed across navigations and reloads
- [x] New signup balance = full quest-chain total; mid-quest account gets exact remainder once
- [ ] Metrics to watch post-ship: `upload_file_selected/add_game_opened` (mobile, baseline 2/6); `watched_annotate_tutorial` should FALL; zero-clip `payment_started` should stop

### Progress Log

**2026-09-01**: Implemented, reviewed. Branch CI initially red - `test_rate_clip_step.py`/
`test_return_home_step.py` asserted the old per-step reward values (15/25) this task
intentionally zeroed out; fixed and re-pushed. CI now green
(`feature/T8120-quest-overlay-help-collapse`). QA note: full-browser e2e occlusion drive
not runnable in the container (no chromium/network); covered by jsdom-based occlusion
tests + a written e2e spec instead. Awaiting user test + merge.
