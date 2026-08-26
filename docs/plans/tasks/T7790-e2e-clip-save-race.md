# T7790: Clip-save race — clips intermittently don't reach the library within 30s of TSV import

**Status:** WIP
**Priority:** P2 (real timing bug, root cause not yet found — investigation, not just a test fix)
**Impact:** 6
**Complexity:** 5
**Created:** 2026-08-26
**Updated:** 2026-08-26

## Problem

Root-caused during T7770's post-merge verification (2026-08-26), as a SEPARATE issue from
[T7780](T7780-e2e-isvisible-timeout-noop.md) (both were found investigating the same 3 failing
`regression-tests.spec.js` `@smoke` tests, but have independent causes).

`regression-tests.spec.js`'s "Framing: spacebar toggles play/pause @smoke" test failed by
running to the full 5-minute local test timeout. Root cause, confirmed via test stdout:
`WARNING: No clips saved to library after 30s - upload may have failed`. With zero clips
actually saved, `ProjectManager.jsx`'s `reelDraftsDisabled` derivation (~line 360) correctly
disables the "New Reel" affordance — so the test's own subsequent click hangs on a disabled
button until the hard 300s cap, rather than failing fast with an accurate message.

The test flow is: upload a video → import a TSV of clip markers → poll for clips to appear in
the library (30s budget) → proceed. A sibling test run in the same investigation session saved
only 1 of 3 expected clips within the same window — so this isn't a hard 0%-vs-100% failure,
it's a **genuine intermittent race** between TSV import processing and whatever query/refetch
the "clips saved" poll checks against.

## Solution

This needs real investigation, not a guessed fix — the actual bottleneck (slow TSV-to-clips
processing on the backend? a client-side poll/refetch gap? a race between the upload
completing and the clips endpoint being queryable?) is not yet identified. Suggested approach:

1. Reproduce with backend timing instrumentation around the TSV-import → clip-creation path
   (find the endpoint the TSV import hits, and whatever creates the `raw_clips` rows from it).
2. Determine whether the bottleneck is backend processing time (in which case: is it
   proportional to TSV size, and is there a way to signal "processing" vs "done" the frontend
   test could poll more precisely) or a client-side stale-read issue (in which case: find the
   query/store that isn't being invalidated/refetched promptly after import).
3. Fix at the source per the project's no-fallback rule — the fix should make the real
   condition observably correct (e.g., a proper completion signal), not just widen the test's
   30s poll window, which would only mask the symptom without explaining it.
4. Once the root cause + fix are identified, also make the e2e test itself fail with an
   accurate, fast error when this condition occurs (rather than a 5-minute hang) as a
   consequence of whatever polling/completion-signal the fix introduces — but this is a
   secondary cleanup, not a substitute for fixing the actual race.

## Context

### Relevant Files (REQUIRED — starting points, not exhaustive; this is genuinely unexplored)
- `src/frontend/e2e/regression-tests.spec.js` — the failing test + its TSV-import/clip-poll
  helper (`ensureAnnotateModeWithClips`, ~line 554) for the exact client-side wait/poll shape
- Backend TSV-import endpoint (grep `routers/` for wherever TSV clip markers are parsed into
  `raw_clips` rows) and whatever frontend query/store the clips library reads from

### Related Tasks
- Surfaced by the same expert-agent investigation as
  [T7780](T7780-e2e-isvisible-timeout-noop.md) — independent root cause, do not conflate fixes.
  Confirmed unrelated to [T7770](T7770-playwright-suite-trim.md) (zero application-source
  changes in that task's diff).

### Technical Notes
- This is explicitly NOT scoped as "increase the test's timeout" — the task is to find and fix
  the actual race, per the project's no-defensive-fixes-for-internal-bugs rule. A wider timeout
  would make the test pass more often without explaining why clips sometimes don't save in
  time, which is real product-facing risk (a real user's TSV import could hit the same gap).

## Acceptance Criteria

- [ ] Actual bottleneck identified (backend processing time vs. client-side stale-read/refetch
      gap) with evidence, not a guess
- [ ] Fix addresses the real condition (proper completion signal, corrected invalidation, etc.),
      not just a widened poll window
- [ ] The affected e2e test passes reliably (multiple runs) after the fix
- [ ] Tests pass; CI green
