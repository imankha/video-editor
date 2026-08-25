# T7490: Pending uploads invisible in UI; stale resume records silently reaped

**Status:** STAGING
**Priority:** P1
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-24
**Updated:** 2026-08-24
**Epic:** [Upload Failure Integrity](EPIC.md)

## Problem

Two compounding invisibility bugs around a game whose upload died without completing:

1. **A `status='pending'` game is structurally invisible.** `gamesDataStore.js` computes
   `readyGames = games.filter(g => g.status !== 'pending')` (~60, ~90) and the Games screen
   renders `useReadyGames()` (`ProjectsScreen.jsx` ~118). If the upload dies without the
   failure handler running (tab closed mid-retry, browser crash), the row survives as
   pending forever and neither the user nor an impersonating admin ever sees it. There is no
   UI anywhere that says "this upload didn't finish."

2. **The resume path reaps itself silently and leaks the R2 multipart.** When the stored
   `r2_upload_id` no longer validates (`r2_is_multipart_upload_valid`, storage.py ~2362,
   returns invalid because R2 reports NoSuchUpload), `GET /api/games/pending-uploads`
   (`games_upload.py` ~425-480) silently DELETEs the pending_uploads row WITHOUT aborting
   the R2 multipart and WITHOUT touching the orphaned pending game row. After that the game
   is a permanent invisible orphan and R2 accumulates an incomplete multipart upload.

### Proven on prod (2026-08-24 investigation)

roooooooooom1h@gmail.com (user `efb1e9e8-d513-4e6d-bc8d-d6eae5a243e2`, profile `4a613b52`):
1 game at `status='pending'` (17.8 MB WhatsApp video, upload initiated 2026-08-23 01:04:27,
multipart still open in R2 with 0 parts), 1 pending_uploads row whose `r2_upload_id` now
returns NoSuchUpload. The user sees an empty app; the admin impersonating sees an empty app;
the row and the leaked multipart sit there indefinitely.

## Solution

1. **Surface pending games.** Show a game whose upload did not complete as a visible card in
   its natural place in the Games list, clearly marked (e.g. "Upload incomplete") with
   explicit actions: Retry/Resume (when a valid resume session exists or the local file can
   be re-selected) and Discard (user-gestured delete, full cascade is correct here since the
   user is explicitly abandoning it). Design pass needed on the card state; reuse the
   existing tile look with an overlay state rather than inventing a new surface.
2. **Honest reaping.** When `list_pending_uploads` finds an invalid `r2_upload_id`:
   abort the R2 multipart (stop the leak), and do NOT silently delete the row while a
   pending game still points at it; instead mark the state so the UI can render "upload
   failed, retry?" for the orphaned game. Cleanup of truly abandoned state becomes a
   user-gestured Discard or an explicit, logged policy, never a silent side effect of a GET.
   (A GET endpoint mutating state is also a smell on its own; the delete-on-read moves to
   an explicit step.)
3. **Backfill/heal the existing orphan** (rooom1h's game, and any others a prod scan finds):
   once the UI exists, their pending games become visible with the retry/discard choice.
   Scan prod for pending games older than a day to size the population.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/gamesDataStore.js` - readyGames filter ~60, ~90, ~429
- `src/frontend/src/components/ProjectsScreen.jsx` - `useReadyGames()` consumer ~118
- `src/backend/app/routers/games_upload.py` - `list_pending_uploads` ~425-480 (silent
  delete), prepare/finalize
- `src/backend/app/storage.py` - `r2_is_multipart_upload_valid` ~2362, multipart abort
- `src/frontend/src/services/uploadManager.js` - resume flow
- Games tile components (GameTile.jsx) for the incomplete-upload card state

### Related Tasks
- Epic siblings: T7470 (must land first or together: it stops the cleanup deleting these
  games; this task makes the survivors visible), T7480 (observability of the same sessions)
- T7360 (concurrent uploads): same store surface, sequence deliberately
- UI style guide + ui-designer agent for the card state

### Research-backed requirements (2026-08-24 best-practices review)
- **Mobile MUST say "keep this tab open and your screen unlocked" during an active
  upload.** iOS Safari has no functional Background Fetch/Sync: tab close or screen lock
  can kill the transfer and nothing can recover it in the background. Silence here is
  why mobile uploads look like random failures. This messaging is part of the upload
  progress UI, not optional polish.
- **Resume across page reload**: persist enough session state that a returning user is
  prompted to re-select the same file (pre-matched to the pending session by
  name/size/hash) and resume from the last completed part, rather than starting over.
  Browser security requires the re-selection gesture; the win is not re-uploading
  completed parts (tus-style offset resume property).
- Progress must show real delivered bytes (completed parts), never buffered bytes; a bar
  that races ahead then stalls destroys trust faster than no indicator.

### Technical Notes
- Persistence: Retry/Resume/Discard are all explicit gestures; the reaping change removes a
  write from a GET path, which is aligned with the gesture rule, not in tension with it.
- The multipart abort on reap is an R2 call, not a DB write; failure to abort must not block
  the response (log loudly, leave the record for the next pass).
- Impersonation note: making pending games visible also fixes the admin-side confusion that
  triggered this investigation (admin sees what the user sees, including the stuck upload).

## Implementation

### Steps
1. [ ] Backend: honest reap (abort multipart, mark state, no silent delete-on-GET)
2. [ ] Frontend: pending/incomplete game card + Retry/Resume/Discard actions
3. [ ] Prod scan for existing orphaned pending games; heal via the new honest states
4. [ ] Tests: backend reap behavior, frontend card rendering + gestures, relevant set only

## Acceptance Criteria

- [ ] A game whose upload died is visible in the Games list with an incomplete-upload state
- [ ] Retry/resume works when the session is resumable; discard works always (explicit
      gesture, cascade delete)
- [ ] An invalid resume record is reaped by aborting the R2 multipart and surfacing state,
      never by a silent row delete inside a GET
- [ ] rooom1h's orphaned game is resolved (visible + actionable, or discarded by the user)
- [ ] Tests pass; CI green
