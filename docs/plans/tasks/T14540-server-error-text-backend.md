# T14540: Server error text shown to parents (backend)

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

`HTTPException(detail=...)` strings and export progress messages reach the UI (the frontend
shows `data.detail` in toasts and errors). Many name internals: "Failed to generate R2 URL",
"R2 returned {status}", "Invalid BLAKE3 hash format", "Requested range outside clip/moov
windows", "Invalid keyframes JSON: ...", "Overlay generation failed: {e}", "(pending migration)",
"Rotation is unavailable while your data finishes upgrading [em dash] please retry." (`clips.py` ~750, contains a literal em dash), "Export
from Focus mode first" (retired name), "Modal job is still processing", and "Project/Raw
clip/Working clip/Reel not found" (parents never see those nouns). Progress text mixes
"Export complete!", "Starting generation...", "Concatenating clips...", "Uploading to cloud
storage...", and some messages ask the user to "Refresh".

Full list with file:line: [copy-vocabulary/audit/E-landing-backend.md](copy-vocabulary/audit/E-landing-backend.md) sections F1 to F16.

## Solution

1. Identify which detail strings the frontend actually displays (report E lists the consumers:
   auth, payments, share endpoints, `useRawClipSave`, `usePublishProject`, `useReEditReel`,
   `ExportButtonContainer`, `uploadManager`).
2. For displayed details, use plain glossary words ([copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md)):
   "We couldn't find that play / game / highlight", "We're updating your account. Try again in
   a minute." (one phrase for every pending-migration case), "We couldn't start your upload.
   Try again." Keep exception text in logs only; never interpolate `{e}` into a detail.
3. Progress messages: "Making your highlight...", "Your highlight is ready" (replace Export /
   Generation / Concatenating / cloud storage wording). Remove every "Refresh" instruction.
4. Error CODES the frontend branches on (e.g. `pending_migration`, `insufficient_credits`) must
   not change; only the human-readable text.

## Context

### Relevant Files
- `src/backend/app/routers/clips.py`, `downloads.py`, `projects.py`, `framing.py`, `overlay.py`, `games.py`, `games_upload.py`, `storage.py`, `exports.py`, `multi_clip.py`, `detection.py`, `rank.py`, `shares.py`, `suggestions.py`, `auth.py`, `payments.py`, `collections.py`, `intro_cards.py`
- Frontend consumers that display `detail` (to confirm visibility)

### Related Tasks
- T4620 (fetch_or_404 helper, ~34 "not found" wordings): if T4620 lands first, change the wording in its helper; otherwise coordinate so the helper adopts these messages.
- T14530 is the frontend half.

### Technical Notes
- Many backend tests assert detail strings; update them deliberately.
- Admin-only endpoints are out of scope.

## Implementation

1. [ ] Inventory displayed details (grep frontend for `detail`)
2. [ ] Failing tests for representative cases: an R2 failure, a pending-migration 503, a not-found
3. [ ] Rewrite displayed details and progress messages; log technical text
4. [ ] Relevant backend tests + ruff

## Acceptance Criteria

- [ ] No displayed detail or progress message names R2, BLAKE3, moov, Modal, GPU, CUDA, JSON, migration, project, raw clip, working clip, reel, or interpolates an exception
- [ ] No message asks the user to refresh
- [ ] Error codes the frontend branches on are unchanged
- [ ] Tests pass
