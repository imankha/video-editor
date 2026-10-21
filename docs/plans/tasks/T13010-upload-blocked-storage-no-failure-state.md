# T13010: Blocked upload to storage shows no failure, lists the game and charges credits

**Status:** STAGING
**Impact:** 5
**Complexity:** 4
**Tier:** M (frontend upload flow + backend activation; verify first)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

During the walk, every request to `*r2.cloudflarestorage.com` was aborted with Playwright `page.route` while a game uploaded. Within 30 s no failed state appeared: game 2 was created, Annotate played the local blob, Home listed the game with 0 plays, and **2 credits were charged**. If the bytes never reached storage, the user sees a working game that will break on the next device or reload, and has paid for it. This is the same shape as Bug 26p (ready without a storage ref) and the 2026-08 upload failure incident, which the Upload Failure Integrity epic (T7480 to T7510) was meant to close.

## Solution

1. Reproduce on staging or dev with storage requests blocked (and separately with the network dropped mid-upload). Record what the client shows, what the game row says (status, storage ref), and the credit ledger.
2. If the game is presented as usable without its object in storage, or credits are charged for an upload that never completed, root-cause it (escalate to the expert agent: persistence and upload timing) and fix it so the upload fails loudly with Retry and no net charge, per T9680's credit rules.
3. If the client is in fact still retrying and shows that, record it as not a bug and close with the evidence.

T9720 (running 2026-10-18) also exercises an interrupted upload; fold its result in here.

## Context

### Relevant Files
- `src/frontend/src/` upload flow (game upload modal, multipart transport, upload store)
- `src/backend/app/routers/games.py` (activation) and the credit charge path
- `.claude/knowledge/persistence-sync.md`, `.claude/knowledge/backend-services.md`

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

### Progress Log

**2026-10-18 (T9720, did NOT reproduce)**: Aborting R2 PUTs on a 46 MB multipart upload and on a 435 KB upload both showed "Upload stopped. Part N network error" with Retry within 10 to 15 s; Home showed an "UPLOADING ... Tap to resume" row (Resume, Cancel); the game stayed `pending`, was not in the games grid, and 0 credits were charged; Retry after unblocking completed with one charge and no duplicate game. The T12590 observation (game listed, 2 credits) may have been an upload whose requests did not match the abort pattern. Re-verify once before spending effort; if it still does not reproduce, close as not a bug. Separate minor gap seen: no auto-resume after going offline and back online (the user must press Retry).

## Acceptance Criteria

- [ ] A test blocks storage uploads and asserts the UI shows a failed upload with Retry, the game is not presented as playable from another session, and no credit is net charged
- [ ] Same for a network drop mid-upload
- [ ] Root cause and fix recorded, or a recorded not-a-bug verdict with evidence
