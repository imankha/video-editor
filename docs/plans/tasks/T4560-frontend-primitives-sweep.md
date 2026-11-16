# T4560: One shared dialog shell

**Status:** STAGING
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

## Ruling

Shape approved as proposed (owner, 2026-11-15). One `components/shared/DialogShell.jsx` and one `Spinner`. The shell owns: portal to document.body; dimmed backdrop that ignores clicks; Escape calls onClose only when the caller passes one; z-layer from `Z.MODAL`; role=dialog, aria-modal, focus moved in and restored; centered card on desktop, bottom sheet on phones (the PlaysOnlyConfirmSheet look). Callers pass title, body and buttons only. First six to move: ConfirmationDialog (its 14 users move with it, props and impression counter kept), PlaysOnlyConfirmSheet, and four more the worker names in its first commit. Before/after screenshots at phone and desktop width must match. The rest move later when a task touches them.

## Acceptance Criteria

- [ ] One dialog shell and one spinner exist; `ConfirmationDialog` and five other dialogs use them.
- [ ] A click on the backdrop closes none of them; Escape behaves as before for each.
- [ ] Screenshots of the six dialogs before and after match on phone and desktop.
