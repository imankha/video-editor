# T1800: User Picker Component

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-05-01

## Problem

The ShareModal currently uses a plain text input for emails. Users must type full email addresses with no autocomplete or discovery. For repeat sharing (teammates, parents on the same team), this is tedious.

## Solution

Build a `UserPicker` component that upgrades the ShareModal's email input with chip-style tags and autocomplete from prior shares.

## Context

### What Already Exists (from T1750/T1770)

- **ShareModal** lives at `src/frontend/src/components/ShareModal.jsx` (not in Gallery/)
- ShareModal props: `{ videoId, videoName, onClose }`
- ShareModal already parses comma/semicolon-separated emails, validates with regex, and shows yellow "(invite)" for non-existing users via `is_existing_user` from `ShareCreateResponse`
- Backend `POST /api/gallery/{video_id}/share` already returns `is_existing_user: bool` per recipient (looked up from auth.sqlite at share time)
- Backend `GET /api/gallery/{video_id}/shares` returns existing shares with `recipient_email`
- Email lookup infrastructure: `get_user_by_email()` exists in `app/services/auth_db.py`
- No `shared_contacts` table exists yet — autocomplete source needs to be created
- Sharing DB is global (`sharing.sqlite`), not per-profile — can query all prior recipients for a user

### Relevant Files

**Frontend:**
- Modify: `src/frontend/src/components/ShareModal.jsx` — Replace plain text input with UserPicker
- New: `src/frontend/src/components/shared/UserPicker.jsx` — Reusable chip input with autocomplete

**Backend:**
- New endpoint: `GET /api/gallery/contacts` — Returns prior share recipients for autocomplete (queries sharing.sqlite for distinct recipient_emails by sharer_user_id, ordered by frequency)
- `src/backend/app/routers/shares.py` — Add contacts endpoint to `gallery_shares_router`
- `src/backend/app/services/sharing_db.py` — Add `list_contacts_for_user(sharer_user_id)` query

### Related Tasks
- Enhances: T1770 (upgrades ShareModal input)
- Depends on: T1750 (sharing.sqlite must exist)

### Technical Notes

**Autocomplete source — query sharing.sqlite directly (no new table needed):**
```sql
SELECT recipient_email, COUNT(*) as times_shared, MAX(shared_at) as last_shared
FROM shared_videos
WHERE sharer_user_id = ? AND revoked_at IS NULL
GROUP BY recipient_email
ORDER BY times_shared DESC, last_shared DESC
LIMIT 20
```
This avoids a `shared_contacts` table — the sharing.sqlite already has all the data. Keep it simple.

**UserPicker component:**
```jsx
<UserPicker
  emails={['alice@example.com']}   // Controlled list
  onChange={(emails) => ...}        // Callback
  contacts={[]}                     // Autocomplete suggestions (from API)
  placeholder="Enter emails..."
/>
```

**Each chip shows:**
- Email text with × remove button
- Account status indicator is shown post-submit (already exists in ShareModal success state via `is_existing_user`)

**Autocomplete dropdown:**
- Appears on focus if contacts exist, filtered by typed prefix
- Shows email + share count ("shared 3 times")
- Keyboard navigable (arrow keys + Enter to select)

**No `autoTagSelf` needed** — removed from scope, not relevant for video sharing

## Implementation

### Steps
1. [ ] Backend: Add `list_contacts_for_user()` to sharing_db.py (query shown above)
2. [ ] Backend: Add `GET /api/gallery/contacts` endpoint to shares.py
3. [ ] Frontend: Build UserPicker component — chip input with autocomplete dropdown
4. [ ] Frontend: Replace ShareModal's plain text input with UserPicker
5. [ ] Frontend: Fetch contacts on ShareModal mount, pass to UserPicker
6. [ ] Backend tests for contacts endpoint

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] UserPicker renders email chips (add via Enter/comma, remove via × or Backspace)
- [ ] Autocomplete dropdown shows prior share recipients on focus/type
- [ ] Selecting from dropdown adds chip
- [ ] Replaces existing plain text input in ShareModal
- [ ] Backend contacts endpoint returns prior recipients sorted by frequency
- [ ] Keyboard navigable (arrow keys, Enter, Escape)
