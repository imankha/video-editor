# T15720: Safari may fail to load game and clip video on staging (preflight 403, credentials CORS on the R2 redirect)

**Status:** STAGING
**Impact:** 9
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Possible bug (unconfirmed), found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 and iPad gen 7 (Playwright WebKit on Windows); real devices not checked.

**Steps:** As e2e-gate@test.local in WebKit, open Annotate on a game, or Frame/Overlay/Finished on a highlight.

**Expected:** The game and clip video load.

**Actual:** Console: 'Preflight response is not successful. Status code: 403' and 'Credentials flag is true, but Access-Control-Allow-Credentials is not true'. The video request is a 302 from the API to an R2 URL and the fetch fails. Two other testers saw WebKit fail to open the 1080p game file ('This file isn't a video we can open') and the upload tester saw 'Preflight ... 403' on iPhone (T15710). May be a Playwright-WebKit-on-Windows artifact; if real Safari does the same, iPhone users cannot edit at all.

## Acceptance Criteria

- [ ] On a real iPhone (Safari) against staging, Annotate, Frame, Spotlight and the Finished player all play video.
- [ ] If it reproduces: the R2 redirect target answers the preflight with the right CORS headers, or the request is made without credentials.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- No screenshot captured for this bug (console errors only; screenshots would show a black video box).

### Related Tasks
T15450 (same Safari cross-site class), T15710

### Relevant Files (REQUIRED)
- To be found.
