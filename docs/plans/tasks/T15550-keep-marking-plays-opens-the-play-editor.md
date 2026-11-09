# T15550: Keep marking plays opens the play editor instead of returning to marking

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop.

**Steps:** Mark a play, then tap 'Keep marking plays'.

**Expected:** Back to Annotate to mark the next play.

**Actual:** It created a highlight and opened Edit play ('Highlights from this play: Portrait IN PROGRESS'); the second play needed the top 'Mark Plays' button. The helper text ('Saves this play as a highlight in Plays...') contradicts the label.

## Acceptance Criteria

- [ ] 'Keep marking plays' returns to Annotate with the playhead after the marked play.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-mark1.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-keepmarking.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-keepmarking2.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-editplay.png`

### Related Tasks
T14770, T14610

### Relevant Files (REQUIRED)
- To be found.
