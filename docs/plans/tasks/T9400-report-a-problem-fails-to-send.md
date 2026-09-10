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
