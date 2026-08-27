# T7880: Reconcile stranded prod uploads for absent users (admin-run sweep)

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-27 (from the 2026-08-27 drop-off report refresh)

## Problem

T7490's honest reap (deployed 2026-08-26) converts a stale pending upload into a visible
`upload_failed` card with Retry/Discard — but it only fires when **the user himself loads
his games list**. Users who never return are never reconciled. Verified live on prod
2026-08-27:

1. **roooooooooom1h** (`efb1e9e8`, profile `4a613b52`): R2 multipart
   `games/ff6bcbbd...mp4` open with **0 parts since 2026-08-23 01:04**, game stuck
   `status=pending`, `pending_uploads` row present. Account renders empty. 4 days stranded.
2. **finneganscudder** (`4f03d25d`, profile `e55c1489`): 663 MB file died at
   **8 parts / 209 MB**; R2 multipart `games/30ee3183...mp4` open since 2026-08-26 03:56.
   **Double-UploadId anomaly recurs here:** the open R2 multipart's UploadId (`AOOLLw0z...`)
   differs from the one stored in his `pending_uploads` row (`AK7DkCvx...`) — two multiparts
   for one prepare, the same anomaly the 2026-08-24 report flagged for rooom1h.
3. **ojedalucas19**: 164 MB object durably in R2 with **no game row at all**
   (see T7870 — the object's fate follows that task's verdict).

Why now: T7610 is about to email exactly these users "the bug is fixed, try again" — their
accounts must render the honest Retry/Discard card the moment they arrive, without waiting
for a reap race, and open multiparts accrue storage cost indefinitely for users who never
come back.

## Solution

An admin-run reconciliation pass (extend `scripts/scan_orphaned_pending_uploads.py`, which
currently targets only pending games with NO `pending_uploads` row — both stranded users
HAVE rows, so the script's target set must widen):

1. **Enumerate** (read-only, dry-run default): all `status='pending'` games older than
   N hours across all prod profiles, their `pending_uploads` rows, and ALL open R2
   multiparts under `games/` (list_multipart_uploads), matching by key. Report the full
   set including UploadId mismatches.
2. **Reconcile** (apply mode, after user sign-off per the data-safety rule):
   abort every open multipart for a dead upload (including BOTH UploadIds when they
   diverge), flip the game to `upload_failed`, delete the stale `pending_uploads` row —
   the exact transition the server-side reap performs, applied without waiting for the user.
   Respect the live-WAL rule: mutate via the running server's own path or with the machine
   stopped, never by swapping files under an open connection.
3. **Verify:** re-list multiparts (zero stale), impersonate both accounts and confirm the
   upload-didn't-finish card renders with working Retry/Discard.
4. **Recurrence guard (small):** decide + implement where the sweep reruns — simplest is a
   `/api/admin` endpoint wrapping the same code so the admin can trigger it after any future
   incident, consistent with the migration-endpoint pattern (no cron, no auto-run).

## Context

### Relevant Files (REQUIRED)
- `scripts/scan_orphaned_pending_uploads.py` — extend target set + add multipart abort
- `src/backend/app/routers/games_upload.py` — `list_pending_uploads` honest reap (the logic to reuse), prepare path (for the double-UploadId root cause note)
- `src/backend/app/routers/admin.py` — optional admin trigger endpoint

### Related Tasks
- Depends on: T7870 verdict for the ojedalucas object only (the two multiparts can proceed)
- Blocks: T7610 sends to rooom1h + finneganscudder segments
- Root-cause follow-up: if the double-UploadId anomaly reproduces, file a dedicated task — this sweep only cleans up

## Implementation

### Steps
1. [ ] Widen scan script: pending games + rows + full open-multipart listing, dry-run report
2. [ ] Run dry-run against prod, present the exact reconciliation set for user sign-off
3. [ ] Apply: abort multiparts, flip games, delete stale rows
4. [ ] Verify via impersonation + R2 re-list
5. [ ] Admin trigger endpoint (or record the decision to keep it script-only)

## Acceptance Criteria

- [ ] Zero open multiparts under `games/` older than the threshold, verified by listing
- [ ] Both stranded accounts render the Retry/Discard card
- [ ] Dry-run report + user sign-off logged here before any apply
- [ ] Double-UploadId occurrences counted and recorded (input for a root-cause task)
