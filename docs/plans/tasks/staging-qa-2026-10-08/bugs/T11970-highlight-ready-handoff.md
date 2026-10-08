# T11970: Highlight-ready handoff is consistent and fast

**Status:** STAGING
**Impact:** 8
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 1: Bugs](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

After generation finishes, a 'Highlight ready' toast fires but Focus keeps showing 'Generate highlight' and the step-5 guide for about 15 s before the 'Your highlight is ready' panel opens (qa-21, qa-22); the credit balance read 86 and only later 83. Confirmed mechanism: the WebSocket COMPLETE message fires the toast (GlobalExportIndicator.jsx:214-262), ExportButtonContainer.jsx:300-319 sets isExporting false at once (bar flips back to Generate), then it awaits onProceedToOverlay; FocusScreen.jsx:1019-1042 awaits refreshProject() and then resolveWorkingVideoPreviewUrl() one after the other before offerFocusCompletionPreview opens the panel. CTA mode derives from project.working_video_id (FocusScreen.jsx:1198) so it stays 'generate' until the refresh lands. Not polling, not a CAS wait. Leading suspect for the full 15 s: the playback-url handler is async def but calls blocking boto3 file_exists_in_r2 on the event loop (routers/projects.py:1308) while the export's background sync_export_db_to_r2 runs in a thread on a small staging machine. Warm these endpoints measure about 240 ms (keyframes-framing.md:1751).

## Solution

1) From COMPLETE until the panel opens show 'Opening your highlight...' (existing isLoadingWorkingVideo is already true) and render no step-5 guide. 2) Run the two GETs with Promise.all; the panel opens as soon as the playback URL resolves. 3) Skip the 'Highlight ready' toast when the finished framing job belongs to the project currently open in Focus (the panel is the notification). 4) Wrap file_exists_in_r2 in asyncio.to_thread in get_working_video_playback_url and re-measure. Settle the 15 s first: pull staging [REQ_TIMING]/[SLOW REQUEST] lines for GET /api/projects/{id}, /working_video/playback-url and /api/credits in the 20 s after COMPLETE, or record a HAR. If /api/credits was also slow every request was slow (backend bound).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/screens/FocusScreen.jsx`
- `src/frontend/src/containers/ExportButtonContainer.jsx`
- `src/frontend/src/components/ExportButtonView.jsx`
- `src/frontend/src/components/GlobalExportIndicator.jsx`
- `src/backend/app/routers/projects.py`

### Related Tasks

- None. T12270 (job-aware guide) builds on this.

### Test first (red before green)

FocusScreen/ExportButtonContainer test with mocked fetches held pending: fire WS COMPLETE; assert the bar does not show 'Generate highlight' and that both URLs were requested before either resolved. Fails today.

### Technical Notes

Expert to consult if timing logs point at the backend: persistence-sync.md and export-pipeline.md.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T11970:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

**2026-10-08**: Implemented on feature/T11970-highlight-ready-handoff. Opening state in the bar and the landscape cockpit rail, step-5 guide hidden, refresh and playback-url run in parallel with the panel opening on the URL, toast suppressed while the project is open in Focus (loud error toast when no URL), file_exists_in_r2 moved to asyncio.to_thread. Tests: real-FocusScreen handoff test, guide, cockpit, toast and backend thread tests; each fails against its broken variant. Reviewer: one MAJOR (cockpit) fixed. Proof verifier: code proof strong; remaining gaps are CI and the staging timing. Landed on red Branch CI by explicit user decision: the 97 frontend failures are identical on pristine master, filed as [T12320](../../T12320-restore-frontend-unit-tests-green.md).

**Staging check still owed (AC4):** on warm staging run Generate on an open Focus project; record COMPLETE-to-panel time (the toast is now suppressed); pull the [REQ_TIMING]/[SLOW REQUEST] lines for GET /api/projects/{id}, /working_video/playback-url and /api/credits in the 20 s after COMPLETE and attach them here. If still over 2 s, reopen with those logs; the reviewer suspects the blocking SQLite query in get_working_video_playback_url (and GET /api/projects/{id}) on the event loop if the per-user seam lock is held by the export sync.

## Acceptance Criteria

- [x] Between COMPLETE and the panel the bar never shows 'Generate highlight' and the step-5 guide is not rendered
- [x] Both GETs start before either resolves
- [x] No 'Highlight ready' toast while that project is open in Focus
- [ ] On staging toast-to-panel is under 2 s warm, with the timing logs attached to the task
- [ ] Relevant tests pass and lint is clean
