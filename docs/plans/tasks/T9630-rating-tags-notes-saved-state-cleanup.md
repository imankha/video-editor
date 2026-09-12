# T9630: Rating, tags, notes and saved-state presentation cleanup

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-07, N35, B2 (handoff E4-05)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

On the play form, **four stars**, **Good**, **Big play** and an exclamation mark all compete to
describe one rating, with no documented mapping between them. Relevant tags are not exposed. A
custom title can be replaced when notes change. Saved state is asserted rather than derived.

## Solution

- **One** star-to-descriptor mapping, used consistently in the list, the editor and playback.
- Expose the relevant sport tags rather than hiding them.
- **Never auto-replace a user-entered title** when notes change.
- Show Unsaved / Saving / Saved from real persistence state; a failure retains the edits.
- Tags and note remain visible after saving.

## Context

### Relevant Files
- `src/frontend/src/components/shared/clipConstants.js` - rating captions (T9320 revised these;
  build on that, do not revert it)
- `src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` and the T8600 inline editor strip
- `src/modes/annotate/components/ClipListItem.jsx`

### Related Tasks
- T9320 (STAGING) rewrote the rating captions to express intent. **Re-read those strings first** -
  part of this complaint may already be answered.
- T9450 - the unsaved-form save claim
- T8960 - play editor strip layout, same surface

### Technical Notes
The star mapping should be defined once and imported, not restated per surface.

## Acceptance Criteria

- [ ] One documented star-to-descriptor mapping is used everywhere
- [ ] Changing a note preserves a custom title
- [ ] An unsaved form never claims successful persistence, and a failure retains edits
- [ ] Tags and note remain visible after saving
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green

## Progress Log

**2026-09-12 — implementation complete, tests green, Reviewer approved (BLOCKED on live QA infra).**

Findings vs. the 4 problem-statement items (each investigated before any code change, per the
kickoff):

1. **One rating mapping everywhere — real gap, fixed.** `getRatingLabel` (T9520/N35) already existed
   as the single source, but `AnnotateFullscreenOverlay`'s `StarRating` still showed the gold stars
   AND the bare chess-notation glyph (`!`) side by side — the exact "stars + exclamation mark
   compete" bug, and the landscape-compact layout duplicated the glyph a second time. Fixed: the
   visible span now shows `getRatingLabel(rating)` text itself; the duplicate span was deleted.
   `ClipDetailsEditor`'s separate, undocumented local `StarRating` had zero tie to `getRatingLabel`
   (title said only "N stars") — added `title`/`aria-label={getRatingLabel(rating)}`. Grepped for a
   literal "Big play" string per the kickoff's open question: not found anywhere in the codebase;
   almost certainly the reporter's informal name for the 5-star "Brilliant" tier.
2. **Notes replacing a custom title — investigated, NOT reproducible.** Both editing surfaces
   (`AnnotateFullscreenOverlay`'s name-manually-edited guard, `ClipDetailsEditor`'s surgical
   `{notes}`-only patch) already prevent this; added regression tests pinning the guard rather than
   leaving it unverified. Found (but did not fix, separate scope) a narrower async race in
   `updateClipRegionWithSync`'s unsaved-clip save path — noted in `.claude/knowledge/annotate.md` as
   a follow-up needing the Expert agent if ever confirmed live.
3. **Unsaved/Saving/Saved from real persistence — real, substantial gap, fixed.** The Save
   button's promise was silently discarded in 3 places (missing `return` statements in
   `AnnotateModeView`, `AnnotateContainer.handleFullscreenCreateClip`, and
   `updateClipRegionWithSync`/`handleFullscreenUpdateClip`), so a real backend failure was
   indistinguishable from success — the form closed either way. Fixed the return-value plumbing
   (strict boolean contract), made `handleSave` async, and gated the close/resume call on success
   only. A failed or thrown save now leaves the form open with every field intact and shows
   "Couldn't save — try again"; the tri-state badge is wired at all 3 Save-button render sites.
4. **Tags/notes visible after saving — real gap, fixed.** `ClipListItem`'s compact row showed only
   the rating badge + title. Added a small tag-count + note-glyph indicator, rendering nothing for a
   plain clip. Confirmed the T8600 "Add details" disclosure already survives a save (excluded from
   the reset effect, component doesn't unmount across a create-save).

**Test evidence:** 14 files / 109 tests green — existing regression suite for
`AnnotateFullscreenOverlay`/`ClipDetailsEditor`/`ClipListItem` (stayOpen, focusPrompt, oneTap, keys,
stripLayout, reel, layer, teammates, gameClock, anglePill, layerChip) + 3 new files targeting this
task's changes (`AnnotateFullscreenOverlay.namePreservation.test.jsx`,
`AnnotateFullscreenOverlay.saveStatus.test.jsx`, `ClipListItem.detailsIndicator.test.jsx`). Two
pre-existing tests needed contract updates (one asserted the old bare notation glyph; two act()-wrapped
a click now that `handleSave` is async) — verified as honest updates, not weakened assertions, by
an independent Reviewer pass. `eslint` clean (0 errors, only pre-existing warnings).

**Reviewer verdict:** APPROVED. 0 BLOCKING, 0 MAJOR, 3 MINOR (all accepted as-is — edit-mode "Saved"
badge is only momentarily visible before close by design; a duplicated whitespace-trim empty-check
below the rule-of-three threshold; scope confirmed surgical, no creep).

**QA phase — blocked by container infrastructure, not by the diff.** This worker container has no
`docker` binary (`docker: command not found`) and no prebuilt Python wheels for this platform/Python
combination — `pip install` for the backend fell back to compiling `torch` from source, which is
infeasible within a task turn budget. Live-driving the real app (dev-login, a real saved clip with
tags+notes+a custom title, screenshot evidence per criterion) was therefore not possible from this
container. Verification for this push is test-based (above) + Reviewer approval. **A live-drive QA
pass against staging is still owed** before this can be called fully done — recommend the supervisor
or user do a manual pass on staging after merge, checking: (1) the rating badge/label reads
consistently in the list, editor, and timeline; (2) editing notes on a named clip preserves the name;
(3) a real save shows Saving→Saved, and killing the network mid-save shows the error state without
losing the form; (4) a saved clip's tag count/note glyph shows in the list row.
