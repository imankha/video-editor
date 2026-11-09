# T15520: Download takes 16 s with no feedback

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop.

**Steps:** Tap Download on a finished highlight.

**Expected:** Download starts within a couple of seconds, or progress is shown.

**Actual:** GET /api/downloads/1/file-url took 16.4 s with no visible feedback (2.6 MB file Play_2_ReelBallers.mp4).

## Acceptance Criteria

- [ ] Download shows feedback within 1 s and file-url answers in under 3 s warm.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-download.png`: state during the 16.4 s wait

### Related Tasks
T14840

### Relevant Files (REQUIRED)
- To be found.
