# T15560: Visit to sign-up gate says not instrumented while the Journey shows visits

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin desktop.

**Steps:** Admin > Spend readiness, gate 1; compare with the Journey's Visited node.

**Expected:** Gate 1 reads the same visit data the Journey shows.

**Actual:** Gate 1: 'not instrumented: no visit beacon (visit_daily missing)'. Journey Visited: 25 to 68 visits since 2026-11-08. The gate blocks the measurement flight ('first: Visit to sign-up').

## Acceptance Criteria

- [x] With visit beacon data present, gate 1 is judged from it (not 'not instrumented').

## Resolution

Root cause: gate 1's `_visit_daily_exists(cur)` checked Postgres `to_regclass('visit_daily')`,
but the T7410 visit beacon lives in the SQLite analytics store (`app/services/analytics_store.py`,
synced to R2), read via `load_visit_totals()` -- the same source the Journey's "Visited" head node
uses. Postgres never has a `visit_daily` table, so gate 1 always said "not instrumented" even once
the beacon shipped. Fix: gate 1 now reads `load_visit_totals()` + `_visit_matches` over a trailing
7-day window (`VISIT_WINDOW_DAYS`) and counts sign-ups in the same window, feeding both into the
normal proportion gate path; "not instrumented" is kept only when no visit data exists yet or the
window predates the beacon's instrumented date.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-spend-open.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-journey-expanded.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-diagnose.png`
- Log `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\logs\a6.out`: admin API capture incl. spend-readiness gate payloads

### Related Tasks
T7410, T14910, T14960

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_spend_readiness.py` (gate 1 reader, `_gate1_signups`)
- `src/backend/app/services/spend_readiness_constants.py` (`VISIT_WINDOW_DAYS`)
- `src/backend/app/services/analytics_store.py` (`load_visit_totals`, the actual visit beacon source)
- `src/backend/app/services/analytics_journey.py` (`_visit_matches`, reused)
- `src/backend/tests/test_admin_spend_readiness.py`
