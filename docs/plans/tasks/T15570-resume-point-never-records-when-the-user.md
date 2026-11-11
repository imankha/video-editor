# T15570: Resume point never records when the user left or the playhead

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin desktop (data).

**Steps:** Admin > user detail 'Where they left off' for qa-*-1109 users.

**Expected:** Shows the age ('… ago') and playhead.

**Actual:** Every resume point has left_at: null and t: null, so neither is shown ('framing, play 1 in "game-ipad", build 7405').

## Acceptance Criteria

- [x] A resume point saved on exit carries left_at and the playhead t, and admin shows both.
  Already true via the T15360 exit beacon; evidence: `T15570:C1` check below.

## Ruling

**Duplicate of T15360; add a Framing variant of its check** (owner, 2026-11-10). The exit beacon already records `left_at` and the playhead `t` on a real tab close (T15360's check proves it for Annotate and Overlay). QA saw nulls because an ordinary test-browser close never fires the page-hide event, and every in-app navigation write sets them null by design. No product change. The one piece of work: a Framing-specific variant of `T15360.check.spec.js` (close the tab with `page.close({ runBeforeUnload: true })`, then assert `left_at` and `t` are set), committed as `T15570: ...`, plus a note in this file that QA's observation came from the harness.

Worker's investigation, 2026-11-10:

Investigated 2026-11-10 (code-expert-style read + Opus root-cause consult). Findings:

- The exit beacon (`installResumePointExitBeacon`, `src/frontend/src/utils/resumePoint.js`)
  is the ONLY writer of `left_at`/`t`; it fires on `pagehide` / `visibilitychange->hidden`.
  Every navigation-gesture write (`editorStore.updatePath` -> `writeResumePoint`) explicitly
  sends `left_at: null, t: null` by design (a freshly-opened object has no "left at" time).
- T15360 (merged + staged same day, 2026-11-09) fixed the actual bug that existed at the time
  ("`installResumePointExitBeacon()` exported but never called"). Its own acceptance check
  (`T15360.check.spec.js`, already in master) proves the beacon DOES work end-to-end on staging
  for Annotate and Overlay — using `page.close({ runBeforeUnload: true })`, which the check's
  commit message notes is required to make Playwright actually fire `pagehide`.
- The QA pass that filed T15570 walked screens then read the admin panel without that
  exit — ordinary `context.close()`/`browser.close()` (or just finishing the script without
  closing the tab) does not run `beforeunload`/`pagehide` handlers at all. That reproduces the
  exact symptom (path/screen/build populated from the last nav write, `left_at`/`t` null from a
  beacon that never got a chance to fire) without any product defect.
- Per the current design, `left_at`/`t` are only ever non-null for a genuinely abandoned
  session (closed/hidden and not reopened since) — any later navigation nulls them again. A
  typical QA/real-user session that is still being driven, or that has navigated again since
  its last hide, will show nulls by construction. The stated acceptance criterion already
  holds for a real exit (proven by the T15360 check); it does not hold while mid-session, which
  may be what the QA screenshots actually show.

**Open question for the owner:** is the acceptance criterion satisfied by the existing
exit-beacon mechanism (in which case this task should close as a duplicate of T15360 with a
QA-harness note, plus optionally a Framing-specific variant of the T15360 check since that
check only covered Annotate/Overlay), or is the intent that admin should show a meaningful
"where they left off" time even mid-session (requiring a product change — e.g. a `prev`
field on the navigation write carrying the OUTGOING screen's playhead/timestamp, still a
named gesture, not reactive)? These have different scope/risk and the acceptance criteria
text doesn't disambiguate.

**Closed per the owner's ruling above** (2026-11-10). Added
`src/frontend/e2e/checks/T15570.check.spec.js` (`T15570:C1`): closes a real tab on a Framing
(`/focus/p/{id}`) play and asserts `GET /api/auth/me`'s `resume_point.left_at`/`.t` are both
set — same close-tab-then-check pattern T15360's check already used for Annotate/Overlay,
scoped under T15570's own id. Ran against unchanged production code: passed (`qa/green-T15570-check.log`),
confirming the acceptance criterion already holds via the existing exit beacon. No production
code change and no red counterpart: per the Landing Policy's documentation-only clause, this is
characterization evidence for a no-code-change closure, not a bug fix.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-user-detail.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\ipad-user-detail.png`

### Related Tasks
T14980, T14990, T15340

### Relevant Files (REQUIRED)
- To be found.
