# T7560: Bug reports accept NULL descriptions; a cry for help stored nothing

**Status:** STAGING
**Priority:** P2
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

Prod `bug_reports` row id 46 (avi468870@gmail.com, iPhone Safari 26.6.1, viewport
320x498, page /home, 2026-08-24 00:57:56) has `description = NULL`. The user filed it
17 seconds after finishing the annotate tutorial, at the exact moment the quest told him
to upload a game (the funnel's biggest cliff, mobile). He reached for the help button and
we captured nothing: no text, and no automatic context beyond page + UA.

Two defects:
1. An empty report can be submitted (client allows it) and persisted (server accepts
   NULL) silently. Whatever the client-side cause (submit fired before typing? a mobile
   keyboard/focus issue? accidental submit), the row should never land empty without
   telling the user or capturing SOMETHING.
2. The report pipeline captures too little on its own: the `actions` array exists (it
   nailed lisagee's last steps in report #21) but there is no recent-console/error
   capture, so a mobile "nothing happened" report carries no diagnosable signal.

## Solution

1. Client: require a non-empty description before enabling submit (with a gentle prompt
   like "one sentence helps us fix it"), OR if deliberate frictionless reporting is
   wanted, submit with an explicit placeholder ("no description provided") so the intent
   is visible, never NULL.
2. Server: reject NULL/empty with 400 (belt and braces), while continuing to accept the
   explicit placeholder if option B is chosen.
3. Enrich capture: attach the last N recent client-side errors/warnings (a small ring
   buffer of console.error + window.onerror entries) to every report. This directly
   serves the mobile cliff diagnosis (no client error telemetry exists at all today; a JS
   exception on mobile Safari leaves zero trace, see T7510 caveats).
4. Investigate WHY #46 arrived NULL (repro the report modal on a 320px viewport; check
   whether the submit button is reachable/labels visible with the keyboard open).

## Context

### Relevant Files
- Frontend bug report modal/component (locate via "report" in components; the /logdump +
  report-problem flow)
- `src/backend/app/routers/` report-problem endpoint
- Postgres bug_reports schema (`pg.py`)

## Acceptance Criteria

- [x] Empty description can no longer persist as NULL (path chosen documented)
  - **Client gate: Option A (hard requirement) chosen.** The Send button stays
    disabled until `description.trim()` is non-empty, with a gentle hint ("One
    sentence helps us fix it"). `handleSend` also early-returns as belt-and-braces.
    Rationale: Option B (an explicit "no description provided" placeholder) would
    still persist a diagnostically empty row; requiring one sentence maximizes
    signal, and the auto-attached screenshot/logs/actions/error-buffer ride along
    the moment the user types. `ReportProblemButton.jsx`.
  - **Server gate:** `report_problem` (auth.py) rejects NULL/blank/whitespace-only
    `description` with 400 before touching Postgres — independent of the client fix.
    Any non-empty string (incl. a placeholder, had Option B been chosen) is accepted.
- [x] Reports carry a recent-errors ring buffer
  - The existing `clientLogger` ring buffer (already attached to every report as
    `logs`) now also captures UNCAUGHT errors via `window.addEventListener('error')`
    and `'unhandledrejection'`. Previously only `console.error/warn/info` were
    captured, so a raw mobile-Safari JS exception left zero trace — exactly the
    "nothing happened" gap in row #46.
- [x] 320px-viewport repro attempted; findings noted
  - Ran headless Chromium at 320x498 (report #46's viewport) with an iPhone UA.
    The new client gate BLOCKS empty and whitespace-only submits; Send enables only
    with real text. A definitive on-device reproduction of an accidental empty
    submit was NOT achievable headlessly (no OS keyboard to occlude the layout).
  - **Most-likely mechanism for row #46:** the modal is `fixed inset-0` and
    vertically centered. iOS Safari keeps the *layout* viewport full-height when the
    on-screen keyboard opens (the textarea auto-focuses on open, so the keyboard
    appears immediately), so the centered card — and its bottom-aligned Send button —
    can be pushed under the keyboard. With Send previously always enabled, a stray or
    accidental tap on the occluded button submitted an empty report. The new gate
    makes an empty submission impossible regardless of button reachability.
- [x] Test: server rejects empty; client gating verified in real browser at mobile width
  - Backend: `tests/test_t7560_report_requires_description.py` (5 tests) — NULL,
    missing, empty-string, whitespace-only all 400; a real description passes
    validation and reaches the insert (get_pg mocked). All pass.
  - Frontend: `ReportProblemButton.gate.test.jsx` (2 tests) — Send disabled while
    empty/whitespace, enabled with text, gentle prompt shown. All pass.
  - Real browser: headless Chromium at 320px confirmed empty/whitespace disabled,
    typed enabled.
