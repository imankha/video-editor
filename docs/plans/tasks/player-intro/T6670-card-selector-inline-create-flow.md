# T6670: Card selector — create a new card inline, land back on selection with it visible

**Status:** TODO
**Impact:** 7 | **Complexity:** 4
**Epic:** [Player Intro + Rich Text](EPIC.md)
**Follows:** [T6530](../T6530-intro-card-discoverability-ux.md) — UX proposal, approved 2026-08-08

## Problem

T6530 found `IntroCardCarousel.jsx` (the picker opened from a reel/collection's kebab menu,
shipped by T5215) is already well-placed, but offers no path forward when a user is picking a
card and doesn't like any of the options — they have to back out, find the profile switcher,
open Manage Profiles, click Edit, scroll, and open the library separately, then repeat the
original reel/collection action from scratch to attach the new card.

T6530 originally proposed a plain "Manage cards" link from the picker to the library. **The user
reviewed and asked for more than a link**: card selection should let the user launch the card
editor directly from the picker, and once the new card is saved, land the user BACK on the same
selection picker with the new card visible (and, per the user's intent, already the one being
offered/selected for this reel/collection) — no separate trip through Settings, no losing the
original "I'm attaching an intro to this reel" context.

## Solution

Add a "Create new card" affordance inside `IntroCardCarousel.jsx` (alongside or replacing the
plain "No intro" option — check the current layout before deciding placement) that:

1. Opens the card editor (the same one T5205 built, used by the library) in the SAME modal
   context or a stacked one — the reel/collection identity and the fact that a selection is in
   progress must not be lost.
2. On save, closes the editor and returns to the `IntroCardCarousel` picker for the SAME
   reel/collection, with the newly created card now present in the list.
3. Pre-selects the new card as the attached choice for this reel/collection (the user just built
   it specifically to use here — don't make them tap it a second time). Confirm this against
   T5215's existing attach-on-select behavior so it's one surgical write, not two.
4. If the profile has no consent attestation yet (T5230's gate), the existing inline consent gate
   (already shipped in the empty-library flow, T5195/T5205) must still fire correctly from this
   entry point too — don't bypass it.

## Context

### Relevant Files
- `src/frontend/src/components/introcards/IntroCardCarousel.jsx` — the picker, entry point for
  this task
- `src/frontend/src/components/introcards/` — the card editor components (T5205) being launched
  inline
- Wherever T5215 wires "select a card" → attach (reel kebab handler, collection share dialog
  handler) — the pre-select-on-return behavior needs to call the same path

### Related Tasks
- [T6530](../T6530-intro-card-discoverability-ux.md) — Q1's original (simpler) recommendation;
  this task supersedes that with the user's refined version
- [T6660](T6660-rename-athlete-intro-card.md) — any new copy this task introduces ("Create new
  card" or similar) should use "Athlete Intro Card" naming; coordinate merge order
- [T6680](T6680-default-athlete-intro-card-provisioning.md) — if a profile always has a default
  card going forward, the "I don't like any of these" case may become rarer but doesn't
  disappear (user can still want a DIFFERENT card than the auto-provisioned default) — this
  task's flow stays needed regardless of T6680's outcome

## Classification hint
M-tier, frontend-only. No schema change — reuses T5205's editor and T5215's attach path as-is,
just changes navigation/context-preservation between them. Reviewer pass recommended (state
handoff between two existing modals is exactly the kind of thing that's easy to get subtly wrong
— e.g. losing which reel/collection triggered the picker).

## Acceptance Criteria
- [ ] From the reel/collection card picker, a user with zero cards they like can create a new
      one without leaving the picker's context.
- [ ] After saving the new card, the user is back on the SAME picker for the SAME reel/collection.
- [ ] The new card appears in the list and is pre-selected/attached — verified with one
      end-to-end live-drive, not just unit tests.
- [ ] The consent gate still fires correctly when triggered from this entry point on a
      no-consent profile.
- [ ] No second, parallel "attach" write path was introduced — reuses T5215's existing surgical
      attach call.
