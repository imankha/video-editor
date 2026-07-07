# T4810: Game collections don't read as "Game Highlights" (reconcile with T4190)

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Priority:** P2
**Created:** 2026-07-06
**Updated:** 2026-07-06

## Problem (reported by imankh while reviewing tutorial videos, 2026-07-06)

In My Reels, the per-game highlight collections are titled **after the game** — the group
header reads "at Sporting Mar 21" and the locked card reads "at Sporting Mar 21 highlights".
The user expected these to clearly read as **"Game Highlights"** (that's also what the
publish tutorial narration says: "...grouped into collections like Top Plays and Game
Highlights"). Today nothing in the UI actually says "Game Highlights", so the collection
type isn't legible.

## Important history — this is a reconciliation, not a plain bug

This naming was **deliberately changed by T4190** (DONE, deployed prod 2026-07-04). T4190
renamed the game-group play-all card from the anonymous "Game Highlights" to
"vs {opponent} - {date}" specifically because two different games both showed identical
"Game Highlights" cards and users couldn't tell them apart (the "phantom 2nd card" bug).
There's even a regression test asserting the card is NOT called "Game Highlights":
`src/frontend/src/components/collections/GameCollectionGroup.newchip.test.jsx`
("titles the play-all card with the game name, not 'Game Highlights'").

So the two goals are in tension:
- T4190: disambiguate games (use opponent + date).
- This request: make it obvious these are "Game Highlights" collections.

**The real deliverable is a naming decision that satisfies BOTH**, then the code + test
changes to match. Do not just revert T4190 — that reintroduces the phantom-card confusion.

## Proposed options (pick with the user before coding)

1. Combine: title = **"Game Highlights · {opponent} {date}"** (or "{opponent} {date} —
   Game Highlights"). Legible type + disambiguated.
2. Section label: keep per-game cards named by game, but add a **"Game Highlights"**
   section heading above the game groups (parallel to a "Smart Collections" heading above
   Top Plays / Top Dribbles). Type lives in the heading, disambiguation in each card.
3. Keep as-is and instead change the tutorial talk track to say "grouped by game" rather
   than "Game Highlights". (Cheapest; no app change — but the user's instinct is that the
   product should say "Game Highlights", so prefer 1 or 2.)

## Where the naming lives (investigation done)

- **Game group header** (unlocked): `src/frontend/src/components/collections/GameCollectionGroup.jsx`
  — renders `title={name}` where `name` is the bare game name.
- **Locked card** (< 30s of reels): `src/frontend/src/components/collections/RatioUnlockGroup.jsx`
  line 20 — `const cardName = \`${name || 'Game'} highlights\``; also `LockedCollectionCard.jsx`
  / `LockedReasonModal.jsx` take that `name`.
- **Backend frozen share titles**: `src/backend/app/routers/collections.py` `_smart_base_name`
  (~661) names smart collections ("Top Plays", "Top {Tag}s"); game collections get the game
  name. If share titles should also read "Game Highlights", update here too.
- **Regression test to update**: `GameCollectionGroup.newchip.test.jsx` (currently asserts
  NOT "Game Highlights").

## Acceptance criteria

- [ ] A user can tell (a) that a collection is a **Game Highlights** collection AND (b)
      **which game** it's for, at a glance — without opening it.
- [ ] Two different games' highlights are never visually identical (the T4190 fix survives).
- [ ] Locked and unlocked states both use the agreed naming.
- [ ] Share titles (backend) match the in-app naming.
- [ ] `GameCollectionGroup.newchip.test.jsx` updated to assert the new naming; unit tests green.
- [ ] The publish tutorial's "Game Highlights" narration now matches what's on screen
      (coordinate with the ReelBallers tutorial video pipeline — it points a highlight ring
      at this card).
