# T7150: Collection public-share link freezes "no intro" before the intro picker is used

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-08-17
**Bugs:** 43p

## Problem

User report (43p): shared a collection link, tested it, and saw no intro card play.

**Not a viewer bug — the share was frozen with `intro_card_id: 0` (explicit "no intro") at
creation time.** Confirmed against the live endpoint and the Postgres row:
`GET /api/shared/collection/{token}` returns no `intro` key, and the `shares` row's
`collection_definition.intro_card_id` is `0`, frozen at `shared_at`.

Root cause is in `CollectionShareModal.jsx`:
- `handleTogglePublic` (`:80-94`) creates the public share **immediately** when "Anyone with
  the link" is switched on, POSTing whatever `introCardId` state happens to hold at that
  instant.
- `introCardId` starts at `null` (`:39`), and the Intro picker (`IntroCardCarousel`,
  `:209-220`) is rendered **below** the public-link toggle in the modal.
- The natural top-to-bottom flow — flip the toggle, then notice the intro picker — creates
  the link before the intro pick is made. Once created, `publicLink` is cached and
  `handleTogglePublic` early-returns (`:83`) on subsequent toggles. There is no PATCH
  endpoint for an existing share's `intro_card_id` (deliberately — `frozenNote` in the modal
  already tells the user "frozen when you share"), so picking an intro afterward has zero
  effect on the link already generated/copied.

The `frozenNote` copy shown next to the picker ("Frozen when you share — changing this
reel's intro later won't change this link") promises the freeze happens **when you share**,
but for the public-link path the freeze already happened before the user reached the picker.
This task makes that promise true rather than adding a way to break it (an update path was
considered and rejected — see Alternatives).

## Solution

1. **Reorder the modal**: move the Intro section above the public-link toggle / recipient
   picker, so the natural reading order is "pick your intro, then create the link."
2. **Defer public-link creation**: `handleTogglePublic` stops calling `createShare` —
   flipping "Anyone with the link" on just sets `isPublic = true` locally. An explicit
   "Get Link" button (shown when `isPublic && !publicLink`) fires `createShare([], true)` and
   captures whatever `introCardId` is selected at that moment. This makes the correct order
   structural, not just a UI nudge — a user who ignores the picker and immediately hits
   "Get Link" still gets exactly the outcome they saw on screen (explicit "No intro" if that's
   what's highlighted), not a silent default they never chose.
3. **Clear a stale link on intro change**: if the intro selection changes after a link exists,
   clear `publicLink` so the user regenerates rather than copying a link that no longer matches
   the screen. Not an update path — the backend dedups identical definitions, so regenerating
   is idempotent when nothing changed.

The recipient-email flow (`handleSubmit` -> `createShare(emails, isPublic)`) already defers
creation to an explicit "Share" button click and is unaffected — this task only touches the
public-link path.

### Alternatives considered
- **Add a PATCH endpoint to update an existing share's `intro_card_id`.** Rejected: contradicts
  the modal's own "frozen when you share" copy and the reel-share behavior (frozen the same
  way, no update path) — would make collection shares inconsistent with reel shares for no
  product reason. See conversation on bug 43p.

## Context

### Relevant Files
- `src/frontend/src/components/CollectionShareModal.jsx` — `handleTogglePublic` (`:80-94`),
  `introCardId` state (`:39`), JSX ordering of the public toggle (`:170-207`) vs the Intro
  picker (`:209-220`)

### Related Tasks
- T5215 — introduced the frozen-at-share-time intro attachment (`_canonical_definition`,
  `collections.py`)
- T6680 — removed profile-default inheritance; `null` and `0` both resolve to "no intro" now,
  which is why an untouched picker silently freezes to no-intro instead of falling back to
  anything

## Implementation

### Steps
1. [ ] `CollectionShareModal.jsx`: move the Intro (`IntroCardCarousel`) block to be the first
       field, above "Add people" and the public/restricted toggle
2. [ ] `handleTogglePublic`: stop calling `createShare` on toggle-on; just set `isPublic`
3. [ ] Add a "Get Link" action (visible when `isPublic && !publicLink`) that calls
       `createShare([], true)` and sets `publicLink`; on failure show the error and keep the
       retry available
4. [ ] Clear `publicLink` when the intro selection changes after a link was created
5. [ ] Vitest: regression test pinning bug 43p (picked card id reaches the POST body), plus
       the toggle/Get-Link/email-flow/DOM-order cases
6. [ ] Manual verify in browser: pick an intro card, then toggle public + get link -> shared
       link plays the intro; toggle public without picking -> link explicitly has no intro
       (matches the visible "No intro" tile)

## Acceptance Criteria
- [ ] Opening the modal shows the Intro picker before the public-link toggle
- [ ] Flipping "Anyone with the link" on does NOT create a share by itself
- [ ] A new explicit action creates the public link, using the intro selection visible at
      that moment
- [ ] Changing the intro after a link exists clears the stale link
- [ ] The recipient-email share flow (`handleSubmit`) is unchanged
- [ ] A collection with an explicitly picked intro card plays it on the shared link
