# T2905: Share Annotated Playback — Testing Kickoff

## What This Feature Does

T2905 lets users share ALL annotated clips from a game with a coach or mentor via email link. This is different from T2820 (Share with Teammates) which shares specific tagged clips with the athletes in them. This feature shares the complete annotation playback — every clip the user annotated in a game.

**Branch:** `feature/T2905-share-annotated-playback`
**Status:** TESTING (uncommitted changes from manual testing session need commit)

---

## User Flow

```
1. User opens a game -> lands on AnnotateScreen
2. User has annotated clips (various ratings)
3. User clicks "Playback Annotations" button -> enters playback mode
4. In playback controls bar (bottom), a Share icon appears between 1x speed and fullscreen
5. User clicks Share icon -> SharePlaybackDialog opens
6. Dialog title: "Share Annotations: {game name}"
7. User enters email(s) via UserPicker -> clicks "Share"
8. Backend: POST /api/games/{game_id}/share-playback { emails: [...] }
   - Creates share record (share_type = 'annotation_playback')
   - Fetches ALL raw_clips for the game (no tag filtering)
   - Sends email with link to /shared/teammate/{share_token}
   - Materializes clips into recipient's account (or creates pending share)
9. Recipient clicks link -> SharedAnnotationView renders clips + signup CTA
```

---

## Architecture

### Frontend

