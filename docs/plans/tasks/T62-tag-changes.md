# T62: Tag Changes

**Status:** DONE
**Impact:** 3
**Complexity:** 3
**Created:** 2026-02-11
**Updated:** 2026-02-12

## Problem

Tag system needs restructuring to highlight the most recruit-worthy attributes for each position.

## Solution

Update `src/frontend/src/modes/annotate/constants/soccerTags.js`:

### Tag Changes by Position

| Position | Keep | Remove | Add/Rename |
|----------|------|--------|------------|
| Attacker | Goals, Assists, Dribbling | Movement Off Ball | - |
| Midfielder | Passing Range, Chance Creation | Possession Play | Rename "Transitions" → "Control" |
| Defender | Tackles, Interceptions, Build-Up Passing | 1v1 Defense | - |
| Goalie | Distribution | Shot Stopping, Command of Area, 1v1 Saves | Add "Saves" (replaces both save types) |

### Final Structure (3 tags per position, except Goalie with 2)

```
Attacker:   Goals, Assists, Dribbling
Midfielder: Passing Range, Chance Creation, Control
Defender:   Tackles, Interceptions, Build-Up Passing
Goalie:     Saves, Distribution
```

### Database Migration

Run migration script to update existing clips for user "a":
- `1v1 Defense` → `Tackles` (clips: 37, 42, 43, 137)
- `Possession Play` → `Control` (clip: 120)

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/constants/soccerTags.js` - Tag definitions
- `user_data/a/database.sqlite` - User database with clips to migrate

### Technical Notes
- Tags are stored as JSON arrays in `raw_clips.tags` column
- Migration script should be run as part of implementation
- No backend changes needed (tags are frontend constants)

## Implementation

### Steps
1. [ ] Update soccerTags.js with new tag structure
2. [ ] Create and run migration script for user "a" database
3. [ ] Verify migration succeeded

## Acceptance Criteria

- [ ] Attacker has 3 tags: Goals, Assists, Dribbling
- [ ] Midfielder has 3 tags: Passing Range, Chance Creation, Control
- [ ] Defender has 3 tags: Tackles, Interceptions, Build-Up Passing
- [ ] Goalie has 2 tags: Saves, Distribution
- [ ] Clips 37, 42, 43, 137 have "Tackles" instead of "1v1 Defense"
- [ ] Clip 120 has "Control" instead of "Possession Play"
