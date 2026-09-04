# T8730: Annotate clip-editor polish — Focus button sizing, false-positive save dialog, "Play Editor" naming

**Status:** STAGING (merged to master 2026-09-04, PR #331)
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-04

Bundled into one task (not three) because all three issues live in the same file,
`AnnotateFullscreenOverlay.jsx` — separate PRs would fight over the same lines.

## Problem

User feedback (2026-09-04), live-testing the clip-edit panel ("Editing: Play 1" —
rating, name, Update/Cancel, My Athlete/Team toggle, Focus button):

### 1. False-positive "Save this play first?" dialog
`AnnotateFullscreenOverlay.jsx:806-830` — the Focus button's `onClick` **unconditionally**
calls `setFocusConfirmOpen(true)` (L807), which always shows "Save this play first? /
Opening Focus closes the play editor." (L818-819), regardless of whether there are any
actual unsaved changes. User: "I don't want to see a dialog when i click Focus, unless
there is specifically unsaved data (that wasnt the case)." **Confirmed in code: there is
no dirty-check anywhere in this component today** — grepped for
`hasChanges`/`isDirty`/`hasUnsaved`, zero hits. This needs real dirty-tracking added
(compare current form field values against the loaded/saved clip), not just removing the
dialog outright — the dialog is still correct and necessary when there ARE real unsaved
changes (that's the whole point of the T8600 §2.8 fix that added it).

### 2. Focus button needs more visual room + mobile touch targets
User: "I think the Focus button needs to be better. Remember this is the CTA when we Edit
a clip. The full button layout needs to breathe more and buttons need to be finger sizes
on mobile." Applies to the whole button row (`AnnotateFullscreenOverlay.jsx` ~L787,
"Button row (outside the card): Layer + Focus (edit mode only)"), not just Focus in
isolation — check spacing/sizing of the My Athlete/Team toggle + Focus button together at
mobile widths.

### 3. Naming inconsistency: "Play Editor" vs "Annotate"
The dialog copy itself says "Opening Focus closes **the play editor**" (L819), but the
mode/screen is named **Annotate** everywhere else (route, component names, the
`.claude/knowledge/annotate.md` domain doc). User: "Not sure why we are calling this the
play editor, we also call it annotate, I feel like we need a better name and to be
consistent." Needs a decision on the correct user-facing term (likely just "Annotate",
matching the established T7700-style rename precedent — UI copy converges on one name,
internal identifiers can differ) and a sweep of every place "play editor" (or similar
inconsistent phrasing) appears in user-facing copy.

## Solution

- **Dirty-check**: add real unsaved-changes tracking to `AnnotateFullscreenOverlay.jsx`
  (rating/name/notes/teammates fields vs the loaded clip's saved values). Focus button
  `onClick`: if dirty, show the existing confirm dialog unchanged; if NOT dirty, call
  `onOpenInFocus?.(existingClip.autoProjectId)` directly, no dialog.
- **Button row spacing/sizing**: ui-designer or direct polish pass (small enough it may
  not need a full design doc — use judgment on scope at pickup) — breathing room + a
  finger-size touch-target audit (matches T8550's mobile CTA sweep methodology if useful
  as reference, though this is a narrower, single-screen fix).
- **Naming**: confirm "Annotate" is the correct target term (check against
  `.claude/knowledge/annotate.md` and any other established naming docs before assuming),
  then sweep every user-facing "play editor" string to match. Do NOT touch internal
  identifiers (route names, component names, `EDITOR_MODES` constants) unless they're
  ALSO user-visible — this is a copy consistency fix, not a rename-everything task like
  T8545's.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (all three
  issues — dialog L806-830, button row L787+)
- `.claude/knowledge/annotate.md` — confirm "Annotate" is the established name before
  sweeping copy
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.focusPrompt.test.jsx`
  — existing test for the confirm-dialog behavior; extend for the new dirty-check branch,
  don't break the existing dirty-path coverage

## Acceptance Criteria

- [ ] Clicking Focus with NO unsaved changes navigates straight to Focus mode, no dialog
- [ ] Clicking Focus WITH unsaved changes still shows the confirm dialog exactly as today
- [ ] Focus button + button row have visibly more breathing room; touch targets meet a
      reasonable finger-size minimum (44px per current mobile-CTA convention, confirm
      against `.claude/references/ui-style-guide.md` if it specifies one) at 375px
- [ ] All user-facing "play editor" copy reads "Annotate" (or whatever term is confirmed
      correct) consistently
- [ ] Tests pass: existing dirty-path dialog test still green, new not-dirty-path test
      added
