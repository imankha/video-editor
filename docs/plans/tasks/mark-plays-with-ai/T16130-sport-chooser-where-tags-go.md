# T16130: Sport chooser where tags go

## In plain words

Today a new account has no sport set, and tags (the labels on a play, such as Goal or Tackle) depend on the sport. When a parent with no sport opens the play form, the place where tags should be shows an amber warning, and in the sideways full-screen view it shows a line of text telling them to set their sport in a top bar that is not on that screen. The owner hit this on 2026-11-12 and said the tags view locks them out when it should simply offer a way to choose a sport and act as if nothing is wrong. We will replace the warning with a calm sport chooser everywhere tags would appear: one tap picks the sport and the tags show up in place, with the play being edited left untouched. Done when a parent with no sport can pick one and tag a play from every version of the play form, on a phone held either way and on desktop, without seeing a warning or leaving the screen.

**Status:** WAITING ON USER (design review: https://claude.ai/artifact/AfoPPibjtfSS3HKx5ktoh9)
**Impact:** 6
**Complexity:** 2
**Tier:** M (frontend only, no schema)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 1 of 8. No dependency; can ship on its own.

## Problem

- The play form's tags area is a warning, in warning colours, for a state that is not an error: the parent just has not been asked yet.
- In the sideways full-screen scrub bar the text is a dead end. It names a control that only exists on the home screen. A fix in September (T7922) made the upright form's version tappable but left this one as it was and kept the amber warning look.
- The AI analysis in this epic needs the sport too, so the same chooser is reused by T16170 and T16180 when an analysis is requested with no sport set.

## Solution

Follow section 10, "Choosing a sport where tags go", of [UX-FEEDBACK.md](UX-FEEDBACK.md). In short: wherever tags would appear and no sport is set, show a neutral "Which sport is this?" chooser in the app's normal colours. Picking a sport saves it to the athlete's profile and swaps the tags in without closing or resetting the form. The sideways scrub bar gets a small "Choose sport" chip that opens the same chooser above the full-screen view. No warning colour, no error wording, anywhere.

## Why this and not something else

Asking for the sport at sign-up was ruled out earlier (new profiles deliberately start with no sport, T7850). Defaulting to soccer silently is what T7850 removed, because it gave other sports the wrong tags. Asking at the moment the sport is first needed, inline, is the remaining option.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/shared/NoSportTagWarning.jsx` (both variants) and its test
- `src/frontend/src/components/shared/InlineSportSelect.jsx` (reuse)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx`, `DetailsFields.jsx`
- `AnnotateFullscreenOverlay` (portrait and the landscape scrub bar), `UploadClipModal`
- `src/frontend/src/components/instructions/displayNames.js` (copy)
- `.claude/knowledge/annotate.md`, section "No Sport sentinel (T7850)": update, and remove the "compact variant is DEFERRED" note

### Technical Notes
- Picking a sport is the gesture; it calls the existing optimistic `updateProfile(currentProfileId, {sport})`. No new write path.
- The form must re-render in place (no remount): an in-progress range, rating and name survive. T7922's e2e spec proves this for the upright form; extend it to landscape.
- The chooser sheet in landscape must render above the full-screen overlay (`z-[100]`); the "Other" option stays out of this chooser as today.
- Export the chooser so T16170 and T16180 can mount it in the upload dialog and the start sheet.

### Related Tasks
- Follows: T7850, T7922. Blocks: T16170, T16180 (they reuse the chooser).

## Acceptance Criteria

- [ ] With no sport set, the upright play form shows a neutral sport chooser where tags go; no amber, no warning icon, no error wording.
- [ ] With no sport set, the sideways full-screen scrub bar shows a tappable "Choose sport" control; the text naming the top bar is gone.
- [ ] Picking a sport in either place shows that sport's tags in place and keeps the play's range, rating and name.
- [ ] Works at 390 px upright, 844 px sideways and on desktop.
- [ ] The sport picked is saved to the profile and survives a reload.
