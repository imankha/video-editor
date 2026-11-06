# T15240: Email link give-up path moves, misses or mislabels in three edge cases

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** S to M (frontend only, no schema change)
**Created:** 2026-11-06
**Updated:** 2026-11-06

Found by independent verification of T14970 (its N3, N4 and N5).

## Problem

`utils/emailGameLink.js` waits 5 s for the game to appear, then lands on Games with the notice.

1. **N3, a visible yank.** A user who moved to Plays or Highlights inside those 5 s is moved to Games
   at the give-up, with the notice. The give-up only stands down when the editor mode changed, so a
   tab change on Home does not count. The notice is accurate; the move is not wanted.
2. **N4, a slow list loses a valid link.** A valid link whose game list takes over 5 s never opens:
   with a 7 s delay it landed on "We couldn't load this game" and nothing retried. The old code also
   gave up at 5 s, silently. A 3 s delay opens fine.
3. **N5, an empty profile.** `/?game=11&profile=<empty profile>` from a profile holding game 11: the
   list still holds the old profile's rows, so the app briefly goes to
   `/annotate/g/11?profile=<empty>`, then lands on `/home/reels`. Nothing opens in the wrong profile,
   but the old rows satisfy the wait. No notice was observed on desktop.

Timing note: the timer starts after the profile switch, so the notice appears about 9 s after load.

## Solution

Give up on the list's own load state rather than a fixed timer, so a slow list still opens and a
finished list decides at once. Stand down if the user has moved anywhere since the link started,
including a Home tab. Wait for the switched profile's list, not any non-empty list.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/utils/emailGameLink.js`, `emailGameLink.test.js`
- `src/frontend/src/stores/gamesDataStore.js` (load state)
- `src/frontend/src/stores/profileStore.js` (`switchProfile` does not await its Phase 3 refetch)

### Related Tasks

- T14970: the deep link work this follows. T7670: the upload-complete email.

## Acceptance Criteria

- [ ] A user who moved to another Home tab before the give-up stays there.
- [ ] A valid link opens however long the list takes, and shows no notice.
- [ ] A game missing from a loaded list lands on Games with the notice without waiting out a timer.
- [ ] A link to an empty profile never routes through the editor, and shows the notice.
- [ ] One test drives the real `rejectUrlProfile`, not a mock.
