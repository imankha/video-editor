# T1630: Sport-Driven Tag Selection

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-04-20
**Updated:** 2026-04-20

## Problem

After T1610 (profile sport field) and T1620 (tag definitions per sport), the
annotation UI still needs to load the correct tags based on the active profile's
sport. Currently `useAnnotate.js` imports directly from `soccerTags.js`.

## Solution

### Frontend

1. **Tag registry** -- an index file that maps sport ID to its tag module:
   ```javascript
   import { soccerTags, positions as soccerPositions } from './soccerTags';
   import { footballTags, positions as footballPositions } from './footballTags';
   // ...
   export function getTagsForSport(sport) { ... }
   export function getPositionsForSport(sport) { ... }
   ```

2. **Wire into annotation** -- `useAnnotate.js` reads the active profile's
   sport from `profileStore` and calls `getTagsForSport(sport)` instead of
   importing `soccerTags` directly.

3. **Position selector** -- the position picker in the annotation UI should
   show positions for the active sport (e.g., QB/WR/RB for football instead
   of Attacker/Midfielder/Defender).

4. **Backward compatibility** -- if sport is missing or unrecognized, default
   to soccer tags.

### Edge cases

- Changing sport on a profile that already has tagged clips: existing tags
  remain as-is (stored as strings in raw_clips.tags). They may not match
  the new sport's tag set. This is acceptable -- old tags are still readable,
  just not selectable in the UI.
- Clip name generation (`generateClipName`) uses tag names -- no change needed
  since it's tag-agnostic (works with any string).

## Relevant Files

- `src/frontend/src/modes/annotate/constants/soccerTags.js` -- current tag source
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` -- imports tags
- `src/frontend/src/stores/profileStore.js` -- holds active profile (with sport)
- `src/backend/app/routers/games.py` -- clip name generation from tags (lines 72-89)

## Depends On

- T1610 (profile sport field)
- T1620 (sport-specific tag definitions)

## Acceptance Criteria

- [ ] Annotation UI shows tags matching the active profile's sport
- [ ] Position picker shows sport-appropriate positions
- [ ] Changing sport on profile changes available tags on next annotation session
- [ ] Existing tagged clips retain their tags after sport change
- [ ] Default to soccer if sport is missing or unrecognized
