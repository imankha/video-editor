# T2905 Testing Handoff: Share Annotated Playback via Link

## What Was Built

T2905 adds the ability for users to share their annotated playback view (game recap with tagged athlete clips) with anyone via email link. Recipients see the annotated highlights using the existing SharedAnnotationView with a signup CTA.

**Branch:** `feature/T2905-share-annotated-playback`  
**Commits:** 2 (implementation + tests)  
**Status:** TESTING (all automated tests pass)

---

## Architecture

```
User views Recap in RecapPlayerModal
  -> Clicks Share2 icon (top-right header, next to close button)
  -> SharePlaybackDialog opens (tag selector + email input)
  -> POST /api/games/{game_id}/share-playback { emails, tag_name }
  -> Backend:
     1. Creates shares row (share_type = 'annotation_playback')
     2. Creates share_games row (game_id + tag_name + clip_names)
     3. Pre-serializes clip data into pending_teammate_shares
     4. Sends email via Resend (fire-and-forget)
  -> Recipient clicks link -> /shared/teammate/{share_token}
  -> Existing SharedAnnotationView renders annotated playback + signup CTA
```

---

## Files Changed

### Backend

| File | Change |
|------|--------|
| `src/backend/app/migrations/postgres/v003_annotation_playback_share_type.py` | NEW - Adds `'annotation_playback'` to shares CHECK constraint |
| `src/backend/app/migrations/postgres/__init__.py` | Registers v003 migration |
| `src/backend/app/services/pg.py` line ~99 | Updated DDL CHECK to include `'annotation_playback'` |
| `src/backend/app/services/sharing_db.py` line ~141 | Added `share_type` param to `create_game_share()` (default: `"game"`) |
| `src/backend/app/services/email.py` line ~421 | NEW function `send_playback_share_email()` |
| `src/backend/app/routers/games.py` line ~1646 | NEW endpoint `POST /{game_id}/share-playback` |
| `src/backend/app/routers/shares.py` line ~246 | Updated GET check to accept `annotation_playback` |

### Frontend

| File | Change |
|------|--------|
| `src/frontend/src/components/SharePlaybackDialog.jsx` | NEW - Dialog with tag selector + email input |
| `src/frontend/src/components/RecapPlayerModal.jsx` | Added Share2 icon button + dialog state |

### Tests

| File | Tests |
|------|-------|
| `src/backend/tests/test_share_playback.py` | 27 tests (endpoint, email, migration, GET) |
| `src/frontend/src/components/SharePlaybackDialog.test.jsx` | 20 tests |
| `src/frontend/src/components/RecapPlayerModal.test.jsx` | 8 tests |

---

## How to Test Manually

### Prerequisites

1. You need a game with annotated clips (at least 1 clip with a tag/athlete name)
2. The Postgres migration v003 must be applied: `POST /api/admin/migrate`
3. Dev servers running: backend (port 8000) + frontend (port 5173)

### Test Flow

**Use auth bypass for browser testing:**
```javascript
// In Playwright or browser console
await page.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
await page.evaluate(async () => {
  await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' } });
});
await page.evaluate(async () => {
  const { useAuthStore } = await import('/src/stores/authStore.js');
  useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
});
await page.reload();
```

**Steps:**

1. Navigate to a game that has recap data (annotated clips)
2. Open the game recap modal (click "Watch Recap" or similar)
3. Verify the Share2 icon appears in the top-right header area (only if clips exist)
4. Click the share icon
5. Verify SharePlaybackDialog opens with:
   - Title "Share Highlights: {game name}"
   - Tag selector dropdown (if multiple athletes) or hidden (if single athlete)
   - Email input (UserPicker)
6. Select a tag (if multiple) and enter an email
7. Click "Share"
8. Verify:
   - Success toast: "Highlights shared with 1 recipient"
   - Dialog closes
   - Check backend logs for `[share-playback]` entries
   - In dev mode (no RESEND_API_KEY): email logged as DEV MODE warning

