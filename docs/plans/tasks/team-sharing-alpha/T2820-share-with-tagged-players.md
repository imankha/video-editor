# T2820: Share with Tagged Players

**Status:** TESTING
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2800 (data model), T2810 (annotation UI)

## T2800 Implementation Reference

- **Teammate email endpoints** (no `{profile_id}` in URL -- middleware sets profile):
  - `GET /api/clips/teammate-emails` -- returns `{ "Jake": [{id, email, created_at}, ...], "Alex": [...] }` grouped by tag name
  - `PUT /api/clips/teammate-emails` -- accepts `[{tag_name, email}]`, uses INSERT OR IGNORE for dedup
  - `DELETE /api/clips/teammate-emails/{id}` -- delete single mapping
- **Tag autocomplete**: `GET /api/clips/teammate-tags` returns distinct tag names sorted by frequency
- **Clip data**: `tagged_teammates` is a `string[]` on each clip. To get all tags for a game, fetch clips by `game_id` and collect unique values from `tagged_teammates` arrays.
- **No `{profile_id}` in URLs**: The task spec says `/api/profiles/{id}/...` but actual endpoints use `/api/clips/...` prefix. All profile-scoped endpoints use middleware context.

## T2810 Implementation Reference

- **TeammateTagInput component**: `src/frontend/src/components/shared/TeammateTagInput.jsx` -- chip-style input with autocomplete, free-text names. Reuse for email-per-tag input if needed.
- **Autocomplete suggestions**: Fetched once from `GET /api/clips/teammate-tags` in `AnnotateContainer.jsx`, merged with locally-used tags via `useMemo`. Passed down as `teammateSuggestions` prop through `AnnotateScreen -> ClipsSidePanel -> ClipDetailsEditor`.
- **`tagged_teammates` on regions**: Available on `clipRegions` array in `AnnotateContainer`. To get all unique tags for a game: `clipRegions.flatMap(r => r.tagged_teammates || [])` then deduplicate. No separate API call needed for the current session's tags.
- **`load_annotations_from_db`** (backend `games.py:1278`): Now returns `tagged_teammates` and `my_athlete` fields. `tagged_teammates` is msgpack-decoded. `my_athlete` is boolean (NULL defaults to true). This was a bug fix during T2810 -- the fields were being saved but not returned in the game annotations response.
- **Persistence chain**: `ClipDetailsEditor.onUpdate -> ClipsSidePanel.onUpdateRegion -> AnnotateContainer.updateClipRegionWithSync`. For existing clips (has `rawClipId`), sends surgical PUT. For new clips, sends full POST. Both paths include `tagged_teammates` and `my_athlete`.

## Problem

After annotating clips and tagging teammates, users need a way to share those clips with the tagged players' families. The user maps tag names to email addresses, and those mappings are stored for future reuse.

See [EPIC.md](EPIC.md) for design decisions: free-text tags (no roster), multiple emails per tag name, tag-to-email mappings stored per-profile in `teammate_emails` table (T2800).

## Solution

### "Share with Tagged Players" Button

Add a button to the annotation mode toolbar/action bar. Only enabled when the current game has clips with `tagged_teammates`.

### Share Flow

1. User clicks "Share with Tagged Players"
2. Modal opens showing all unique tag names from the current game's annotations
3. For each tag name:
   - Checkbox (default checked) to include/exclude
   - Email input field(s) with autocomplete from stored `teammate_emails` (T2800 API: `GET /api/profiles/{id}/teammate-emails`)
   - "Add email" to support multiple emails per tag
   - Shows count of annotations this tag appears in (e.g., "Jake -- 3 clips")
4. User fills in emails for tags that don't have stored mappings
5. User clicks "Share"
6. New/updated tag-to-email mappings are saved via `PUT /api/profiles/{id}/teammate-emails`
7. Share request fires to backend (T2830 handles materialization + email)

### Email Autocomplete

```
User focuses email field for "Jake"
  -> check teammate_emails for tag_name="Jake"
  -> if found: pre-fill with stored emails, user can edit
  -> if not found: empty field, user types email
  -> on share: save new mappings for next time
```

### Multiple Emails Per Tag

A tag like "Jake" can have multiple email addresses (e.g., mom and dad). The UI shows each as a chip with an X to remove. "Add another email" link adds a new input row. Reuses the chip-style pattern from `UserPicker.jsx`.

### Share API Request

```
POST /api/profiles/{profile_id}/share-with-teammates
{
  "game_id": 123,
  "recipients": [
    {
      "tag_name": "Jake",
      "emails": ["mom@email.com", "dad@email.com"]
    },
    {
      "tag_name": "Player 7",
      "emails": ["parent@email.com"]
    }
  ]
}
```

This is a frontend-only task. The endpoint is implemented in T2830. This task builds the UI and fires the request; T2830 handles filtering, materialization, and email delivery.

## UI Layout

```
+------------------------------------------+
|  Share with Tagged Players               |
|                                          |
|  [x] Jake (3 clips)                     |
|      [mom@email.com x] [dad@email.com x] |
|      + Add email                         |
|                                          |
|  [x] Player 7 (2 clips)                 |
|      [parent@email.com x]               |
|      + Add email                         |
|                                          |
|  [ ] Alex (1 clip)                       |
|      [_________________]                 |
|                                          |
|  [Cancel]              [Share (5 clips)] |
+------------------------------------------+
```

## Test Scope

- Frontend unit tests for share modal (tag list rendering, email input, checkbox behavior)
- Frontend unit tests for email autocomplete from stored mappings
- Integration test: share flow saves mappings + fires share request
- E2E: tag players, share, verify emails saved for autocomplete on next share

## Files Affected

- New component: `src/frontend/src/components/ShareWithTeammatesModal.jsx`
- `src/frontend/src/modes/annotate/AnnotateMode.jsx` -- add button
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` -- helper to collect unique tags from game
- Reuse chip pattern from `src/frontend/src/components/shared/UserPicker.jsx`

## Estimate

~300 LOC frontend, ~100 LOC tests
