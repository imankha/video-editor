# T1630: Sport-Driven Tag Selection

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-04-20
**Updated:** 2026-05-08

## Problem

After T1610 (profile sport field), T1620 (tag storage + seed data), and T1625
(custom tag editing), the annotation UI still needs to load the correct tags
based on the active profile's sport. Currently `useAnnotate.js` imports
directly from `soccerTags.js`.

## Solution

### Frontend

1. **Tag loading from API** -- `useAnnotate.js` fetches tags for the active
   profile's sport via the API endpoint from T1620, instead of importing
   static constants.

2. **Tag caching** -- Store fetched tags in a Zustand store (or profileStore)
   to avoid re-fetching on every annotation session. Invalidate when sport
   changes or tags are edited (T1625).

3. **Position selector** -- The position picker in the annotation UI shows
   positions for the active sport (e.g., QB/Receiver/Rusher for flag football
   instead of Attacker/Midfielder/Defender for soccer).

4. **No tags state** -- When a sport has no tags (custom sport, user hasn't
   created any yet):
   - Position picker is hidden
   - Tag selector is hidden
   - Clip annotation still works (rating, name, notes all functional)
   - No error or empty-state noise -- just a clean UI without tags

5. **Backward compatibility** -- If sport is missing on an old profile,
   default to soccer tags.

### Edge Cases

- **Changing sport on a profile with tagged clips:** existing tags remain
  as-is (stored as strings in `raw_clips.tags`). They may not match the new
  sport's tag set. This is acceptable -- old tags are still readable in the
  clip list, just not selectable in the annotation UI going forward.
- **Clip name generation** (`derive_clip_name`) uses tag names -- no change
  needed since it's tag-agnostic (works with any string).
- **ALLOWED_TAGS validation** in `useAnnotate.js` must be dynamic, derived
  from the fetched tag set rather than the static soccer import.

## Relevant Files

- `src/frontend/src/modes/annotate/constants/soccerTags.js` -- current static source
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` -- imports tags, ALLOWED_TAGS
- `src/frontend/src/stores/profileStore.js` -- holds active profile (with sport)
- `src/frontend/src/components/shared/TagSelector.jsx` -- tag selection UI
- `src/backend/app/queries.py` -- clip name generation from tags

## Depends On

- T1610 (profile sport field)
- T1620 (sport_tags table and seed data)
- T1625 (custom tag editing -- tags must be in DB)

## Acceptance Criteria

- [ ] Annotation UI loads tags from API based on active profile's sport
- [ ] Position picker shows sport-appropriate positions
- [ ] Changing sport on profile changes available tags on next annotation session
- [ ] Custom sports with no tags show a clean UI (no tags/positions, no errors)
- [ ] Existing tagged clips retain their tags after sport change
- [ ] ALLOWED_TAGS validation uses dynamic tag set, not static import
- [ ] Default to soccer if sport is missing or unrecognized
