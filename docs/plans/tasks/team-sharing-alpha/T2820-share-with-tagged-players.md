# T2820: Share with Tagged Players

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2800 (data model), T2810 (annotation UI)

## Problem

After annotating clips and tagging teammates, users need a way to share those clips with the tagged players' families. The user maps tag names to email addresses, and those mappings are stored for future reuse.

## Solution

### "Share with Tagged Players" Button

Add a button to the annotation mode toolbar/action bar. Only enabled when the current game has clips with `tagged_teammates`.

### Share Flow

1. User clicks "Share with Tagged Players"
2. Modal opens showing all unique tag names from the current game's annotations
3. For each tag name:
   - Checkbox (default checked) to include/exclude
   - Email input field(s) with autocomplete from stored `teammate_emails`
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

A tag like "Jake" can have multiple email addresses (e.g., mom and dad). The UI shows each as a chip with an X to remove. "Add another email" link adds a new input row.

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

Backend (T2830) handles: filtering annotations per tag, materialization, email delivery.

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

## Estimate

~300 LOC frontend, ~100 LOC tests