| File | Role |
|------|------|
| `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` | Added `onShare` prop -- renders Share2 icon button between speed control and fullscreen. Only shows when `onShare` is provided. |
| `src/frontend/src/modes/AnnotateModeView.jsx` | Accepts `onSharePlayback` prop, passes it as `onShare` to PlaybackControls in playback mode. Existing `onShare` (T2820) stays for annotate mode. |
| `src/frontend/src/screens/AnnotateScreen.jsx` | Owns `showPlaybackShareDialog` state. Passes `onSharePlayback={() => setShowPlaybackShareDialog(true)}` to AnnotateModeView. Renders `SharePlaybackDialog` with `z-[200]` (above fullscreen playback's `z-[100]`). |
| `src/frontend/src/components/SharePlaybackDialog.jsx` | Simple dialog: email input via UserPicker, no tag selector. POSTs `{ emails }` to `/api/games/{id}/share-playback`. Closes on X/Cancel/Escape but NOT on backdrop click. |
| `src/frontend/src/components/RecapPlayerModal.jsx` | Also has share button wired via PlaybackControls `onShare`. This component is accessible from GameCard in the Games list (Play button / Annotations button). Lower priority for testing. |

### Backend

| File | Role |
|------|------|
| `src/backend/app/routers/games.py` ~line 1646 | `POST /{game_id}/share-playback` endpoint. Request body: `{ emails: list[str] }`. No `tag_name`. Fetches ALL `raw_clips` for the game. Creates share records, sends emails, materializes. |
| `src/backend/app/services/email.py` ~line 421 | `send_playback_share_email()` -- no `athlete_name` param. Subject: "{sharer} shared game annotations with you". CTA: "Watch Annotations". |
| `src/backend/app/migrations/postgres/v003_annotation_playback_share_type.py` | Adds `'annotation_playback'` to shares CHECK constraint. |
| `src/backend/app/services/sharing_db.py` ~line 141 | `create_game_share()` accepts `share_type` param (default `"game"`). |
| `src/backend/app/routers/shares.py` ~line 246 | GET endpoint accepts `annotation_playback` share_type. |

### Recipient Flow

| File | Role |
|------|------|
| `src/frontend/src/App.jsx` ~line 286 | Detects `/shared/teammate/:token` URL |
| `src/frontend/src/components/SharedAnnotationView.jsx` | Renders shared annotation playback + signup CTA |
| `src/backend/app/routers/shares.py` ~line 243 | GET endpoint validates share token, accepts `annotation_playback` type |

---

## How to Test

### Prerequisites

1. Dev servers running: backend (port 8000) + frontend (port 5173)
2. A game with annotated clips (user needs at least 1 clip)
3. Postgres migration v003 applied: `POST /api/admin/migrate`

### Happy Path

1. Open a game that has annotated clips
2. Click "Playback Annotations" to enter playback mode
3. Verify Share icon (arrow-out-of-box) appears in controls bar, between 1x and fullscreen
4. Click the share icon
5. Verify dialog opens with title "Share Annotations: {game name}"
6. Enter an email address, press Enter
7. Verify Share button becomes enabled (cyan)
8. Click Share
9. Verify success toast: "Annotations shared with 1 recipient"
10. Verify dialog closes
11. Check backend logs for `[share-playback]` entries -- should show ALL clips materialized, not "no clips"
12. Get share token from backend log: `Share URL: http://localhost:5173/shared/teammate/{token}`
13. Open that URL in an incognito window
14. Verify SharedAnnotationView renders with annotation clips + signup CTA

### Edge Cases

1. **No clips:** Open a game with 0 clips -> share button should NOT appear in playback controls (playback mode should not even be available)
2. **Backdrop click:** Click outside the dialog -> should NOT close (intentional)
3. **Escape key:** Press Escape -> should close the dialog
4. **X button / Cancel:** Both should close the dialog
5. **Duplicate share:** Share the same game to the same email twice -> second should reuse existing share record (dedup by email + share_type, not tag)
6. **Multiple recipients:** Enter multiple emails -> each gets their own share record and email
7. **Fullscreen playback:** Enter fullscreen (the expand icon), then click share -> dialog should appear ABOVE fullscreen (`z-[200]` vs `z-[100]`)
8. **Empty email list:** Share button should be disabled when no emails entered
9. **Nonexistent game:** Direct API call with bad game_id -> should 404

### Dev Mode Notes

- Without `RESEND_API_KEY` in `.env`, emails log a DEV MODE warning but return success
- The share record is still created and the share URL works
- Look for `[Email] DEV MODE` in backend logs to find the share URL

---

## Uncommitted Changes

There are 8 files with uncommitted changes on this branch. These changes were made during a manual testing session and need to be committed. The changes:

1. Moved share button from RecapPlayerModal header into PlaybackControls component (reusable)
2. Wired SharePlaybackDialog into AnnotateScreen (the actual user flow) via `onSharePlayback` prop
3. Removed tag_name from the entire code path (request body, clip query, dedup, email, materialization)
4. Fixed: dialog does not close on backdrop click
5. Fixed: title says "Share Annotations" not "Share Highlights"
6. Fixed: Share button enables when emails are added (no tag requirement)
7. Email template rewritten: no athlete references, says "game annotations"
8. SharePlaybackDialog z-index bumped to `z-[200]` to render above fullscreen playback

---

## Running Tests

```bash
# Backend (27 tests) -- tests need updates for tag_name removal
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_share_playback.py -v

# Frontend (28 tests)
cd src/frontend && npx vitest run src/components/SharePlaybackDialog.test.jsx src/components/RecapPlayerModal.test.jsx

# Full frontend suite (regression check)
cd src/frontend && npm test
```

**Known:** Backend tests in `test_share_playback.py` likely still send `tag_name` in request bodies and assert on tag-related behavior. These need updating to match the new tag-free API.

**Known:** Frontend tests in `SharePlaybackDialog.test.jsx` still pass `tags` prop and test tag selector behavior. These need updating to match the simplified component (no tags prop, no tag selector).

---

## Acceptance Criteria

- [x] Share button visible in annotation playback controls (between 1x and fullscreen)
- [x] Clicking share opens email input dialog (title: "Share Annotations: {game name}")
- [x] Dialog does NOT close on backdrop click
- [x] Submitting emails creates share records and sends email with playback link
- [ ] All clips for the game are included (not filtered by tag) -- verify via backend logs
- [ ] Non-user recipient sees annotated playback + signup CTA via shared link
- [ ] Authenticated recipient can materialize shared clips into their account
- [ ] Duplicate shares for same email + game are prevented (dedup without tag)
- [ ] Backend tests updated and passing
- [ ] Frontend tests updated and passing
- [ ] Changes committed
