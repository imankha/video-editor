# T7880: Reconcile stranded prod uploads for absent users (admin-run sweep)

**Status:** WAITING ON USER
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
- Depends on: T7870 verdict for the ojedalucas object only — resolved, healed 2026-08-28
- Blocks: T7610 sends to rooom1h + finneganscudder segments
- Root-cause follow-up: the double-UploadId anomaly reproduced in BOTH accounts scanned
  (2/2) — filed as [T7950](T7950-double-uploadid-multipart-leak.md) per this task's own
  instruction; this sweep only cleans up the symptom

### Technical Notes
- **Admin trigger endpoint: decided script-only, not built.** The apply step's
  manifest-review gate (dry-run -> human reads the classified findings -> apply) doesn't
  map cleanly onto a single HTTP trigger without either skipping the review step or
  duplicating the whole two-phase flow behind `require_admin`. Incident frequency is low
  (this is the first sweep ever run); re-run `scan_stranded_uploads_sweep.py` +
  `apply_stranded_uploads_sweep.py` by hand if it recurs. Revisit if this becomes routine.

## Implementation

### Steps
1. [x] Widen scan script: pending games + rows + full open-multipart listing, dry-run report
   — `scripts/scan_stranded_uploads_sweep.py` (new, offline/read-only, mirrors
   `audit_clip_dimensions.py`'s R2-download pattern); added
   `r2_list_multipart_uploads_by_prefix` to `storage.py` for the broad "games/" listing
   the exact-key lister can't do
2. [x] Run dry-run against prod, present the exact reconciliation set for user sign-off —
   see Progress Log
3. [ ] Apply: abort multiparts, flip games, delete stale rows — script ready
   (`scripts/apply_stranded_uploads_sweep.py`), gated on user sign-off
4. [ ] Verify via re-list (impersonation deferred to user's own spot-check if wanted)
5. [x] Admin trigger endpoint: decided script-only (see Technical Notes)

### Progress Log

**2026-08-28:** Branch `feature/T7880-stranded-upload-prod-reconciliation`, commit
`da742b67`, CI running. Dry-run against prod (`--hours 24`) downloaded 51 profile DBs
across 41 users and cross-referenced against a full R2 listing of open multiparts under
`games/`. Result: **exactly the 2 accounts named in this task's Problem section**, both
classified `double_uploadid_anomaly` (stored `pending_uploads.r2_upload_id` differs from
the actually-open R2 UploadId):

| User | Game | Stored UploadId (dead) | Open UploadId (leaked) |
|---|---|---|---|
| roooooooooom1h (`efb1e9e8`, profile `4a613b52`) | "Vs cocke Sep 2" | `AAi3jIZ...` | `AMW7ZUH...` |
| finneganscudder (`4f03d25d`, profile `e55c1489`) | "Vs Boise JV Aug 3" | `AK7DkCv...` | `AOb-Ejz...` |

ojedalucas19 does **not** appear in this scan — confirms T7870's heal (flipped his game
to `ready`) left no pending-game trace here, as expected.

Reap manifest written to `C:\tmp\t7880_manifest.json` (2 entries, 2 UploadIds each to
abort — both the dead stored one and the leaked open one, per the task's "abort BOTH"
instruction). Apply script dry-run verified clean against the live machine
(`fly ssh console -a reel-ballers-api`) — prints the exact same plan, writes nothing.
**Awaiting user sign-off to flip `APPLY=True` and run for real.**

## Acceptance Criteria

- [ ] Zero open multiparts under `games/` older than the threshold, verified by listing
- [ ] Both stranded accounts render the Retry/Discard card
- [x] Dry-run report + user sign-off logged here before any apply (report done; sign-off pending)
- [x] Double-UploadId occurrences counted and recorded (2/2 — both accounts show the anomaly;
      still no root-cause task filed, see Related Tasks)