**Recipient flow:**
1. Get the share_token from the DB or backend logs
2. Navigate to `/shared/teammate/{share_token}`
3. Verify SharedAnnotationView renders with annotated clips + signup CTA

### Edge Cases to Test

1. **No clips:** Open recap for a game with no clips -> share button should be hidden
2. **Single tag:** If all clips have the same tag, the tag selector should be hidden and that tag auto-selected
3. **Duplicate share:** Share the same game+tag+email twice -> second attempt should not create a new row, should not re-send email
4. **Multiple recipients:** Enter multiple emails -> each gets their own share record and email
5. **Nonexistent game:** API should return 404

---

## Known Potential Issues

### 1. Postgres Migration Not Applied

If you see `CheckViolation: new row for relation "shares" violates check constraint "shares_share_type_check"`, the v003 migration hasn't been applied.

**Fix:** Hit `POST /api/admin/migrate` endpoint, or manually run:
```sql
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_share_type_check;
ALTER TABLE shares ADD CONSTRAINT shares_share_type_check
  CHECK (share_type IN ('video', 'game', 'annotation_playback'));
```

### 2. Clip Query Uses JSON LIKE

The clip query uses `tags LIKE '%"tag_name"%'` which is fragile if tag names contain quotes or are substrings of other tags (e.g., "Jake" would match "Jake Smith"). This is the same pattern used elsewhere in the codebase, so it's consistent but worth knowing.

### 3. Deduplication Logic

Deduplication checks existing shares via `list_shares_for_game()` before creating new ones. It matches on `(recipient_email, tag_name, share_type == 'annotation_playback', not revoked)`. If a share was revoked and user tries to re-share, a new share record will be created (intentional).

### 4. Email in Dev Mode

Without `RESEND_API_KEY` set, emails log a warning but return `True` (success). The share is created regardless. To test actual email delivery, you need the Resend API key in `.env`.

### 5. RecapPlayerModal Tags Extraction

Tags are extracted from clips via `recapData.clips.flatMap(c => c.tags || [])` and deduplicated with `new Set()`. If clips don't have a `tags` array (older data), the dialog may show an empty tag list.

---

## Running Tests

```bash
# Backend (27 tests)
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_share_playback.py -v

# Frontend (28 tests)
cd src/frontend && npx vitest run src/components/SharePlaybackDialog.test.jsx src/components/RecapPlayerModal.test.jsx

# All frontend tests (ensure no regressions)
cd src/frontend && npm test
```

---

## Key Code Locations for Debugging

| What | Where |
|------|-------|
| Share button visibility logic | `RecapPlayerModal.jsx` line ~168: `recapData?.clips?.length > 0` |
| Tag extraction for dialog | `RecapPlayerModal.jsx` line ~381: `[...new Set(recapData.clips.flatMap(c => c.tags || []))]` |
| Endpoint handler | `games.py` line ~1650: `async def share_playback(game_id, body)` |
| Deduplication check | `games.py` line ~1704: checks `list_shares_for_game()` for existing match |
| Clip query (SQLite) | `games.py` line ~1688: `SELECT ... FROM raw_clips WHERE game_id = ? AND tags LIKE ?` |
| Email template | `email.py` line ~421: `send_playback_share_email()` |
| GET endpoint check | `shares.py` line ~246: `share_type not in ("game", "annotation_playback")` |
| Frontend submit | `SharePlaybackDialog.jsx` line ~39: `handleSubmit()` |

---

## Acceptance Criteria (from kickoff)

- [ ] Share button visible on annotated playback view when clips exist
- [ ] Clicking share opens email input dialog
- [ ] Submitting emails creates share records and sends email with playback link
- [ ] Non-user recipient sees annotated playback + signup CTA via shared link
- [ ] Authenticated recipient can materialize shared clips into their account
- [ ] Duplicate shares for same email + game + tag are prevented
