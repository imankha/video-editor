# T4560: One shared dialog shell

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

Sixty-two app files each build their own pop-up window and 54 their own loading spinner. Rules such as 'a click outside never closes a dialog' are therefore re-implemented, or missed, every time. Build one dialog shell and one spinner, and move the confirmation dialog and five other dialogs onto them; the rest move when a task touches them. Worked when the six moved dialogs look and behave as before and a new dialog needs no layout code of its own.

## Implementer details

- No `Modal`, `Dialog`, `Sheet` or `Spinner` primitive exists under `src/frontend/src`. The shared pieces are `components/shared/ConfirmationDialog.jsx` (14 users) and the one-off `components/PlaysOnlyConfirmSheet.jsx`. 42 files are named `*Modal`, `*Dialog` or `*Sheet`.
- The shell owns: backdrop with no close on click, Escape handling, z-layer, focus, and a bottom-sheet variant for phones. Follow `.claude/references/ui-style-guide.md`.
- Design gate: a new shared component; get the shape approved first.
- Not in scope: the time formatters (done, `utils/timeFormat.js`), a strict-context factory (two users only), an API helper, and the dead constants files (T15910 deletes them).

## Acceptance Criteria

- [ ] One dialog shell and one spinner exist; `ConfirmationDialog` and five other dialogs use them.
- [ ] A click on the backdrop closes none of them; Escape behaves as before for each.
- [ ] Screenshots of the six dialogs before and after match on phone and desktop.
