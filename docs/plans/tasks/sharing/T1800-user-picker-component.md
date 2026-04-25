# T1800: User Picker Component

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

Multiple features need a shared UI for entering recipient emails: player tagging (T1820), game sharing (T1850), and video sharing (T1770). Each needs email input, autocomplete from prior shares, and account status feedback.

## Solution

Build a reusable `UserPicker` component and the backend infrastructure it needs: email account lookup and shared contacts autocomplete.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- New: `src/frontend/src/components/shared/UserPicker.jsx` — Reusable component
- `src/frontend/src/components/Gallery/ShareModal.jsx` — Will consume UserPicker (T1770)

**Backend:**
- `src/backend/app/routers/auth.py` — Add email lookup endpoint
- `src/backend/app/database.py` — Add `shared_contacts` table to profile DB schema
- `src/backend/app/storage.py` or new `src/backend/app/routers/sharing.py` — Contacts CRUD

### Related Tasks
- Blocks: T1820, T1840, T1850 (all use UserPicker)
- Reusable by: T1770 (Gallery Share UI in Shareable Video Links epic)
- Depends on: T1610 (athlete profiles — for meaningful athlete identity display)

### Technical Notes

**UserPicker component props:**
```jsx
<UserPicker
  selectedEmails={[]}           // Controlled list of selected emails
  onChange={(emails) => ...}    // Callback when list changes
  autoTagSelf={true}            // Auto-include current user's athlete
  multiple={true}               // Allow multiple emails
/>
```

**Each email entry shows:**
- Email address (as chip/tag)
- Green checkmark if account found in system
- Yellow warning icon + "No account" if not found
- Athlete name (if account found, from their profile — but we only know email, so backend returns display name from auth)

**Autocomplete source: `shared_contacts` table (per-profile DB):**
```sql
CREATE TABLE shared_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,              -- Cached from lookup at share time
    last_used_at TEXT NOT NULL,
    times_used INTEGER DEFAULT 1
);
```
Sorted by `times_used DESC, last_used_at DESC` for relevance.

**Backend lookup endpoint:**
- `GET /api/sharing/lookup?email=<email>` — Returns `{found: bool, display_name: str|null}`
- Queries `auth.sqlite` for matching email, returns profile display name if found
- Debounced from frontend (300ms) to avoid hammering on every keystroke

## Implementation

### Steps
1. [ ] Backend: Add `shared_contacts` table to profile DB schema + migration
2. [ ] Backend: CRUD for shared contacts (upsert on share, list for autocomplete)
3. [ ] Backend: `GET /api/sharing/lookup?email=` endpoint (queries auth.sqlite)
4. [ ] Frontend: UserPicker component — multi-email chip input with autocomplete dropdown
5. [ ] Frontend: Account status indicators (green check / yellow warning) via lookup endpoint
6. [ ] Frontend: Debounced lookup as user types
7. [ ] Tests: Backend tests for lookup + contacts endpoints

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] UserPicker renders multi-email chip/tag input
- [ ] Typing triggers autocomplete from shared_contacts (debounced)
- [ ] Each email shows green check (found) or yellow warning (not found)
- [ ] Can add/remove emails
- [ ] `autoTagSelf` pre-populates current user's email
- [ ] Reusable across multiple parent components
- [ ] Backend lookup returns account status without exposing sensitive data
