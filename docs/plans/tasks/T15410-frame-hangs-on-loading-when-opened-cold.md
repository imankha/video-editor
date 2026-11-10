# T15410: Frame hangs on Loading when opened cold from resume, the Continue card or after export

**Status:** STAGING
**Impact:** 9
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop 1440x900, iPad portrait (Chromium emulation).

**Steps:** Mid-edit on a play in Frame, close the tab and reopen the app root (or tap the play on Home's 'Continue where you left off' card, or reopen after a Frame export finishes).

**Expected:** Frame loads the play within a few seconds.

**Actual:** URL resumes correctly (/focus/p/1?profile=...) but the screen shows only 'Loading...' for 35-50+ s; on iPad the Mark Plays and Spotlight tabs show lock icons. A manual reload loads it. Log: '[App] editor mode with no selected project; routing home {editorMode: framing}'.

**Second repro (editor version check, e2e-gate@test.local):** Deterministic desktop repro, reproduced twice: open `/focus/p/11?profile=9fa7378c`, close the tab, cold-load `/` in a fresh context. URL restores to `/focus/p/11?profile=...` but 'Loading...' for 75+ s. Only `GET /projects/11` and poster images are requested; no clips, playback-url or stream request. Breadcrumb lacks the game name; Mark Plays and Spotlight show padlocks. The same URL pasted directly loads in ~10 s, and Annotate and Overlay resume fine, so it is the resume-restore path into Focus specifically.

## Acceptance Criteria

- [ ] Cold-loading /focus/p/<id> from a closed tab, from the Continue card, and after an export completes shows the Frame editor within 10 s, no reload needed.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-reopen-root2.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-midedit.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-frame-stuck.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-35-export-end.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-36-resume-retry.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\desktop-u-focus-restored.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\desktop-u-focus-restored2.png`

### Related Tasks
T14980, T15340, T15360 (resume point), T14970 (deep-link cold load)

### Relevant Files (REQUIRED)
- To be found.

## Ruling

**Check C1 on staging** (owner, 2026-11-09). The 10 s cold-load check failed in the group's container only because its Vite dev server took 9-11 s to serve its own static index.html under host load (backend /api/health answered in 3 ms); the verifier and fixer agreed on that cause, and resumePointRestore.test.js proves the fix's mechanism. C1's browser check is marked `defer_to_staging` and runs against staging after merge; a failure there is filed as a bug.
