# T5880: Smart auto-grouping by tournament / month / opponent (no manual folders)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-25
**Follows:** [Cross-Profile Game Attribution](profile-game-attribution/EPIC.md) (T5800-T5820 must land first)

## Problem

User feedback 2026-07-25 (arshia, the bug-37p reporter), on organizing a season's worth of content:

> "Thinking the easiest thing might be to create playlists with sub-lists. That way the user can
> make one for a tournament, or for league, or by month, and then sub-categorize below that by
> specific games. It would be nice to be able to refer or link back to the game it was taken from
> to at least auto-populate or auto-categorize clips into their associated game but not necessarily
> a big deal as long as the ability is there to make your own folders and sub-folders."

He asks for two things, and they are not equally good:

1. **Auto-categorize clips into their associated game** — his stated preference. This is exactly
   what the attribution epic (T5800-T5820) delivers. Nothing to do here.
2. **Manual folders / sub-folders** — his fallback, offered because he assumes (1) is hard.

## Decision: build the SMART version, not manual folders

**Rejected: manual folders/sub-folders.** Consistent with the attribution epic's Design Decision 1
(a parallel manual-folder system is redundant state + ongoing manual filing) and the project's
no-redundant-state rule. Manual hierarchies also decay: users create them once, stop filing, and the
feature then actively lies about where content lives. The audience (highly engaged soccer parents)
wants to celebrate moments, not maintain a library.

**The key observation:** every axis he named is already a column on `games` —
`tournament_name`, `game_type` (league/tournament/friendly), `game_date` (month/season),
`opponent_name` (`database.py:840-843`). So "a playlist for a tournament, or league, or by month,
then sub-categorized by specific games" is **fully derivable today** — zero filing.

And the hierarchy he describes (**tournament -> game -> clips**) becomes complete only once the
attribution epic lands, because that is what carries game attribution across profiles. **The epic is
the prerequisite for his own idea**, not a competitor to it.

## Solution

Extend the existing smart-collections mechanism (`collections.py`, `services/collection_metadata.py`
`route_collection`) with **derived** grouping axes. No new user concepts, no new manual state.

- **Group by tournament** — one group per `tournament_name`, containing that tournament's games.
- **Group by month / season** — derived from `game_date`.
- **Group by opponent** — derived from `opponent_name` (cheap once the others exist; include only if
  it does not clutter).
- **Two-level presentation:** the top level is the derived axis (tournament / month), the level below
  is the game — matching the "sub-list by specific games" shape he described.
- Server-computed, like every existing collection (`COLLECTION_MIN_DURATION_SEC`; "clients never
  derive eligibility"). Reuse the existing eligibility/threshold pattern rather than inventing one.
- Empty/absent metadata (no `tournament_name`) simply produces no group — never a fabricated
  "Unknown tournament" bucket (no-silent-fallback standard).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/collections.py` — `/api/collections/summary`, smart-collection assembly
- `src/backend/app/services/collection_metadata.py` — `route_collection`, `ORDER_BY_RANK`
- `src/backend/app/database.py:840-843` — `opponent_name`, `game_date`, `game_type`, `tournament_name`
- `src/frontend/src/components/collections/` — `CollectionsTab`, `GameCollectionGroup` (the group
  rendering to extend for the two-level shape)

### Related
- **Depends on:** [Cross-Profile Game Attribution](profile-game-attribution/EPIC.md) T5800-T5820 —
  supplies cross-profile game attribution, without which the tournament->game->clip chain breaks for
  moved reels
- T3670 (DONE) — Smart Collections (Top Goals/Assists/Dribbles): the pattern to extend
- T3610 (DONE) — Collections tab + game collections
- Curation ("clips for the recruiter", "highlights for grandma") is a DIFFERENT need already served
  by Collections + shares — do NOT solve it with a folder tree

## Acceptance Criteria

- [ ] Tournament / month grouping appears automatically from existing game metadata — zero user filing
- [ ] Two-level shape: derived axis at top, games beneath, matching the requested "sub-list" idea
- [ ] Games with no `tournament_name` produce no group (no fabricated bucket)
- [ ] Server-computed eligibility, consistent with existing smart collections
- [ ] Works for reels moved across profiles (relies on the attribution epic)
- [ ] No manual folder/sub-folder state introduced
- [ ] Real-browser evidence at 390 + 1280; unit tests for the grouping/eligibility logic

## Open question for the user (at kickoff)

Which axes ship first? Recommend **tournament + month** (the two he named explicitly); opponent is a
cheap add-on but risks clutter for teams that play the same opponent often.
