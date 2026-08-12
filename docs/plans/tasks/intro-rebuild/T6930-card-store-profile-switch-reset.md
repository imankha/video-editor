# T6930: Intro card store survives profile switch — wrong card gets attached and plays

**Status:** WAITING ON USER (implemented on feature/T6930-intro-card-bugfixes, awaiting user test + merge approval)
**Impact:** 7
**Complexity:** 2
**Created:** 2026-08-12
**Updated:** 2026-08-12
**Epic:** [intro bug fixes](EPIC.md)

## Problem

This is the most likely mechanism behind the user-reported "I attached card X and card Y
played" (2026-08-12).

`useIntroCardStore` holds the card library (`src/frontend/src/stores/introCardStore.js:21-145`).
`profileStore._resetDataStores()` (`src/frontend/src/stores/profileStore.js:334-345`) resets
12 data stores on profile switch — `useIntroCardStore` is **not one of them**, and its
`reset()` action (`introCardStore.js:144`) has **zero call sites** in the tree (dead code).

Card ids are per-profile SQLite AUTOINCREMENT (`intro_cards` DDL,
`src/backend/app/database.py:1053-1072`) — profile A's card 2 and profile B's card 2 are
different cards with the same id. So after a switch:

1. The picker/carousel can render the PREVIOUS profile's cards from the stale store
   (fetch only happens on modal open: `IntroCardsModal.jsx:33-35`,
   `DownloadsPanel.jsx:359-361`, `CollectionShareModal.jsx:53-55` — and while the fetch is
   in flight, the stale list is what's on screen).
2. User clicks "their" card 2 → `PATCH /api/downloads/{id}/intro` with `intro_card_id=2`.
3. The backend validates the id against the CURRENT profile's `intro_cards`
   (`src/backend/app/routers/downloads.py:1138-1141`) — where id 2 exists as a different
   card. Attach succeeds, no error anywhere, the wrong card plays and the wrong badge shows.

## Solution

Two layers — fix the store lifecycle AND remove the silent cross-profile id ambiguity:

1. **Enroll the store in profile-scope teardown.** Add `useIntroCardStore.getState().reset()`
   to `_resetDataStores()` in `profileStore.js` (match the exact call pattern of the other
   12 entries in that function). Verify `reset()` clears: `cards`, any `loaded`/`loading`
   flags, and (if T6850 hasn't landed yet in your branch base) `minDuration` state — reset
   must return the store to its pristine initial state.
2. **Make the stale-render window harmless.** In `introCardStore.fetchCards()`, record which
   profile the fetch was for (read the active profile id from `profileStore` at call time,
   store it as `cardsProfileId` alongside `cards`). Components that render the library
   (`IntroCardCarousel`/`IntroCardPicker`/`IntroCardsModal`) must treat
   `cardsProfileId !== activeProfileId` the same as "not loaded yet" (show the loading
   state, never the stale list). This closes the in-flight window that step 1 alone leaves.

Do NOT add a backend cross-profile check — the backend cannot distinguish "profile B's real
card 2" from "stale id 2 from profile A"; the id namespace is per-profile by design (epic
decision 7). The fix is entirely a frontend-lifecycle fix.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/profileStore.js` — `_resetDataStores()` (~334-345): add the entry
- `src/frontend/src/stores/introCardStore.js` — `reset()` (~144); `fetchCards()` (~30-58):
  add `cardsProfileId`
- `src/frontend/src/components/introcards/IntroCardCarousel.jsx`,
  `IntroCardPicker.jsx`, `IntroCardsModal.jsx` — gate rendering on `cardsProfileId`
- Tests: `src/frontend/src/stores/__tests__/` (or colocated) — see Test Plan

### Related Tasks
- Parent audit + design: [EPIC.md](EPIC.md); mechanism labelled M1 in the design artifact
- T6690 shipped `handleSwitchAndManageCards()` (`ManageProfilesModal.jsx:282-286`) which
  chains a profile switch + opening the card library — this exact flow is the easiest
  repro path; make sure it still works after the fix (the modal must show the NEW
  profile's cards, with a loading state, never the old list)

### Technical Notes
- `_resetDataStores()` is the single profile-scope teardown; adding the store there is the
  pattern — do not invent a new effect or subscription (no reactive persistence, and no
  `useEffect`-watching-profile anti-pattern).
- `patchCardLocal` (`introCardStore.js:84-87`) merges optimistically — irrelevant here but
  don't break it.
- Keep the change surgical; this is NOT the place to refactor the store.

## Implementation

### Steps
1. [ ] Add `useIntroCardStore` reset to `_resetDataStores()` (import at top of
       `profileStore.js`, same style as the other stores)
2. [ ] Add `cardsProfileId` to the store; set it in `fetchCards()`; clear in `reset()`
3. [ ] Gate the three library-rendering components on
       `cardsProfileId === activeProfileId` (loading state otherwise)
4. [ ] Tests (below), lint, targeted run

### Test Plan (relevant set, ~6 tests)
- Unit (Vitest): switching profile clears `useIntroCardStore` (simulate: seed cards,
  call `_resetDataStores()`, assert pristine state)
- Unit: `fetchCards()` stamps `cardsProfileId`; `reset()` clears it
- Unit: `IntroCardCarousel` renders loading (not the stale list) when
  `cardsProfileId !== activeProfileId`
- Existing regression guards for the picker (from T6670) stay green
- Manual QA: two profiles, each with differently-named cards. (a) open card library on A,
  (b) switch to B via ManageProfiles "Athlete Intro Cards" chained flow (T6690), assert
  B's cards show (never A's, not even for a frame you can catch), (c) attach a card on B's
  reel, play it in-app, assert the SAME card plays and the badge names it.

## Acceptance Criteria
- [ ] `useIntroCardStore.getState().reset` has a real call site in `_resetDataStores()`
- [ ] After a profile switch, no surface can render the previous profile's card list
  (including the in-flight-fetch window)
- [ ] Manual QA script above passes on a real two-profile account
- [ ] Relevant tests green; eslint clean

## Progress Log

**2026-08-12**: Implemented. Deviation (reviewer-accepted): a module-level GENERATION counter in introCardStore invalidates in-flight fetches and drops the _fetchPromise dedup handle on reset(), instead of the task's cardsProfileId stamp + per-component gating - kills the stale data at the source with zero component edits. Store enrolled in _resetDataStores(). Tests: 2 new store tests (in-flight discard, dedup drop). Reviewer note: the microtask window between currentProfileId set and the reset is not exposable by either chained flow (gallery closes; T6690 awaits the switch before opening the library).
