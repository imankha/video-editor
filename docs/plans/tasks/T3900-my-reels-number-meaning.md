# T3900: Investigate "Number Above My Reels" Meaning

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-06-23
**Updated:** 2026-06-23

## Problem

There is a number displayed above "My Reels" (home / navigation) and it is unclear
what it currently represents and whether that is the right thing to show the user. It
may be a stale or miscounted badge (e.g. counting drafts vs. published reels, or a
gallery/download count that was clobbered — see prior badge bugs T1720, T1720-gallery-badge).

This is an **investigation-first** task: determine what the number is bound to today,
decide what it *should* represent for the user, then fix the binding/label if they differ.

## Solution

1. Trace the number's data source in the frontend (which store value + selector feeds it).
2. Document what it counts today (drafts? published reels? new/unseen? downloads?).
3. Decide the intended meaning with the user (likely: count of published reels in My Reels,
   or unseen/new reels as a notification badge).
4. If the displayed value doesn't match the intended meaning, rebind to the correct source
   and update the label/tooltip. No reactive persistence — display-only derivation.

## Context

### Relevant Files (REQUIRED — confirm during Code Expert pass)
- `src/frontend/src/components/**` — the My Reels nav/home header where the number renders
- `src/frontend/src/stores/galleryStore.js` (or equivalent) — likely source of the count
- Compare with prior badge-count work: `tasks/T1720-gallery-badge-count-clobbered.md`

### Related Tasks
- Related: T1720 (Gallery Badge Count Clobbered) — same family of count/badge bugs

### Technical Notes
- Watch for the reactive-persistence ban: the count must be a pure derivation of store
  state, never written back.
- If it's a "new/unseen" badge, define the read/seen gesture that clears it.

## Implementation

### Steps
1. [ ] Locate the rendered number and its bound store value
2. [ ] Document current meaning
3. [ ] Confirm intended meaning with user
4. [ ] Rebind/relabel if mismatched
5. [ ] Add/adjust unit test for the count derivation

## Acceptance Criteria

- [ ] Documented what the number represented before the change
- [ ] Number matches the agreed intended meaning
- [ ] Label/tooltip makes the meaning self-evident
- [ ] Tests pass
