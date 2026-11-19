# T17680: Background controls cover profile dialogs again

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

On Home, the Play and Share buttons of the highlights behind the Manage profiles dialog show on top of the dialog and can cover its profile rows. Tapping there can hit the background button instead of the dialog. A dialog must cover everything behind it until it closes.

## How we got here

This is a regression of [T6600](player-intro/T6600-modal-z-order-and-stacking-scale.md), which fixed draft tiles painting over the Intro cards dialog in August (z-index ladder, merged b6878608, archived as done). The owner reported the overlap again on 2026-11-18, and the Full QA continuation 2026-11-18 reproduced it on staging builds 7a6b3123b (#7949) and ce8988c54 (#8063) at 390x844, 768x1024 and 1440x900, with real touch at phone and tablet sizes: after scrolling Highlights by 300 px and opening Manage profiles, a background Share control is undimmed and hit-testing returns it instead of the modal backdrop. No failing request or console error. Evidence (local, not in git): `qa/qa-pass-2026-11-18/bugs/B01-*` (owner screenshot, phone and iPad touch, three repro screenshots, `B01-geometry.json`). Full detail in T6600's 2026-11-18 progress log entry.

Filed under a new id on 2026-11-18 because T6600 already has commits on master, which `/dotask start` refuses (a shipped task is not reopened under its old id). T6600's root-cause notes (stacking contexts, the z-index ladder in one module) are the starting point.

## Solution

Find which background control escapes the dialog's layer (likely a highlight tile's Play/Share overlay with its own stacking context or z-index above the dialog's, or the dialog rendered inside a lower stacking context) and fix it through the existing z-index ladder from T6600, not with a one-off number. Make the dialog's backdrop take all input while it is open.

## Relevant Files

Start from T6600's file for the ladder module and the modal components (`ManageProfilesModal.jsx`, `IntroCardsModal.jsx`), the Home highlight tiles (`PublishedReelsPanel.jsx`, `collections/ReelTile.jsx`), and the shared dialog shell from T4560 if Manage profiles uses it. Knowledge doc: `.claude/references/ui-style-guide.md`.

## Acceptance Criteria

- [ ] C1: At 390x844, 768x1024 and 1440x900, after scrolling Highlights and opening Manage profiles, no background control paints above the dialog or its backdrop (browser check reproducing the T6600 2026-11-18 steps, red on master).
- [ ] C2: While the dialog is open, tapping where a background Play or Share button sits hits the backdrop, not the button.
- [ ] C3: The nested Intro cards dialog (Manage profiles, then Intro cards, then a confirmation) still orders correctly.
- [ ] C4: The fix uses the z-index ladder module; no new ad-hoc z-index value.
