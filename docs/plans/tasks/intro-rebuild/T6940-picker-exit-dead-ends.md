# T6940: Intro card picker exits — backdrop close + create-without-attach dead ends

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-12
**Updated:** 2026-08-12
**Epic:** [intro bug fixes](EPIC.md)

## Problem

Two exit paths in `IntroCardPicker` produce "I made a card but a different/no card plays"
(mechanism M2 in the 2026-08-12 audit):

1. **Backdrop close violates the project rule.** `IntroCardPicker.jsx:202` closes the
   picker on backdrop click without committing the selection. Project rule (memory +
   established convention): modals NEVER close on backdrop click.
2. **Inline create is not an attach.** The picker's create-then-return flow
   (`doCreate`/`startCreate`/`finishCreate`, `IntroCardPicker.jsx:117-130`) creates the
   card row, but attachment only happens via `commit` (OK button, `:103-106`). Leaving via
   the header X (`:217-223`, wired to `cancel`, active in the create view) or via
   breadcrumb-then-backdrop abandons the flow: the card EXISTS in the library but the reel
   keeps its previously-attached card (or none). The user believes they "added an intro
   card"; playback shows the old one.

Same shape exists in `IntroCardsModal` (`handleNew:49-61`, `handleDuplicate:63-87`): the
library editor creates cards without attaching, which is CORRECT there (it's a library),
but the picker context sets an expectation the exit paths betray.

## Solution

1. Remove backdrop-close from the picker (backdrop click = no-op; Esc/Cancel/X remain the
   explicit exits). Follow the existing no-backdrop-close modals for the exact pattern
   (e.g. `IntroCardsModal` portal wrapper — check how it handles backdrop, and mirror).
2. After an inline create completes (`finishCreate` returns to the select view), the newly
   created card must be the SELECTED draft (`draftId = newCard.id`, `touched = true`) so
   pressing OK attaches it — verify this is already true (`doCreate` sets `setEditId`; trace
   what happens to `draftId` when the editor closes) and fix if not.
3. If the user exits the picker with a freshly-created-but-unattached card (Cancel/X after
   an inline create), show a lightweight confirm: "Your new card isn't attached to this
   reel — attach it?" [Attach] [Leave without attaching]. No silent abandonment.
   Implementation: track `createdThisSessionId` in picker state; on cancel-with-that-set,
   render the confirm (reuse the project's existing confirm/alert component — grep for the
   pattern used by delete confirmations in `IntroCardsModal.jsx:144` area).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/introcards/IntroCardPicker.jsx` — backdrop handler (~202),
  header X (~217-223), `commit` (~103-106), `doCreate` (~117-130), draft state (~73-111)
- `src/frontend/src/components/introcards/IntroCardsModal.jsx` — reference for portal/
  backdrop + confirm patterns; NOT to be behavior-changed
- e2e: `src/frontend/e2e/` — find the picker spec (grep `IntroCardPicker`/`intro` in e2e)
  and extend it

### Related Tasks
- T6670 built the inline create-then-return flow this task is hardening
- [T6930](T6930-card-store-profile-switch-reset.md) — sibling Wave-0 fix; no file overlap
  expected, but both touch `IntroCardPicker.jsx` — coordinate if run concurrently
  (prefer sequential)

### Technical Notes
- Memory/no-backdrop-close is a standing user decision — do not add a prop to make it
  configurable; just remove the behavior.
- Do not auto-attach on create (that would surprise the library-management use case
  reached through the same picker) — selected-by-default + explicit OK + exit-confirm is
  the designed middle ground.
- Keep `creatingRef` double-create guard (`:118-119`) intact.

## Implementation

### Steps
1. [ ] Remove backdrop-close (select view AND create view)
2. [ ] Verify/fix: inline-created card becomes the selected draft on return to select view
3. [ ] Add exit-confirm when leaving with a created-but-unattached card
4. [ ] Tests + lint

### Test Plan (relevant set)
- Unit: backdrop click does not call `onClose`/`cancel` (both views)
- Unit: after `doCreate` + editor close, `draftId === newCard.id` and OK calls
  `onSelect(newCard.id)`
- Unit: cancel-after-create renders the confirm; "Attach" commits; "Leave" closes without
  a PATCH
- e2e (real browser — pointer/modal behavior, per project rule): create card inline from
  the reel picker → OK → badge shows the new card name → play shows the new card
- Manual QA: repeat the user's original repro — add a card with an image via the picker,
  press OK, play the reel, confirm the SAME card plays.

## Acceptance Criteria
- [ ] No backdrop-close anywhere in the picker
- [ ] Inline create → OK attaches the new card (badge + playback agree)
- [ ] Exiting with a fresh unattached card always asks; no silent abandonment
- [ ] e2e green in a real browser; relevant unit tests green; eslint clean
