# T9400: "Report a problem" fails to send, and the failure has no fallback

**Status:** WIP
**Impact:** 9
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B9, UX-16, N45 (handoff E2-03)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Andrew hit the quest-completion failure (T9410), opened **Report a problem** to tell us about it,
and the report itself failed: *"Failed to send report. Please try again."* with only a **Try again**
button. Screenshot-supported. The submission payload and the server response were not captured, so
**the cause is unestablished** - staging misconfiguration is one hypothesis, not a finding.

This sits at the top of the whole handoff for one reason: **this is the channel every other bug
arrives through.** A silent or unrecoverable failure here means the reports we never received are
invisible, and we cannot know how many there were.

## What the code already does (verified 2026-09-10, not assumed)

`src/frontend/src/components/ReportProblemButton.jsx`:

- `description` lives in component state and is NOT cleared on failure (`handleSend`'s catch only
  sets `state = 'error'`), so **the text already survives a failed send** - the report's
  "preserve the report" ask is partly satisfied already. Verify in the live UI before scoping.
- `clearClientLogs()` runs only on success, so the diagnostic buffer also survives.
- The payload carries a full-page `html2canvas` base64 screenshot plus client logs, action log and
  editor context. **Payload size is the first suspect** - a large base64 screenshot on a slow
  uplink is exactly the shape of a request that dies mid-flight and surfaces as a TypeError.
- The catch already distinguishes a network TypeError from an HTTP error, but only in `console.error`.
  The user sees one generic string either way.

## Solution

1. **Establish the cause first.** Reproduce against staging with a real report, capture the request
   and response (size, status, timing). Check the backend `POST /api/auth/report-problem` handler
   and any body-size limit in front of it (Fly proxy / FastAPI). Do not patch the UI around an
   unmeasured failure.
2. **Make the failure honest and recoverable**: keep the typed report visible (confirm it already
   is), offer **Retry report** and **Copy error details**, and say plainly that nothing was lost.
3. **Copy details must be safe**: exclude credentials and session tokens, and show the user what
   will be copied before it goes to the clipboard.
4. **Deduplicate retries** so a successful retry after an ambiguous failure does not file twice.
5. **Degrade rather than fail**: if the screenshot is what breaks the send, retry without it and
   say so, instead of losing the whole report.

## Context

### Relevant Files
- `src/frontend/src/components/ReportProblemButton.jsx` - modal, send, failure state
- `src/frontend/src/utils/clientLogger.js` - log buffer attached to the report
- `src/frontend/src/utils/analytics.js` - action ring buffer
- `src/backend/app/routers/auth.py` - `report-problem` endpoint (confirm path)
- Fly / FastAPI request-size configuration, if the cause is payload size

### Related Tasks
- Blocks nothing, but T9410 is the bug Andrew was trying to report. Investigate them together.
- Naming for this surface is T9560 (N45: "Report not sent" / "Retry report").

### Technical Notes
Staging and production use different backends. **Test both separately** - a staging-only
misconfiguration and a universal payload-size bug look identical from the modal.

## Acceptance Criteria

- [ ] The real cause is established and written into the Progress Log, not inferred
- [ ] A failed send preserves the typed report and its diagnostics for retry
- [ ] Copy error details works when the reporting service is unavailable, and excludes credentials
- [ ] A successful retry after an ambiguous failure files exactly one report
- [ ] Staging and production report delivery are each exercised and recorded
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green

## Progress Log

### 2026-09-11 - Root cause established (live curl against staging + prod)

The container is NOT network-blocked (the prior "BLOCKED" note was wrong): both backends are
directly reachable. `report-problem` is a plain HTTP endpoint, so it was probed with curl, no
browser needed.

**Established cause: a blocking, synchronous R2 asset upload inside the request path stalls the
whole report when R2 outbound is slow (reproduced on a cold Fly staging machine).**

The handler (`routers/auth.py` `report_problem`) does, in order: (1) INSERT the bug row into
Postgres, (2) upload the screenshot to R2, (3) upload formatted console logs to R2, (4) UPDATE
the row with the R2 keys. Steps 2-3 call `retry_r2_call(..., **TIER_2)` = 3 attempts with up to
a 30s `read_timeout` each plus exponential backoff, so a stalled R2 blocks the request for up to
~90s. That is far longer than the browser's fetch will wait, so the client aborts with a network
`TypeError` and shows the generic "Failed to send report."

