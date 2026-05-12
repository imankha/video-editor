# T2810: Annotation UI -- Tags + My Athlete Toggle

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2800 (data model)
**Supersedes:** T1820 (Teammate Toggle UI)

## Problem

Users need a way to tag teammate names and toggle "my athlete" per clip during annotation. Must be fast and low-friction since users are scrubbing through video.

## Solution

### Teammate Tag Input

Add a free-text tag input to the annotation clip dialog (where name, rating, tags, notes are edited):

- Chip-style input (similar to UserPicker pattern)
- Type a name -> autocomplete from previously used tag names (via `GET /api/profiles/{id}/teammate-tags`)
- Enter/comma creates a new tag chip
- Click X on chip to remove
- Stored as `tagged_teammates` JSON array on the clip region

### My Athlete Toggle

- Simple toggle/switch labeled "My Athlete"
- Defaults to ON (true) for every new clip
- Stored as `my_athlete` boolean on the clip region
- Visual indicator: when OFF, shows subtle styling change on the clip region in the timeline

### Persistence

Both fields persist via the existing clip save gesture -- no new API calls or reactive persistence. The `tagged_teammates` array and `my_athlete` boolean are sent as part of the clip save payload.

### Autocomplete Data Flow

```
Component mount -> fetch GET /api/profiles/{id}/teammate-tags
  -> returns ["Jake", "Player 7", "Alex", ...]
  -> cached in component state for session

User types "Ja" -> filter cached list -> show "Jake" suggestion
User picks "Jake" or types new name -> add to clip's tagged_teammates array
User saves clip -> tagged_teammates sent in save payload
```

## UI Layout

In the annotation clip dialog, below existing fields:

```
[Clip Name]        [Rating: ****]
[Position: v]      [Tags: pass, goal]
[Notes: ___________________________]
[Teammates: [Jake x] [Player 7 x] [+] ]
[My Athlete: [ON] ]
```

## Test Scope

- Frontend unit tests for tag input component (add, remove, autocomplete filter)
- Frontend unit tests for my_athlete toggle state
- Verify save payload includes new fields
- E2E: add tags, toggle my_athlete, save, reload, verify persistence

## Files Affected

- `src/frontend/src/modes/annotate/` -- clip dialog component
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` -- region model (add fields)
- New component: teammate tag input (or extend existing chip input pattern)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` -- visual indicator for my_athlete=false

## Estimate

~200 LOC frontend, ~50 LOC tests
