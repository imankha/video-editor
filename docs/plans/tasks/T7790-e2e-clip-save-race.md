# T7790: Clip-save race — clips intermittently don't reach the library within 30s of TSV import

**Status:** STAGING
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

## Resolution (2026-08-26)

**Root cause — CLIENT-BOUND, reproduced live (R2 enabled), not backend processing time.**
`importAnnotationsWithRawClips` (AnnotateContainer.jsx) read `annotateGameIdRef.current` ONCE at
TSV-import time. On a slow/cold upload the game record is not created yet (`onGameCreated` has not
fired), so the id was null and every clip save was silently dropped with a `console.warn`; the id
arrived seconds later but nothing re-fired the one-shot saves, so imported clips showed in the UI yet
never reached the library (the intermittent "0 of 3 / 1 of 3 saved"). Deterministic negative control
(delay `POST /api/games` 8s, import TSV immediately): 0 clips on old code; `onGameCreated` fired 11s
later with no retry.

**Fix.** `resolveImportGameId()` waits (bounded 120s / 200ms poll) for an in-flight upload to create
the record — polls `annotateGameIdRef` + `uploadStore.uploadGameId` — then fires the surgical saves;
on a genuine no-game it fails LOUDLY (toast + `console.error`), never a silent drop. Still
gesture-driven, not a reactive effect. Shared helper `ensureAnnotateModeWithClips` now THROWS on a
0-clip result (fail fast) instead of warning and hanging to the 5-minute cap. Regression:
`e2e/T7790-clip-save-race.qa.spec.js` (0 clips pre-fix, 3 post-fix, 5/5 stable).

**Follow-up after rebase onto master (incl. T7780).** With clip-save fixed, the original
"Framing: spacebar" test failed at a DIFFERENT spot — `navigateToProjectFromHome` waited for a
`[title*="click to open"]` clip row after clicking the tile body. Evidence (screenshot repro): the
draft tile does NOT expand on a body click — the clip-segment strip is always visible, and the body
click navigates straight to `/focus`, unmounting the strip. Fixed the helper to click a clip SEGMENT
(deterministically opens Focus) instead of the body-then-wait two-step, and bumped a too-tight 2000ms
`Reel Drafts` nav-tab wait (~1/3 flake) to 5000ms (matches the helper's sibling waits, covers React
hydration). Both TEST-INFRA fixes — the reel's data was always correct. See annotate.md landmines
(T7790 + T7790b).

## Acceptance Criteria

- [x] Actual bottleneck identified (client-side one-shot clip-save gated on an id that arrives late)
      with evidence (live repro + deterministic negative control), not a guess
- [x] Fix addresses the real condition (wait for the id + fail loudly), not just a widened poll window
- [x] The affected e2e test passes reliably (spacebar 3/3; regression 5/5) after the fix
- [x] Tests pass; CI green (Branch CI is the full-sweep verdict) — confirmed green, merged PR #283