Evidence (all payloads labelled `[QA TEST - T9400 investigation, safe to ignore]`):

| Probe | Staging | Prod |
|-------|---------|------|
| `/api/health` | 200 in 1.15s (cold) | 200 in 0.11s |
| small payload **with** 1 log line (277 bytes) | **timed out >30s** (first heavy POST, cold machine) | 200 in 3.0s |
| payload with **empty** `logs` (PG insert only, R2 skipped) | 200 in 0.42s | - |
| blank description | 400 fast ("A description is required.") | - |
| 6 warm repeats with logs | all 200 in <0.7s | - |

- **H1 (payload size) REFUTED:** a 277-byte body hung; size is irrelevant. The trigger is the
  R2 upload path (present on every real report, which always carries logs and usually a
  screenshot), not body size. There is also no server body-size cap anywhere.
- **H2 (PG INSERT failure) REFUTED:** the insert-only path returns in 0.42s; the row commits
  fine. The stall is in the R2 step that runs *after* the insert.
- The hang was a **cold-start artifact**: the first heavy POST to a suspended/just-woken staging
  machine stalled on the outbound R2 TLS connection; every warm request since is fast. Andrew hit
  it because his report was the first heavy request after the staging machine had auto-stopped.
- **Side effect:** the whole handler runs inside the `with get_pg()` block, which commits at
  block exit (`pg.py:518`) *after* the R2 step; the R2 uploads are wrapped in their own
  try/except so an R2 error is caught and never rolls the row back. Net effect: a stalled report
  still commits a `bug_reports` row (just late, after the client has already given up), so a naive
  retry files a duplicate - which is why the dedup acceptance criterion matters. The fix must
  split the INSERT+commit from the R2 upload (background it), which newly creates a
  "row committed, assets pending" state that a retry can duplicate - hence a DB-enforced
  idempotency key.

Fix direction: the report is "sent" the moment its diagnosable text+metadata is committed to
Postgres; R2 asset uploads must not be able to sink that (background them / bound them) so R2
health never determines report success. Frontend: keep the honest+recoverable failure UX
(preserve text, Retry, Copy details) for the residual failure modes, and dedup retries.

### 2026-09-11 - QA evidence (per acceptance criterion)

The fix is committed on the branch but NOT yet deployed. Some criteria are verified now (live
curl + automated tests); the live browser walkthrough of the new UX against a DEPLOYED build is
a post-merge step, because staging deploys on merge and the new `client_report_id` column needs
the postgres migration (`POST /api/admin/migrate-postgres`) after deploy.

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Real cause established, written up | Done - see the root-cause entry above (live curl, staging + prod). |
| 2 | Failed send preserves report + diagnostics | Frontend test: after a failed send the textarea stays mounted with the typed text; `clearClientLogs` runs only on success. |
| 3 | Copy details works offline, excludes credentials, previewed | Blob built client-side (no fetch, so works when the service is down); scrub test covers 3 leak shapes (key=value, Bearer value, JSON-quoted `access_token`/`session_id`); preview shown in a readonly textarea before any clipboard write. |
| 4 | Retry after ambiguous failure files exactly one | Real-Postgres test `test_dedup_files_exactly_one_row_against_real_postgres` (resend same `client_report_id` -> one row, same id); frontend test proves the id is stable across the retry. |
| 5 | Staging + prod delivery each exercised | CURRENT deployed delivery exercised via live curl: prod accepted `bug_id=54` (3.0s); staging accepted `bug_id=7,8` + 6 warm repeats (<0.7s). All probes are labelled `[QA TEST - T9400 investigation, safe to ignore]` in the admin bug list (cleanup: they can be deleted from admin). NEW-flow live walkthrough on a deployed build is pending merge + `migrate-postgres` (supervisor/operator). |
| 6 | Relevant test set green | 10 backend (T9400 + T7560) + 6 frontend (failure + gate) + 27 migration-guard (real PG) green; ruff + eslint clean. |
| 7 | Branch CI green | Pending push (supervisor). |

**Operator note (post-merge):** after deploy, run `POST /api/admin/migrate-postgres` (postgres
track is deploy/admin-triggered, no per-user seam) to apply v028 `bug_reports.client_report_id`.
Fresh deploys get it from `_SCHEMA_DDL` automatically. Also: the cold-start stall itself is an
infra property of the staging machine (auto-stop suspend, min_machines_running=0) - this fix makes
the report survive it; it does not (by design) keep the machine warm.
