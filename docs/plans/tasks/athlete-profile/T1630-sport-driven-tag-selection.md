# T1630: Sport-Driven Tag Selection

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-20
**Updated:** 2026-05-08

## Problem

After T1610 (profile sport field) and T1620 (tag definitions per sport), the
annotation UI still needs to load the correct tags based on the active profile's
sport. Currently `useAnnotate.js` uses `DEFAULT_SPORT` from `tagRegistry.js`.

## Solution

### Frontend

1. **Read sport from profile** -- `useAnnotate.js` reads the active profile's
   sport from `profileStore` and calls `getTagSet(sport)` instead of using
   `DEFAULT_SPORT`.

2. **Position selector** -- The position picker in the annotation UI shows
   positions for the active sport (e.g., QB/Receiver/Rusher for flag football
   instead of Attacker/Midfielder/Defender for soccer).

3. **No tags state** -- When a sport has no tags (custom sport not in registry):
   - Position picker is hidden
   - Tag selector is hidden
   - Clip annotation still works (rating, name, notes all functional)
   - No error or empty-state noise -- just a clean UI without tags

4. **Backward compatibility** -- If sport is missing on an old profile,
   default to soccer tags.

### Edge Cases

- **Changing sport on a profile with tagged clips:** existing tags remain
  as-is (stored as strings in `raw_clips.tags`). They may not match the new
  sport's tag set. This is acceptable -- old tags are still readable in the
  clip list, just not selectable in the annotation UI going forward.
- **Clip name generation** (`derive_clip_name`) uses tag names -- no change
  needed since it's tag-agnostic (works with any string).
- **ALLOWED_TAGS validation** in `useAnnotate.js` must be dynamic, derived
  from the active sport's tag set rather than `DEFAULT_SPORT`.

## Relevant Files

- `src/frontend/src/modes/annotate/constants/tagRegistry.js` -- sport registry
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` -- ALLOWED_TAGS
- `src/frontend/src/stores/profileStore.js` -- holds active profile (with sport)
- `src/frontend/src/components/shared/TagSelector.jsx` -- tag selection UI
- `src/backend/app/queries.py` -- clip name generation from tags

## Depends On

- T1610 (profile sport field)
- T1620 (tag definitions per sport)

## Acceptance Criteria

- [ ] Annotation UI shows tags matching the active profile's sport
- [ ] Position picker shows sport-appropriate positions
- [ ] Changing sport on profile changes available tags on next annotation session
- [ ] Custom sports with no tags show a clean UI (no tags/positions, no errors)
- [ ] Existing tagged clips retain their tags after sport change
- [ ] ALLOWED_TAGS validation uses dynamic tag set, not static default
- [ ] Default to soccer if sport is missing or unrecognized
