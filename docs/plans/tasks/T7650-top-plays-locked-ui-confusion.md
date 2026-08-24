# T7650: "Top Plays" locked meter reads as broken (3 similar amber lock UIs + stale summary fetch)

**Status:** TODO
**Priority:** P4 (UX clarity, not data-integrity)
**Impact:** 3
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

Bug 45p (arshia.kalantari@gmail.com, prod, 2026-08-21, `/home/reels`, profile b95eb93b,
game 19 "New Game"): "Sometimes when I go into My Reels the locked Top Plays meter only
shows for the game and not the actual clip. On occasion when I wait long enough it will
randomly show up... Probably a function of me organizing the reels from the default
account into the individual player so there isn't enough footage to unlock the Top Plays
but still a glitch nonetheless."

Investigated whether this is a side effect of the Cross-Profile Game Attribution epic
(reels moved into kid profiles via metadata-only game references) undercounting footage
for ranking purposes - it is not: `move_reels_to_profile` (T5810) physically moves the
`final_videos` rows themselves, only the `games` row is a metadata-only reference
(`export-pipeline.md:240,274`), and ranking/Top Plays reads are 100% profile-local
(`rank.py` opens the current profile's own `profile.sqlite`, no cross-profile query).

Two more plausible, smaller mechanisms instead:
1. **Three visually-identical amber "locked" UIs exist** and are easy to conflate: the
   profile-wide Ranking Progress card (`ConfidenceBanner.jsx:83-125`), the per-game "Game
   Highlights" locked card (`RatioUnlockGroup.jsx:21-49`), and the per-clip "Top Play" rank
   badge (`ReelTile.jsx:230`) - same `LockedCollectionCard` chrome, different unlock
   conditions, no visual distinction explaining WHY each is locked.
2. **Summary-vs-member fetch staleness**: the game-level card renders from an initial
   `summary` fetch while individual clip tiles lazily fetch later (`useCollections.js:68-105`),
   plus a cold profile switch can trigger a 20s+ R2 restore (`database.py:800-914`) before
   local rating data is complete - both would produce exactly "locked at game level, clip
   appears correct after waiting."

Reporter's own hypothesis ("not enough footage") may simply be correct and the lock is
working as intended - this task is about the confusing PRESENTATION, not a data bug.

## Solution

1. Confirm in a real browser session (staging or a low-footage profile) which of the two
   mechanisms above (or both) actually reproduces "locked at game level, unlocked/correct
   at clip level after a delay."
2. If it's UI conflation: give the three locked states distinct enough copy/iconography
   that a user isn't left guessing whether it's the same lock. `LockedReasonModal.jsx`
   already has a `kind="ranking"` variant - extend that pattern per-surface rather than
   sharing one ambiguous caption.
3. If it's fetch staleness: either show a loading (not locked) state until the member
   fetch resolves, or fetch members eagerly alongside the summary for small collections.
4. Do not touch `move_reels_to_profile` or any cross-profile attribution code - confirmed
   out of scope.

## Context

### Relevant Files
- `src/frontend/src/components/.../ConfidenceBanner.jsx` (~L83-125) - profile-wide locked card
- `src/frontend/src/components/.../RatioUnlockGroup.jsx` (~L21-49) - per-game locked card
- `src/frontend/src/components/.../ReelTile.jsx` (~L230) - per-clip Top Play badge
- `src/frontend/src/components/.../LockedReasonModal.jsx` (~L21) - "why locked" copy
- `src/frontend/src/hooks/useCollections.js` (~L68-105) - summary vs. lazy member fetch
- `src/backend/app/rank.py` (`_rankable_pool` ~L100-132, `_confidence_stats` ~L251-288)
- `src/backend/app/collections.py` (`TOP_PLAYS` ~L100, bucket build ~L522-564)

### Related Tasks
- Checked against the **Cross-Profile Game Attribution epic**
  (`tasks/profile-game-attribution/EPIC.md`) and **T5830** (heal arshia's moved reels,
  DONE) - confirmed NOT related; ranking data is profile-local, only the `games` row is a
  metadata-only reference.
- Checked against **Season Highlights & Collections epic** (T3600-T3640, DONE/archived,
  which shipped Top Plays originally) - no open follow-up covers this presentation gap.

## Acceptance Criteria

- [ ] Root mechanism confirmed (UI conflation vs. fetch staleness vs. both) via real
      browser repro, not assumed
- [ ] Locked states are visually/textually distinguishable so a user can tell WHY each is
      locked without guessing
- [ ] No change to ranking eligibility logic or cross-profile attribution code
